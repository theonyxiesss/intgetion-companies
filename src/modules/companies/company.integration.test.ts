import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, HttpError } from "@intgetion/kit";
import {
  addCompanyMember,
  changeCompanyStatus,
  confirmVerification,
  createCompany,
  editCompany,
  findMemberRole,
  removeCompanyMember,
  requestVerification,
  setCompaniesPorts,
  type AuditEntry,
  type VerificationMailer,
} from "./service";

const ownerId = randomUUID();
const memberId = randomUUID();
const outsiderId = randomUUID();
const extraId = randomUUID();
const internalCompanyId = randomUUID();
const importedCompanyId = randomUUID();
const emailCompanyId = randomUUID();
const token = ownerId.slice(0, 8);
const emailDomain = `mail-${token}.example`;
const created: string[] = [];

const audits: AuditEntry[] = [];
const queued: { entityId: string; reason: string; riskFlags: string[]; tx: unknown }[] = [];
const limited = new Set<string>();
const sentLinks: string[] = [];
const mailer: VerificationMailer = async ({ link }) => {
  sentLinks.push(link);
  return true;
};

setCompaniesPorts({
  recordAudit: async (entry) => {
    audits.push(entry);
  },
  rateLimit: async (bucket, key) => {
    if (limited.has(`${bucket}:${key}`)) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests");
    }
  },
  notify: async () => {},
  enqueueModeration: async (input, tx) => {
    queued.push({ ...input, tx });
  },
  uploadLogo: async (path) => path,
  downloadLogo: async () => null,
});

const actor = (id: string) => ({ id, locale: "en" });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "http://127.0.0.1:3000";
  const db = getDb();
  await db.execute(sql`
    insert into public.users (id, auth_uid) values
      (${ownerId}, ${randomUUID()}), (${memberId}, ${randomUUID()}),
      (${outsiderId}, ${randomUUID()}), (${extraId}, ${randomUUID()})
  `);
  await db.execute(sql`
    insert into public.companies (id, name, slug, origin, created_by, domain)
    values (${internalCompanyId}, 'Integration Company', ${`it-${internalCompanyId}`}, 'internal', ${ownerId}, null),
           (${importedCompanyId}, 'Imported Company', ${`it-${importedCompanyId}`}, 'imported', null, null),
           (${emailCompanyId}, ${`Mail Co ${token}`}, ${`mail-${token}`}, 'internal', ${ownerId}, ${emailDomain})
  `);
  await db.execute(sql`
    insert into public.company_members (company_id, user_id, role)
    values (${internalCompanyId}, ${ownerId}, 'owner'), (${emailCompanyId}, ${ownerId}, 'owner')
  `);
});

afterAll(async () => {
  const db = getDb();
  const ids = [internalCompanyId, importedCompanyId, emailCompanyId, ...created];
  await db.execute(sql`delete from public.companies where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  await db.execute(sql`delete from public.users where id in (${ownerId}, ${memberId}, ${outsiderId}, ${extraId})`);
});

beforeEach(() => {
  audits.length = 0;
  queued.length = 0;
});

describe("companies in Postgres", () => {
  it("looks up membership and hides non-members", async () => {
    expect(await findMemberRole(internalCompanyId, ownerId)).toBe("owner");
    expect(await findMemberRole(internalCompanyId, outsiderId)).toBeNull();
  });

  it("keeps the seat limit, refuses imported companies and the last owner", async () => {
    await addCompanyMember(internalCompanyId, memberId);
    expect(await findMemberRole(internalCompanyId, memberId)).toBe("member");
    await expect(addCompanyMember(internalCompanyId, extraId)).rejects.toMatchObject({
      status: 409,
      code: "SEAT_LIMIT",
    });
    await expect(addCompanyMember(importedCompanyId, outsiderId)).rejects.toMatchObject({ status: 403 });
    await expect(removeCompanyMember(internalCompanyId, ownerId)).rejects.toMatchObject({ status: 403 });
  });

  it("audits status changes through the port", async () => {
    await changeCompanyStatus(internalCompanyId, ownerId, "pending_verification");
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: "company.status_changed",
        diff: { from: "unverified", to: "pending_verification" },
      }),
    );
  });

  it("queues a same-domain company as a possible duplicate inside the create transaction", async () => {
    const domain = `duplicate-${randomUUID()}.example.com`;
    const first = await createCompany(actor(ownerId), { name: "Duplicate Detection Company", domain });
    const second = await createCompany(actor(ownerId), { name: "Duplicate Detection Company", domain });
    created.push(first.id, second.id);
    expect(second.id).not.toBe(first.id);
    const flagged = queued.find((item) => item.entityId === second.id);
    expect(flagged).toMatchObject({ reason: "possible_duplicate", riskFlags: ["possible_duplicate"] });
    expect(flagged?.tx).toBeTruthy();
    expect(await findMemberRole(second.id, ownerId)).toBe("owner");
    const employer = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from public.employer_profiles where user_id = ${ownerId}`,
    );
    expect(employer[0]?.n).toBe(1);
  });

  it("refuses free mail and other people, confirms by the emailed link, stores only a hash", async () => {
    await expect(
      requestVerification(actor(outsiderId), emailCompanyId, { method: "corporate_email", target: `hr@${emailDomain}` }, { mailer }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requestVerification(actor(ownerId), emailCompanyId, { method: "corporate_email", target: "boss@gmail.com" }, { mailer }),
    ).rejects.toMatchObject({ code: "FREE_EMAIL_DOMAIN" });

    const result = await requestVerification(
      actor(ownerId),
      emailCompanyId,
      { method: "corporate_email", target: `HR@${emailDomain}` },
      { mailer },
    );
    expect(result).toMatchObject({ emailSent: true });
    const emailed = new URL(sentLinks.at(-1)!).searchParams.get("token")!;
    const stored = await getDb().execute<{ token_hash: string }>(
      sql`select token_hash from public.company_verifications where company_id = ${emailCompanyId}`,
    );
    expect(stored.map((row) => row.token_hash)).not.toContain(emailed);

    await expect(confirmVerification(actor(ownerId), emailCompanyId, "x".repeat(43))).rejects.toMatchObject({ status: 404 });
    const state = await confirmVerification(actor(ownerId), emailCompanyId, emailed);
    expect(state.steps).toMatchObject({ domainConfirmed: true, requisitesComplete: false });
  });

  it("goes to the review queue once requisites are complete", async () => {
    await editCompany(emailCompanyId, actor(ownerId), {
      legalName: `Mail Co ${token} Ltd`,
      country: "de",
      websiteUrl: `https://www.${emailDomain}/`,
    });
    const rows = await getDb().execute<{ status: string }>(
      sql`select status from public.companies where id = ${emailCompanyId}`,
    );
    expect(rows[0]?.status).toBe("pending_verification");
    expect(queued).toContainEqual(expect.objectContaining({ entityId: emailCompanyId, reason: "verification_review" }));
  });

  it("stops a request when the platform rate limit says no", async () => {
    const fresh = await createCompany(actor(ownerId), {
      name: `Limited Co ${token}`,
      domain: `limited-${token}.example`,
    });
    created.push(fresh.id);
    limited.add(`verificationRequest:${fresh.id}`);
    await expect(
      requestVerification(actor(ownerId), fresh.id, { method: "dns_txt" }, { mailer }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
