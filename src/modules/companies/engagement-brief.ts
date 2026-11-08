/** A problem described on /services. Not a job post (D413, D417). */

const TASK_MIN = 20;
const TASK_MAX = 4000;
const REPLY_MAX = 200;
const ORG_MAX = 120;
const NOTE_MAX = 80;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEGRAM = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

export type EngagementBriefField =
  "task" | "reply" | "organization" | "budget" | "duration" | "start";

export type EngagementBriefInput = {
  task: string;
  reply: string;
  organization?: string | null;
  budget?: string | null;
  duration?: string | null;
  start?: string | null;
};

export type EngagementBrief =
  | {
      ok: true;
      task: string;
      reply: string;
      organization: string | null;
      budget: string | null;
      duration: string | null;
      start: string | null;
    }
  | { ok: false; field: EngagementBriefField };

/** Email, or a Telegram name as `@handle`. Anything else is refused. */
export function normalizeReply(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > REPLY_MAX) return null;
  if (!value.startsWith("@") && EMAIL.test(value)) return value.toLowerCase();
  const handle =
    value
      .replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "")
      .replace(/^(?:t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0] ?? "";
  if (!TELEGRAM.test(handle)) return null;
  return `@${handle}`;
}

export function parseEngagementBrief(
  input: EngagementBriefInput,
): EngagementBrief {
  const task = input.task.trim();
  if (task.length < TASK_MIN || task.length > TASK_MAX) {
    return { ok: false, field: "task" };
  }
  const reply = normalizeReply(input.reply);
  if (!reply) return { ok: false, field: "reply" };
  const organization = optionalNote(input.organization, ORG_MAX);
  if (organization === false) return { ok: false, field: "organization" };
  const budget = optionalNote(input.budget, NOTE_MAX);
  if (budget === false) return { ok: false, field: "budget" };
  const duration = optionalNote(input.duration, NOTE_MAX);
  if (duration === false) return { ok: false, field: "duration" };
  const start = optionalNote(input.start, NOTE_MAX);
  if (start === false) return { ok: false, field: "start" };
  return {
    ok: true,
    task,
    reply,
    organization,
    budget,
    duration,
    start,
  };
}

/** Blank becomes null. Longer than `max` is refused. */
function optionalNote(
  raw: string | null | undefined,
  max: number,
): string | null | false {
  const value = (raw ?? "").trim();
  if (value.length > max) return false;
  return value.length > 0 ? value : null;
}
