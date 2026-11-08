import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies-schema";
import { verificationMethod, verificationStatus } from "./enums";

/** 14.1: one row per verification attempt; the token is stored hashed. */
export const companyVerifications = pgTable(
  "company_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    method: verificationMethod("method").notNull(),
    target: text("target").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: verificationStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("company_verifications_company_idx").on(
      table.companyId,
      table.createdAt.desc(),
    ),
  ],
);
