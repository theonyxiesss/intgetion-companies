import { pgEnum } from "drizzle-orm/pg-core";

export const companyStatus = pgEnum("company_status", [
  "unverified",
  "pending_verification",
  "verified",
  "rejected",
  "suspended",
]);
export const companyOrigin = pgEnum("company_origin", ["internal", "imported"]);
export const companySize = pgEnum("company_size", [
  "s1_10",
  "s11_50",
  "s51_200",
  "s201_1000",
  "s1000_plus",
]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "recruiter", "member"]);
export const verificationMethod = pgEnum("verification_method", ["corporate_email", "dns_txt"]);
export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "verified",
  "expired",
  "failed",
]);
