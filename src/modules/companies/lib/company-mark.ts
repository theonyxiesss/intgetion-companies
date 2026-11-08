export const COMPANY_MARK_COUNT = 4;

/** Stable slot 0–3 for a company that has not uploaded a logo. */
export function companyMarkIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * (i + 1)) % COMPANY_MARK_COUNT;
  }
  return hash;
}

/** Uploaded logos are a random UUID WebP. Anything else is not fetched. */
export function isSafeLogoPath(path: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i.test(
    path,
  );
}

export function companyLogoSrc(
  slug: string,
  logoPath: string | null | undefined,
): string | null {
  if (!logoPath || !isSafeLogoPath(logoPath)) return null;
  return `/api/companies/${encodeURIComponent(slug)}/logo`;
}

/** Only http(s) links are shown. Empty and other schemes stay hidden. */
export function publicHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}
