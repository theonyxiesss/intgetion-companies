/**
 * Free-mail domains (14.1, 14.3): rejected for company verification and
 * counted as a risk flag for job creators. Lower case, no subdomains.
 */
export const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "mail.com",
  "zoho.com",
  "yandex.ru",
  "yandex.com",
  "ya.ru",
  "mail.ru",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "rambler.ru",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "qq.com",
  "163.com",
  "126.com",
] as const;

const FREE = new Set<string>(FREE_EMAIL_DOMAINS);

/** The domain part of an email, lower-cased; null when there is none. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 1) return null;
  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() || null
  );
}

export function isFreeEmailDomain(domainOrEmail: string | null | undefined) {
  const domain = domainOrEmail?.includes("@")
    ? emailDomain(domainOrEmail)
    : domainOrEmail?.trim().toLowerCase();
  return Boolean(domain && FREE.has(domain));
}
