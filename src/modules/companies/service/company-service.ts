import { forbidden, HttpError, notFound } from "@intgetion/kit";
import { companiesPorts, type CompanyActor as CurrentUser } from "../../../ports";
import * as repo from "../repo/company-repo";
import { submitIfReady } from "./verification-service";
import type { CreateCompanyInput, PatchCompanyInput } from "../schemas";

export type { CompanyRow, CompanySummary } from "../repo/company-repo";
export const findMemberRole = repo.findMemberRole;
export const listMemberUserIds = repo.listMemberUserIds;

export function assertCompanyEditable(
  company: Pick<repo.CompanyRow, "origin">,
  role: string | null,
) {
  if (!role) throw notFound();
  if (company.origin === "imported")
    throw new HttpError(
      422,
      "IMPORTED_READONLY",
      "Imported companies cannot be edited",
    );
  if (role !== "owner" && role !== "admin") throw forbidden();
}

/**
 * An employer is a company member (D506). The soft account type chosen at
 * registration (D331) is gone; membership already decides the rights (D13).
 */
export async function isEmployer(userId: string): Promise<boolean> {
  return repo.hasMembership(userId);
}

export async function createCompany(
  user: CurrentUser,
  input: CreateCompanyInput,
) {
  return repo.createCompany(user.id, input);
}

export async function getPublicCompany(slug: string) {
  const company = await repo.findCompanyBySlug(slug);
  if (!company) throw notFound();
  return { company, jobs: [] as never[] };
}

export async function getCompaniesForUser(userId: string) {
  return repo.findCompaniesForUser(userId);
}

export function resolveEmployerCompany<
  T extends { id: string; origin: string },
>(companies: readonly T[], requestedCompanyId?: string) {
  const available = companies.filter(
    (company) => company.origin === "internal",
  );
  const selected = requestedCompanyId
    ? available.find((company) => company.id === requestedCompanyId)
    : available.length === 1
      ? available[0]
      : undefined;
  if (requestedCompanyId && !selected) throw notFound();
  return { companies: available, selected: selected ?? null };
}

export async function setCompanyLogo(
  companyId: string,
  bytes: Buffer,
  mime: string,
  storage: import("./logo-service").LogoStorage,
) {
  const { storeLogo } = await import("./logo-service");
  const saved = await storeLogo(bytes, mime, storage);
  const updated = await repo.setLogoPath(companyId, saved.logoPath);
  if (!updated) throw notFound();
  return saved;
}

export async function editCompany(
  companyId: string,
  user: CurrentUser,
  input: PatchCompanyInput,
) {
  const company = await repo.findCompanyById(companyId);
  const role = await findMemberRole(companyId, user.id);
  if (!company) throw notFound();
  assertCompanyEditable(company, role);
  const updated = await repo.updateCompany(companyId, input);
  if (!updated) throw notFound();
  // Requisites may complete step 2 of 14.1 (10B).
  if (await submitIfReady(companyId, user.id)) {
    return (await repo.findCompanyById(companyId)) ?? updated;
  }
  return updated;
}

export async function assertCanEditCompany(
  companyId: string,
  user: CurrentUser,
) {
  const company = await repo.findCompanyById(companyId);
  const role = await findMemberRole(companyId, user.id);
  if (!company) throw notFound();
  assertCompanyEditable(company, role);
  return company;
}

export async function recordCompanyStatusChange(
  companyId: string,
  actorId: string,
  from: string,
  to: string,
) {
  await companiesPorts().recordAudit({
    actorId,
    action: "company.status_changed",
    entityType: "company",
    entityId: companyId,
    diff: { from, to },
  });
}

export async function changeCompanyStatus(
  companyId: string,
  actorId: string,
  status:
    | "unverified"
    | "pending_verification"
    | "verified"
    | "rejected"
    | "suspended",
) {
  const current = await repo.findCompanyById(companyId);
  if (!current) throw notFound();
  const updated = await repo.setCompanyStatus(companyId, status);
  if (!updated) throw notFound();
  await recordCompanyStatusChange(companyId, actorId, current.status, status);
  return updated;
}

export async function removeCompanyMember(companyId: string, userId: string) {
  const removed = await repo.removeMember(companyId, userId);
  if (!removed)
    throw forbidden("Cannot remove the last owner or join an imported company");
}

export const listCompanyMembers = repo.listCompanyMembers;

export async function addCompanyMember(
  companyId: string,
  userId: string,
  cap = 2,
) {
  const added = await repo.addCompanyMember(companyId, userId, "member", cap);
  if (added === false) {
    throw forbidden("Cannot join an imported or unavailable company");
  }
  if (added === "full") {
    throw new HttpError(
      409,
      "SEAT_LIMIT",
      "This company is at its teammate limit",
    );
  }
  return added;
}

/**
 * Morning briefs about candidates (D368): only an owner or admin turns the
 * flag on or off, for each company they manage.
 */
export async function setOwnCompanyAgentBriefs(
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  const changed = await repo.setAgentBriefsForManagedCompanies(userId, enabled);
  if (changed === 0) throw forbidden();
  return enabled;
}
