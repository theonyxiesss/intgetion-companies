import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companyOrigin, companySize, companyStatus, memberRole } from "./enums";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    domain: text("domain"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    telegramUrl: text("telegram_url"),
    xUrl: text("x_url"),
    description: text("description"),
    logoPath: text("logo_path"),
    country: text("country"),
    size: companySize("size"),
    legalName: text("legal_name"),
    registrationNumber: text("registration_number"),
    status: companyStatus("status").notNull().default("unverified"),
    origin: companyOrigin("origin").notNull().default("internal"),
    isTrusted: boolean("is_trusted").notNull().default(false),
    trustedAt: timestamp("trusted_at", { withTimezone: true }),
    /** Morning briefs about candidates (D368); owner or admin switches it. */
    agentBriefsEnabled: boolean("agent_briefs_enabled")
      .notNull()
      .default(false),
    /** IANA zone for the employer brief slot; NULL means `europe` (0040). */
    timezone: text("timezone"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("companies_domain_idx")
      .on(table.domain)
      .where(sql`${table.domain} is not null`),
    index("companies_status_idx").on(table.status),
  ],
);

export const companyMembers = pgTable(
  "company_members",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull(),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.userId] }),
    index("company_members_user_idx").on(table.userId, table.createdAt),
  ],
);

export const employerProfiles = pgTable("employer_profiles", {
  userId: uuid("user_id")
    .primaryKey(),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

