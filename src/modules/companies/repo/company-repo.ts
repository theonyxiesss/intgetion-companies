import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@intgetion/kit";
import {
  companies,
  companyMembers,
  employerProfiles,
} from "../../../db/companies-schema";
import { companiesPorts } from "../../../ports";
import type { CreateCompanyInput, PatchCompanyInput } from "../schemas";
import { isPossibleDuplicate } from "../service/duplicate";

export type CompanyRow = typeof companies.$inferSelect;
export type CompanySummary = Pick<
  CompanyRow,
  | "id"
  | "name"
  | "slug"
  | "domain"
  | "websiteUrl"
  | "linkedinUrl"
  | "telegramUrl"
  | "xUrl"
  | "description"
  | "logoPath"
  | "country"
  | "size"
  | "status"
  | "origin"
>;

function slugify(name: string) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return slug || "company";
}

export async function findMemberRole(companyId: string, userId: string) {
  const rows = await getDb()
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

export async function createCompany(userId: string, input: CreateCompanyInput) {
  const db = getDb();
  const domain =
    input.domain
      ?.trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "") || null;
  const slug = slugify(input.name);
  const result = await db.transaction(async (tx) => {
    const similar = await tx.execute<{
      id: string;
      domain: string | null;
      similarity: number;
    }>(sql`
      select id, domain, public.skill_similarity(name, ${input.name}) as similarity
      from public.companies
      where (${domain}::text is not null and domain = ${domain})
         or public.skill_similarity(name, ${input.name}) >= 0.8
      order by (domain = ${domain}) desc nulls last, similarity desc limit 1
    `);
    const [company] = await tx
      .insert(companies)
      .values({
        name: input.name,
        slug: `${slug}-${randomUUID().slice(0, 8)}`,
        domain,
        websiteUrl: input.websiteUrl ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        telegramUrl: input.telegramUrl ?? null,
        xUrl: input.xUrl ?? null,
        description: input.description ?? null,
        country: input.country?.toUpperCase() ?? null,
        timezone: input.timezone ?? null,
        size: input.size ?? null,
        createdBy: userId,
      })
      .returning();
    if (!company) throw new Error("Company insert returned no row");
    await tx
      .insert(companyMembers)
      .values({ companyId: company.id, userId, role: "owner" });
    await tx.insert(employerProfiles).values({ userId }).onConflictDoNothing();
    if (
      similar.length &&
      isPossibleDuplicate(
        domain,
        similar[0]?.domain,
        Number(similar[0]?.similarity ?? 0),
      )
    ) {
      await companiesPorts().enqueueModeration(
        {
          entityType: "company",
          entityId: company.id,
          reason: "possible_duplicate",
          riskFlags: ["possible_duplicate"],
        },
        tx,
      );
    }
    return company;
  });
  return result;
}

