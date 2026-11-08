import { describe, expect, it } from "vitest";
import {
  COMPANY_MARK_COUNT,
  companyLogoSrc,
  companyMarkIndex,
  isSafeLogoPath,
  publicHttpUrl,
} from "../lib/company-mark";

describe("company mark", () => {
  it("picks the same slot for the same company and stays inside the set", () => {
    const seen = new Set<number>();
    for (const id of [
      "acme",
      "imp-ihsan",
      "00000000-0000-4000-8000-000000000001",
    ]) {
      const slot = companyMarkIndex(id);
      expect(slot).toBe(companyMarkIndex(id));
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(COMPANY_MARK_COUNT);
      seen.add(slot);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("builds a public logo URL only for a stored WebP name", () => {
    const path = "11111111-1111-4111-8111-111111111111.webp";
    expect(isSafeLogoPath(path)).toBe(true);
    expect(companyLogoSrc("acme", path)).toBe("/api/companies/acme/logo");
    expect(companyLogoSrc("acme", null)).toBeNull();
    expect(companyLogoSrc("acme", "../secret.webp")).toBeNull();
  });

  it("keeps only http and https company links", () => {
    expect(publicHttpUrl("https://t.me/acme")).toBe("https://t.me/acme");
    expect(publicHttpUrl("")).toBeNull();
    expect(publicHttpUrl("javascript:alert(1)")).toBeNull();
    expect(publicHttpUrl("not a url")).toBeNull();
  });
});
