import { describe, expect, it } from "vitest";
import { normalizeReply, parseEngagementBrief } from "../engagement-brief";

const task =
  "We need SEO for a product and do not want a full-time hire or an in-house team.";

describe("engagement brief", () => {
  it("keeps an email and a telegram name", () => {
    expect(normalizeReply("  Founder@Example.com ")).toBe(
      "founder@example.com",
    );
    expect(normalizeReply("@theonyxis")).toBe("@theonyxis");
    expect(normalizeReply("https://t.me/theonyxis")).toBe("@theonyxis");
  });

  it("refuses a reply that is neither email nor telegram", () => {
    expect(normalizeReply("call me")).toBeNull();
    expect(normalizeReply("@ab")).toBeNull();
    expect(normalizeReply("not-an-email")).toBeNull();
  });

  it("accepts a problem, a way back, and an optional company", () => {
    expect(
      parseEngagementBrief({
        task,
        reply: "t.me/theonyxis",
        organization: "  Northwind  ",
      }),
    ).toEqual({
      ok: true,
      task,
      reply: "@theonyxis",
      organization: "Northwind",
      budget: null,
      duration: null,
      start: null,
    });
  });

  it("keeps a short collaboration length and a start, and drops blanks", () => {
    expect(
      parseEngagementBrief({
        task,
        reply: "a@b.co",
        duration: "  about three months  ",
        start: "  as soon as the scope is clear  ",
      }),
    ).toMatchObject({
      ok: true,
      duration: "about three months",
      start: "as soon as the scope is clear",
    });
  });

  it("refuses a collaboration length that is longer than a short note", () => {
    expect(
      parseEngagementBrief({
        task,
        reply: "a@b.co",
        duration: "m".repeat(81),
      }),
    ).toEqual({ ok: false, field: "duration" });
  });

  it("refuses a problem that is only a few words", () => {
    expect(parseEngagementBrief({ task: "Need SEO", reply: "a@b.co" })).toEqual(
      { ok: false, field: "task" },
    );
  });
});