export async function findCompanyBySlug(
  slug: string,
): Promise<CompanySummary | null> {
  const rows = await getDb()
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      domain: companies.domain,
      websiteUrl: companies.websiteUrl,
      linkedinUrl: companies.linkedinUrl,
      telegramUrl: companies.telegramUrl,
      xUrl: companies.xUrl,
      description: companies.description,
      logoPath: companies.logoPath,
      country: companies.country,
      size: companies.size,
      status: companies.status,
      origin: companies.origin,
    })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCompanyById(id: string): Promise<CompanyRow | null> {
  const rows = await getDb()
    .select()
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberUserIds(
  companyId: string,
  roles?: readonly ("owner" | "admin" | "recruiter" | "member")[],
) {
  const rows = await getDb()
    .select({
      userId: companyMembers.userId,
      role: companyMembers.role,
    })
    .from(companyMembers)
    .where(eq(companyMembers.companyId, companyId));
  return rows
    .filter((row) => !roles || roles.includes(row.role))
    .map((row) => row.userId);
}

/** True when the person is a member of any company (D506). */
export async function hasMembership(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(eq(companyMembers.userId, userId))
    .limit(1);
  return rows.length > 0;
}

export async function findCompaniesForUser(userId: string) {
  return getDb()
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      role: companyMembers.role,
      origin: companies.origin,
      websiteUrl: companies.websiteUrl,
      linkedinUrl: companies.linkedinUrl,
      telegramUrl: companies.telegramUrl,
      xUrl: companies.xUrl,
      description: companies.description,
      domain: companies.domain,
      logoPath: companies.logoPath,
      country: companies.country,
      size: companies.size,
      status: companies.status,
      agentBriefsEnabled: companies.agentBriefsEnabled,
      timezone: companies.timezone,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(eq(companyMembers.userId, userId));
}

export async function updateCompany(id: string, input: PatchCompanyInput) {
  const values = {
    ...input,
    country: input.country?.toUpperCase() ?? input.country,
  };
  const rows = await getDb()
    .update(companies)
    .set(values)
    .where(eq(companies.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function setLogoPath(id: string, logoPath: string) {
  const rows = await getDb()
    .update(companies)
    .set({ logoPath })
    .where(eq(companies.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function setCompanyStatus(
  id: string,
  status:
    | "unverified"
    | "pending_verification"
    | "verified"
    | "rejected"
    | "suspended",
) {
  const rows = await getDb()
    .update(companies)
    .set({ status })
    .where(eq(companies.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function listCompanyMembers(companyId: string) {
  return getDb().execute<{
    user_id: string;
    role: "owner" | "admin" | "recruiter" | "member";
    full_name: string | null;
    auth_uid: string;
  }>(sql`
    select m.user_id, m.role,
      up.display_name as full_name, u.auth_uid
    from public.company_members m
    join public.users u on u.id = m.user_id
    left join public.user_profiles up on up.user_id = m.user_id
    where m.company_id = ${companyId}
    order by case m.role
      when 'owner' then 0
      when 'admin' then 1
      else 2
    end, m.created_at
  `);
}

export async function addCompanyMember(
  companyId: string,
  userId: string,
  role: "admin" | "recruiter" | "member" = "member",
  cap = 2,
) {
  return getDb().transaction(async (tx) => {
    const companyRows = await tx
      .select({ origin: companies.origin })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("update");
    if (!companyRows[0] || companyRows[0].origin === "imported") return false;
    const existing = await tx
      .select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      )
      .limit(1);
    if (existing[0]) return "already" as const;
    const counted = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from public.company_members
      where company_id = ${companyId}
    `);
    if (Number(counted[0]?.n ?? 0) >= cap) return "full" as const;
    await tx.insert(companyMembers).values({ companyId, userId, role });
    return "added" as const;
  });
}

/** No invitation/member-management endpoint is exposed in 3A; retained for the service rule and integration coverage. */
export async function removeMember(companyId: string, userId: string) {
  return getDb().transaction(async (tx) => {
    const companyRows = await tx
      .select({ origin: companies.origin })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("update");
    if (!companyRows[0] || companyRows[0].origin === "imported") return false;
    const memberRows = await tx
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      )
      .for("update");
    if (memberRows[0]?.role === "owner") {
      const owners = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, "owner"),
          ),
        );
      if (owners[0]?.count <= 1) return false;
    }
    await tx
      .delete(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      );
    return true;
  });
}

/** The agent flag of every company where this user is owner or admin (D368). */
export async function setAgentBriefsForManagedCompanies(
  userId: string,
  enabled: boolean,
): Promise<number> {
  const rows = await getDb().execute<{ id: string }>(sql`
    update public.companies c
    set agent_briefs_enabled = ${enabled}, updated_at = now()
    from public.company_members cm
    where cm.company_id = c.id and cm.user_id = ${userId}
      and cm.role in ('owner', 'admin')
    returning c.id
  `);
  return rows.length;
}
