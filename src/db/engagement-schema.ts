import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** A problem left on /services (D413, D417). Not a job. */
export const engagementBriefs = pgTable(
  "engagement_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    task: text("task").notNull(),
    reply: text("reply").notNull(),
    organization: text("organization"),
    budget: text("budget"),
    duration: text("duration"),
    startWhen: text("start_when"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("engagement_briefs_created_idx").on(table.createdAt)],
);
