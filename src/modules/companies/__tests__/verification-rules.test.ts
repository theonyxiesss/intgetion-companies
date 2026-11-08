import { describe, expect, it } from "vitest";
import { isFreeEmailDomain } from "../lib/free-email-domains";
import {
  assertCanRequest,
  belongsToDomain,
  deservesTrusted,
  dnsRecordValue,
  requisitesComplete,
  txtHasToken,
  verificationTarget,
} from "../service/verification-rules";

const now = new Date("2026-10-03T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86400000);

describe("verificationTarget", () => {
  it("accepts an email on the company domain or a subdomain", () => {
    expect(
      verificationTarget("corporate_email", " HR@Example.com ", "example.com"),
    ).toBe("hr@example.com");
    expect(
      verificationTarget(
        "corporate_email",
        "a@team.example.com",
        "example.com",
      ),
    ).toBe("a@team.example.com");
  });

  it("rejects free mail, other domains and look-alikes", () => {
    expect(() =>
      verificationTarget("corporate_email", "boss@gmail.com", "example.com"),
    ).toThrow(expect.objectContaining({ code: "FREE_EMAIL_DOMAIN" }));
    expect(() =>
      verificationTarget("corporate_email", "a@notexample.com", "example.com"),
    ).toThrow(expect.objectContaining({ code: "DOMAIN_MISMATCH" }));
    expect(() =>
      verificationTarget("corporate_email", "not-an-email", "example.com"),
    ).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("uses the company domain for DNS and needs a non-free domain", () => {
    expect(verificationTarget("dns_txt", "ignored", "Example.COM.")).toBe(
      "example.com",
    );
    expect(() => verificationTarget("dns_txt", undefined, null)).toThrow(
      expect.objectContaining({ code: "DOMAIN_REQUIRED" }),
    );
    expect(() => verificationTarget("dns_txt", undefined, "gmail.com")).toThrow(
      expect.objectContaining({ code: "FREE_EMAIL_DOMAIN" }),
    );
  });

  it("covers the usual free domains", () => {
    for (const domain of [
      "gmail.com",
      "outlook.com",
      "yandex.ru",
      "mail.ru",
      "proton.me",
    ]) {
      expect(isFreeEmailDomain(`x@${domain}`)).toBe(true);
    }
    expect(isFreeEmailDomain("x@example.com")).toBe(false);
  });
});

describe("belongsToDomain", () => {
  it("matches the domain and its subdomains only", () => {
    expect(belongsToDomain("example.com", "example.com")).toBe(true);
    expect(belongsToDomain("mail.example.com", "example.com")).toBe(true);
    expect(belongsToDomain("badexample.com", "example.com")).toBe(false);
  });
});

describe("assertCanRequest", () => {
  it("lets unverified companies ask any time", () => {
    expect(() => assertCanRequest("unverified", days(0), now)).not.toThrow();
  });

  it("lets a rejected company ask again only after 7 days", () => {
    expect(() => assertCanRequest("rejected", days(6), now)).toThrow(
      expect.objectContaining({ code: "REAPPLY_TOO_SOON" }),
    );
    expect(() => assertCanRequest("rejected", days(7), now)).not.toThrow();
    expect(() => assertCanRequest("rejected", null, now)).not.toThrow();
  });

  it("refuses pending, verified and suspended companies", () => {
    for (const status of ["pending_verification", "verified", "suspended"]) {
      expect(() => assertCanRequest(status, null, now)).toThrow(
        expect.objectContaining({ status: 409 }),
      );
    }
  });
});

describe("requisitesComplete", () => {
  const base = {
    legalName: "Example GmbH",
    country: "DE",
    websiteUrl: "https://www.example.com/about",
    domain: "example.com",
  };
  it("needs all three fields with the website on the company domain", () => {
    expect(requisitesComplete(base)).toBe(true);
    expect(requisitesComplete({ ...base, legalName: " " })).toBe(false);
    expect(requisitesComplete({ ...base, country: null })).toBe(false);
    expect(
      requisitesComplete({ ...base, websiteUrl: "https://other.com" }),
    ).toBe(false);
    expect(requisitesComplete({ ...base, websiteUrl: "not a url" })).toBe(
      false,
    );
  });
});

describe("TXT records", () => {
  it("finds the token, also when the record is split into chunks", () => {
    const token = "a".repeat(43);
    expect(dnsRecordValue(token)).toBe(`intgetion-verify=${token}`);
    expect(
      txtHasToken([["v=spf1 -all"], [`intgetion-verify=${token}`]], token),
    ).toBe(true);
    expect(
      txtHasToken(
        [["intgetion-verify=", "a".repeat(20), "a".repeat(23)]],
        token,
      ),
    ).toBe(true);
    expect(txtHasToken([[`intgetion-verify=${token}x`]], token)).toBe(false);
  });
});

describe("deservesTrusted", () => {
  const good = {
    everPublishedJobs: 5,
    confirmedReports90d: 0,
    applications: 12,
    medianFirstActionDays: 3,
  };
  it("needs all conditions of 14.2", () => {
    expect(deservesTrusted(good)).toBe(true);
    expect(deservesTrusted({ ...good, everPublishedJobs: 4 })).toBe(false);
    expect(deservesTrusted({ ...good, confirmedReports90d: 1 })).toBe(false);
    expect(deservesTrusted({ ...good, medianFirstActionDays: 7.5 })).toBe(
      false,
    );
  });

  it("ignores response time below 10 applications", () => {
    expect(
      deservesTrusted({
        ...good,
        applications: 9,
        medianFirstActionDays: 30,
      }),
    ).toBe(true);
  });

  it("fails closed while reports cannot be counted", () => {
    expect(deservesTrusted({ ...good, confirmedReports90d: null })).toBe(false);
  });
});
