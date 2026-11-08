import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { companiesPorts } from "../../../ports";
import {
  parseEngagementBrief,
  type EngagementBriefField,
  type EngagementBriefInput,
} from "../engagement-brief";

/** Five descriptions an hour from one address. The shared rate file is not ours to edit. */
const BRIEF_LIMIT = { limit: 5, windowSeconds: 60 * 60 };

/** True when migration 0048 is not on this database yet. */
export function isMissingEngagementTable(error: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      parts.push(String((current as { code: unknown }).code));
    }
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    break;
  }
  const text = parts.join(" ");
  return (
    text.includes("42P01") ||
    /relation ["']?public\.engagement_briefs["']? does not exist/i.test(text) ||
    /relation ["']?engagement_briefs["']? does not exist/i.test(text)
  );
}

export async function limitEngagementBrief(ip: string): Promise<void> {
  await companiesPorts().rateLimit("engagementBrief", ip, BRIEF_LIMIT);
}

export async function saveEngagementBrief(
  input: EngagementBriefInput & { userId: string | null },
): Promise<{ ok: true } | { ok: false; field: EngagementBriefField }> {
  const parsed = parseEngagementBrief(input);
  if (!parsed.ok) return parsed;
  await getDb().execute(sql`
    insert into public.engagement_briefs (
      user_id, task, reply, organization, budget, duration, start_when
    )
    values (
      ${input.userId},
      ${parsed.task},
      ${parsed.reply},
      ${parsed.organization},
      ${parsed.budget},
      ${parsed.duration},
      ${parsed.start}
    )
  `);
  return { ok: true };
}

export type EngagementBriefRow = {
  id: string;
  task: string;
  reply: string;
  organization: string | null;
  budget: string | null;
  duration: string | null;
  start: string | null;
  createdAt: string;
};

export async function listEngagementBriefs(): Promise<EngagementBriefRow[]> {
  const rows = await getDb().execute<{
    id: string;
    task: string;
    reply: string;
    organization: string | null;
    budget: string | null;
    duration: string | null;
    start_when: string | null;
    created_at: string;
  }>(sql`
    select id, task, reply, organization, budget, duration, start_when, created_at
    from public.engagement_briefs
    order by created_at desc
    limit 100
  `);
  return rows.map((row) => ({
    id: row.id,
    task: row.task,
    reply: row.reply,
    organization: row.organization,
    budget: row.budget,
    duration: row.duration,
    start: row.start_when,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
