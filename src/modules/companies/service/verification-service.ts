import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import {
  forbidden,
  HttpError,
  localePrefix,
  logger,
  notFound,
  siteEmailHtml,
  siteUrl,
  toAppLocale,
} from "@intgetion/kit";
import { messagesFor } from "../../../i18n/messages";
import { companiesPorts, type CompanyActor as CurrentUser } from "../../../ports";
import * as companyRepo from "../repo/company-repo";
import * as repo from "../repo/verification-repo";
import { changeCompanyStatus, findMemberRole } from "./company-service";
import {
  assertCanRequest,
  deservesTrusted,
  dnsRecordValue,
  requisitesComplete,
  txtHasToken,
  VERIFICATION_TTL_MS,
  verificationTarget,
  type VerificationMethod,
} from "./verification-rules";

/** Sends the corporate-email link; false when no provider is configured. */
export type VerificationMailer = (message: {
  to: string;
  link: string;
  locale: string;
  companyName: string;
}) => Promise<boolean>;

const SUBJECT: Record<string, string> = {
  en: "Confirm your company domain",
  ru: "Подтвердите домен компании",
  es: "Confirma el dominio de tu empresa",
  "pt-BR": "Confirme o domínio da sua empresa",
  de: "Bestätigen Sie die Domain Ihres Unternehmens",
  fr: "Confirmez le domaine de votre entreprise",
  it: "Conferma il dominio della tua azienda",
};
const BODY: Record<string, string> = {
  en: "Open this link within 72 hours to confirm that you work at",
  ru: "Откройте ссылку в течение 72 часов, чтобы подтвердить, что вы работаете в",
  es: "Abre este enlace en 72 horas para confirmar que trabajas en",
  "pt-BR": "Abra este link em até 72 horas para confirmar que você trabalha na",
  de: "Öffnen Sie diesen Link innerhalb von 72 Stunden, um zu bestätigen, dass Sie tätig sind bei",
  fr: "Ouvrez ce lien dans les 72 heures pour confirmer que vous travaillez chez",
  it: "Apri questo link entro 72 ore per confermare che lavori presso",
};
const ACTION: Record<string, string> = {
  en: "Confirm domain",
  ru: "Подтвердить домен",
  es: "Confirmar dominio",
  "pt-BR": "Confirmar domínio",
  de: "Domain bestätigen",
  fr: "Confirmer le domaine",
  it: "Conferma dominio",
};

/**
 * Resend over plain fetch when RESEND_API_KEY and EMAIL_FROM are set (15);
 * otherwise nothing leaves the server and the caller is told so (D131).
 */
