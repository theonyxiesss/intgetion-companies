import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { companies } from "../../../db/companies-schema";
import { companyVerifications } from "../../../db/verifications-schema";
import { companiesPorts } from "../../../ports";

export type VerificationRow = typeof companyVerifications.$inferSelect;

export async function latestVerification(
  companyId: string,
): Promise<VerificationRow | null> {
  const [row] = await getDb()
    .select()
    .from(companyVerifications)
    .where(eq(companyVerifications.companyId, companyId))
    .orderBy(desc(companyVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

/** A new request replaces older pending ones. */
export async function createVerification(input: {
  companyId: string;
  method: VerificationRow["method"];
  target: string;
  tokenHash: string;
  expiresAt: Date;
  createdBy: string;
}): Promise<VerificationRow> {
  return getDb().transaction(async (tx) => {
    await tx
      .update(companyVerifications)
      .set({ status: "expired" })
      .where(
        and(
          eq(companyVerifications.companyId, input.companyId),
          eq(companyVerifications.status, "pending"),
        ),
      );
    const [row] = await tx
      .insert(companyVerifications)
      .values(input)
      .returning();
    if (!row) throw new Error("Verification insert returned no row");
    return row;
  });
}

export async function findPendingByHash(
  companyId: string,
  tokenHash: string,
): Promise<VerificationRow | null> {
  const [row] = await getDb()
    .select()
    .from(companyVerifications)
    .where(
      and(
        eq(companyVerifications.companyId, companyId),
        eq(companyVerifications.tokenHash, tokenHash),
        eq(companyVerifications.status, "pending"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function setVerificationStatus(
  id: string,
  status: "verified" | "expired" | "failed",
  now: Date,
) {
  await getDb()
    .update(companyVerifications)
    .set({ status, ...(status === "verified" ? { verifiedAt: now } : {}) })
    .where(
      and(
        eq(companyVerifications.id, id),
        eq(companyVerifications.status, "pending"),
      ),
    );
}

/** A confirmed domain, newer than `after` when given (after a rejection). */
export async function hasVerifiedDomain(
  companyId: string,
  after?: Date | null,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: companyVerifications.id })
    .from(companyVerifications)
    .where(
      and(
        eq(companyVerifications.companyId, companyId),
        eq(companyVerifications.status, "verified"),
        after ? gt(companyVerifications.verifiedAt, after) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** When the company last became `rejected` (audit of status changes). */
export async function lastRejectedAt(companyId: string): Promise<Date | null> {
  const rows = await getDb().execute<{ at: string | Date | null }>(sql`
    select max(created_at) as at from public.audit_logs
    where entity_type = 'company' and entity_id = ${companyId}
      and action = 'company.status_changed' and diff->>'to' = 'rejected'
  `);
  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}

/** 14.1 step 3: an admin moved one of the company's jobs out of moderation. */
export async function firstJobModerated(companyId: string): Promise<boolean> {
  const rows = await getDb().execute(sql`
    select 1 from public.job_status_history h
    join public.jobs j on j.id = h.job_id
    where j.company_id = ${companyId}
      and h.from_status = 'pending_moderation'
      and h.to_status = 'published'
      and h.actor_id is not null
    limit 1
  `);
  return rows.length > 0;
}

/**
 * Moves an unverified or rejected company to `pending_verification` and
 * queues it for the admin, unless it is already waiting (14.1).
 */
export async function submitForReview(companyId: string) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(companies)
      .set({ status: "pending_verification", updatedAt: new Date() })
      .where(
        and(
          eq(companies.id, companyId),
          sql`${companies.status} in ('unverified', 'rejected')`,
        ),
      )
      .returning({ id: companies.id });
    if (!row) return false;
    await companiesPorts().enqueueModeration(
      {
        entityType: "company",
        entityId: companyId,
        reason: "verification_review",
        riskFlags: [],
      },
      tx,
    );
    return true;
  });
}

export type TrustedRow = {
  id: string;
  status: string;
  isTrusted: boolean;
  everPublishedJobs: number;
  applications: number;
  medianFirstActionDays: number | null;
};

/**
 * Inputs of 14.2 for verified companies and for any company still flagged.
 * First employer action = first status change after `applied` that the
 * candidate did not make; unanswered applications count until now.
 */
export async function trustedCandidates(now: Date): Promise<TrustedRow[]> {
  const rows = await getDb().execute<{
    id: string;
    status: string;
    is_trusted: boolean;
    ever_published: number;
    applications: number;
    median_days: number | null;
  }>(sql`
    with first_action as (
      select a.id, a.created_at, j.company_id,
        (select min(h.created_at) from public.application_status_history h
          where h.application_id = a.id
            and h.to_status not in ('applied', 'withdrawn')
            and h.actor_id is distinct from a.candidate_id) as acted_at
      from public.applications a
      join public.jobs j on j.id = a.job_id
    )
    select c.id, c.status, c.is_trusted,
      (select count(*)::int from public.jobs j
        where j.company_id = c.id and (j.published_at is not null or exists (
          select 1 from public.job_status_history h
          where h.job_id = j.id and h.to_status = 'published'))) as ever_published,
      (select count(*)::int from first_action f where f.company_id = c.id) as applications,
      (select percentile_cont(0.5) within group (order by
          extract(epoch from (coalesce(f.acted_at, ${now.toISOString()}::timestamptz) - f.created_at)) / 86400)
        from first_action f where f.company_id = c.id) as median_days
    from public.companies c
    where c.origin = 'internal' and (c.status = 'verified' or c.is_trusted)
  `);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    isTrusted: row.is_trusted,
    everPublishedJobs: Number(row.ever_published),
    applications: Number(row.applications),
    medianFirstActionDays:
      row.median_days === null ? null : Number(row.median_days),
  }));
}

export async function setTrusted(
  companyId: string,
  trusted: boolean,
  now: Date,
) {
  await getDb()
    .update(companies)
    .set({ isTrusted: trusted, trustedAt: trusted ? now : null })
    .where(eq(companies.id, companyId));
}

/** 14.2: confirmed reports about the company or its jobs since `since`. */
export async function confirmedReportsSince(
  companyId: string,
  since: Date,
): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n from public.reports r
    where r.status = 'confirmed' and r.decided_at >= ${since.toISOString()}::timestamptz
      and (
        (r.entity_type = 'company' and r.entity_id = ${companyId})
        or (r.entity_type = 'job' and r.entity_id in (
          select id from public.jobs where company_id = ${companyId}))
      )
  `);
  return Number(rows[0]?.n ?? 0);
}
