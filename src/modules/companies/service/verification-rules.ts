import { emailDomain, isFreeEmailDomain } from "../lib/free-email-domains";
import { HttpError } from "@intgetion/kit";

/** Pure rules of 14.1 and 14.2 (10B). */

export const VERIFICATION_TTL_MS = 72 * 60 * 60 * 1000;
export const REAPPLY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const DNS_RECORD_PREFIX = "intgetion-verify=";

export type VerificationMethod = "corporate_email" | "dns_txt";

const normalizeDomain = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, "");

/** `a@team.example.com` belongs to `example.com`; `a@notexample.com` does not. */
export function belongsToDomain(host: string, domain: string): boolean {
  const h = normalizeDomain(host);
  const d = normalizeDomain(domain);
  return h === d || h.endsWith(`.${d}`);
}

/**
 * The target to verify: a corporate email on the company domain, or the
 * domain itself for DNS. Free-mail domains never verify a company.
 */
export function verificationTarget(
  method: VerificationMethod,
  target: string | undefined,
  companyDomain: string | null,
): string {
  if (!companyDomain) {
    throw new HttpError(
      422,
      "DOMAIN_REQUIRED",
      "Set the company domain before verification",
    );
  }
  const domain = normalizeDomain(companyDomain);
  if (isFreeEmailDomain(domain)) {
    throw new HttpError(
      422,
      "FREE_EMAIL_DOMAIN",
      "A free email domain cannot verify a company",
    );
  }
  if (method === "dns_txt") return domain;
  const email = target?.trim().toLowerCase() ?? "";
  const host = emailDomain(email);
  if (!host || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter a corporate email");
  }
  if (isFreeEmailDomain(host)) {
    throw new HttpError(
      422,
      "FREE_EMAIL_DOMAIN",
      "A free email domain cannot verify a company",
    );
  }
  if (!belongsToDomain(host, domain)) {
    throw new HttpError(
      422,
      "DOMAIN_MISMATCH",
      "The email must be on the company domain",
    );
  }
  return email;
}

/**
 * Who may ask: an unverified company, or a rejected one at most once in
 * 7 days (4.2 `rejected → pending_verification`).
 */
export function assertCanRequest(
  status: string,
  lastRequestAt: Date | null,
  now: Date,
) {
  if (status === "unverified") return;
  if (status === "rejected") {
    if (
      lastRequestAt &&
      now.getTime() - lastRequestAt.getTime() < REAPPLY_AFTER_MS
    ) {
      throw new HttpError(
        409,
        "REAPPLY_TOO_SOON",
        "A rejected company can apply again 7 days after the last request",
      );
    }
    return;
  }
  throw new HttpError(
    409,
    "INVALID_TRANSITION",
    "This company cannot request verification now",
  );
}

/** 14.1 step 2: legal name, country and a website on the company domain. */
export function requisitesComplete(company: {
  legalName: string | null;
  country: string | null;
  websiteUrl: string | null;
  domain: string | null;
}): boolean {
  if (!company.legalName?.trim() || !company.country?.trim()) return false;
  if (!company.websiteUrl || !company.domain) return false;
  try {
    const host = new URL(company.websiteUrl).hostname.replace(/^www\./, "");
    return normalizeDomain(host) === normalizeDomain(company.domain);
  } catch {
    return false;
  }
}

export function dnsRecordValue(token: string): string {
  return `${DNS_RECORD_PREFIX}${token}`;
}

/** TXT records come as chunks; a long record is split across them. */
export function txtHasToken(records: string[][], token: string): boolean {
  const wanted = dnsRecordValue(token);
  return records.some((chunks) => chunks.join("").trim() === wanted);
}

export type TrustedInput = {
  everPublishedJobs: number;
  /** null when the reports table is not there yet: fail closed (D133). */
  confirmedReports90d: number | null;
  applications: number;
  medianFirstActionDays: number | null;
};

/** 14.2: all three conditions; any violation drops the flag. */
export function deservesTrusted(input: TrustedInput): boolean {
  if (input.everPublishedJobs < 5) return false;
  if (input.confirmedReports90d === null || input.confirmedReports90d > 0) {
    return false;
  }
  if (input.applications >= 10) {
    return (
      input.medianFirstActionDays !== null && input.medianFirstActionDays <= 7
    );
  }
  return true;
}