export const resendVerificationMailer: VerificationMailer = async (message) => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  const locale = toAppLocale(message.locale);
  const text = `${BODY[locale]} ${message.companyName}:\n${message.link}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: SUBJECT[locale],
      text,
      html: siteEmailHtml({
        lang: locale,
        title: SUBJECT[locale],
        body: `${BODY[locale]} ${message.companyName}.`,
        action: { href: message.link, label: ACTION[locale]! },
        fallbackLabel: messagesFor(locale).email.fallback,
      }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new HttpError(
      502,
      "EMAIL_FAILED",
      "The verification email could not be sent",
    );
  }
  return true;
};

export type TxtResolver = (domain: string) => Promise<string[][]>;

export const systemTxtResolver: TxtResolver = async (domain) => {
  try {
    return await resolveTxt(domain);
  } catch {
    return [];
  }
};

type Dependencies = {
  mailer: VerificationMailer;
  resolveTxt: TxtResolver;
  now: () => Date;
};

const defaults: Dependencies = {
  mailer: resendVerificationMailer,
  resolveTxt: systemTxtResolver,
  now: () => new Date(),
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

async function ownedCompany(user: CurrentUser, companyId: string) {
  const company = await companyRepo.findCompanyById(companyId);
  if (!company || company.origin === "imported") throw notFound();
  const role = await findMemberRole(companyId, user.id);
  if (!role) throw notFound();
  if (role !== "owner") throw forbidden();
  return company;
}

export type VerificationStateDto = {
  companyStatus: string;
  isTrusted: boolean;
  domain: string | null;
  requisites: { legalName: string; country: string; websiteUrl: string };
  steps: {
    domainConfirmed: boolean;
    requisitesComplete: boolean;
    firstJobModerated: boolean;
  };
  latest: {
    method: string;
    target: string;
    status: string;
    expiresAt: string;
    verifiedAt: string | null;
  } | null;
};

/** `GET /api/companies/:id/verification` — owner only. */
export async function getVerificationState(
  user: CurrentUser,
  companyId: string,
  now = new Date(),
): Promise<VerificationStateDto> {
  const company = await ownedCompany(user, companyId);
  const rejectedAt =
    company.status === "rejected" ? await repo.lastRejectedAt(companyId) : null;
  const [latest, domainConfirmed, firstJob] = await Promise.all([
    repo.latestVerification(companyId),
    repo.hasVerifiedDomain(companyId, rejectedAt),
    repo.firstJobModerated(companyId),
  ]);
  const expired =
    latest?.status === "pending" && latest.expiresAt.getTime() <= now.getTime();
  return {
    companyStatus: company.status,
    isTrusted: company.isTrusted,
    domain: company.domain,
    requisites: {
      legalName: company.legalName ?? "",
      country: company.country ?? "",
      websiteUrl: company.websiteUrl ?? "",
    },
    steps: {
      domainConfirmed,
      requisitesComplete: requisitesComplete(company),
      firstJobModerated: firstJob,
    },
    latest: latest
      ? {
          method: latest.method,
          target: latest.target,
          status: expired ? "expired" : latest.status,
          expiresAt: latest.expiresAt.toISOString(),
          verifiedAt: latest.verifiedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * `POST /api/companies/:id/verification` `{ method, target }` (14.1). The
 * token is mailed (email) or returned once as the TXT value (DNS); only
 * its hash is stored.
 */
export async function requestVerification(
  user: CurrentUser,
  companyId: string,
  input: { method: VerificationMethod; target?: string },
  overrides: Partial<Dependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  const company = await ownedCompany(user, companyId);
  const latest = await repo.latestVerification(companyId);
  assertCanRequest(company.status, latest?.createdAt ?? null, now);
  const target = verificationTarget(input.method, input.target, company.domain);
  await companiesPorts().rateLimit("verificationRequest", companyId);

  const token = randomBytes(32).toString("base64url");
  const row = await repo.createVerification({
    companyId,
    method: input.method,
    target,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
    createdBy: user.id,
  });
  await companiesPorts().recordAudit({
    actorId: user.id,
    action: "company.verification_requested",
    entityType: "company",
    entityId: companyId,
    diff: { method: input.method, verificationId: row.id },
  });

  const verification = {
    id: row.id,
    method: row.method,
    target: row.target,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  };
  if (input.method === "dns_txt") {
    return { verification, dnsRecord: dnsRecordValue(token) };
  }
  const locale = toAppLocale(user.locale);
  const link = `${siteUrl()}${localePrefix(locale)}/employer/company/verify?company=${companyId}&token=${token}`;
  const emailSent = await deps.mailer({
    to: target,
    link,
    locale,
    companyName: company.name,
  });
  if (!emailSent) {
    logger.warn(
      { companyId, verificationId: row.id },
      "verification email not sent: no email provider configured",
    );
  }
  return { verification, emailSent };
}

/**
 * `POST /api/companies/:id/verification/confirm` `{ token }`. Email: the
 * token from the link is the proof. DNS: the TXT record must be live.
 */
export async function confirmVerification(
  user: CurrentUser,
  companyId: string,
  token: string,
  overrides: Partial<Dependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  await ownedCompany(user, companyId);
  const row = await repo.findPendingByHash(companyId, hashToken(token));
  if (!row) throw notFound();
  if (row.expiresAt.getTime() <= now.getTime()) {
    await repo.setVerificationStatus(row.id, "expired", now);
    throw new HttpError(422, "TOKEN_EXPIRED", "The verification has expired");
  }
  if (
    row.method === "dns_txt" &&
    !txtHasToken(await deps.resolveTxt(row.target), token)
  ) {
    throw new HttpError(
      422,
      "DNS_RECORD_NOT_FOUND",
      "The TXT record was not found on the domain yet",
    );
  }
  await repo.setVerificationStatus(row.id, "verified", now);
  await companiesPorts().recordAudit({
    actorId: user.id,
    action: "company.verification_confirmed",
    entityType: "company",
    entityId: companyId,
    diff: { method: row.method, verificationId: row.id },
  });
  await submitIfReady(companyId, user.id);
  return getVerificationState(user, companyId, now);
}

/**
 * After steps 1 and 2 of 14.1 the company waits for the admin
 * (`pending_verification` + queue item). Called after a confirmation and
 * after every company edit; does nothing until both steps are done.
 */
export async function submitIfReady(companyId: string, actorId: string) {
  const company = await companyRepo.findCompanyById(companyId);
  if (!company || company.origin === "imported") return false;
  if (company.status !== "unverified" && company.status !== "rejected") {
    return false;
  }
  if (!requisitesComplete(company)) return false;
  const rejectedAt =
    company.status === "rejected" ? await repo.lastRejectedAt(companyId) : null;
  if (!(await repo.hasVerifiedDomain(companyId, rejectedAt))) return false;
  const submitted = await repo.submitForReview(companyId);
  if (submitted) {
    await companiesPorts().recordAudit({
      actorId,
      action: "company.status_changed",
      entityType: "company",
      entityId: companyId,
      diff: { from: company.status, to: "pending_verification" },
    });
  }
  return submitted;
}

/**
 * The admin approves a company waiting for verification (14.1 step 3 is
 * checked here): the domain is confirmed, requisites are complete and the
 * first job went through manual moderation.
 */
export async function approveCompanyVerification(
  companyId: string,
  adminId: string,
) {
  const company = await companyRepo.findCompanyById(companyId);
  if (!company) throw notFound();
  if (company.status !== "pending_verification") {
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "The company is not waiting for verification",
    );
  }
  const [domain, firstJob] = await Promise.all([
    repo.hasVerifiedDomain(companyId),
    repo.firstJobModerated(companyId),
  ]);
  if (!domain || !requisitesComplete(company) || !firstJob) {
    throw new HttpError(
      409,
      "VERIFICATION_INCOMPLETE",
      "Domain, requisites and a first moderated job are all required",
      { domain, requisites: requisitesComplete(company), firstJob },
    );
  }
  await changeCompanyStatus(companyId, adminId, "verified");
  await notifyVerificationDecided(companyId, "verified");
}

/** Section 15: the owners learn the verification outcome (D127: never fails the caller). */
export async function notifyVerificationDecided(
  companyId: string,
  decision: "verified" | "rejected",
) {
  const company = await companyRepo.findCompanyById(companyId);
  if (!company) return;
  const owners = await companyRepo.listMemberUserIds(companyId, ["owner"]);
  await companiesPorts().notify("company.verification_decided", owners, {
    companyId,
    companyName: company.name,
    decision,
  });
}

/** Daily `/api/cron/trusted` (14.2); confirmed reports come from 4B (D84). */
export async function refreshTrustedFlags(
  now = new Date(),
  confirmedReports: (
    companyId: string,
    since: Date,
  ) => Promise<number | null> = repo.confirmedReportsSince,
) {
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  let granted = 0;
  let revoked = 0;
  for (const row of await repo.trustedCandidates(now)) {
    const trusted =
      row.status === "verified" &&
      deservesTrusted({
        everPublishedJobs: row.everPublishedJobs,
        confirmedReports90d: await confirmedReports(row.id, since),
        applications: row.applications,
        medianFirstActionDays: row.medianFirstActionDays,
      });
    if (trusted === row.isTrusted) continue;
    await repo.setTrusted(row.id, trusted, now);
    await companiesPorts().recordAudit({
      actorId: null,
      action: "company.trusted_changed",
      entityType: "company",
      entityId: row.id,
      diff: { from: row.isTrusted, to: trusted },
    });
    if (trusted) granted += 1;
    else revoked += 1;
  }
  return { granted, revoked };
}
