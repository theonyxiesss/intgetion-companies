import { describe, expect, it, vi } from "vitest";
import { httpCompaniesPorts } from "./remote-ports";

function setup(answer: (url: string) => Response) {
  const fetchImpl = vi.fn(async (url: string) => answer(url));
  const ports = httpCompaniesPorts({
    platform: { url: "https://platform.test/", token: "p" },
    notifications: { url: "https://notifications.test", token: "n" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const sent = (i = 0) => fetchImpl.mock.calls[i] as unknown as [string, RequestInit];
  return { ports, sent };
}
const auth = (init: RequestInit) => (init.headers as Record<string, string>).authorization;

describe("companies remote ports", () => {
  it("turns a platform 429 into a rate-limit error with retry-after", async () => {
    const { ports } = setup(() => new Response(null, { status: 429, headers: { "retry-after": "30" } }));
    await expect(ports.rateLimit("verificationRequest", "c1")).rejects.toMatchObject({
      status: 429,
      headers: { "retry-after": "30" },
    });
  });

  it("queues moderation and audits at the platform with its token", async () => {
    const { ports, sent } = setup(() => Response.json({ ok: true }));
    await ports.enqueueModeration({ entityType: "company", entityId: "c1", reason: "possible_duplicate", riskFlags: [] });
    expect(sent(0)[0]).toBe("https://platform.test/api/internal/companies/moderation-queue");
    expect(auth(sent(0)[1])).toBe("Bearer p");
    await ports.recordAudit({ actorId: "u", action: "a", entityType: "company" });
    expect(sent(1)[0]).toBe("https://platform.test/api/internal/companies/audit");
  });

  it("notifies through the notifications service and never throws", async () => {
    const { ports, sent } = setup(() => new Response(null, { status: 503 }));
    await expect(ports.notify("company.verification_decided", ["u"], {})).resolves.toBeUndefined();
    expect(sent()[0]).toBe("https://notifications.test/v1/notify");
    expect(auth(sent()[1])).toBe("Bearer n");
  });

  it("stores logos at the platform and reads a missing one as null", async () => {
    const { ports, sent } = setup((url) =>
      url.includes("missing") ? new Response(null, { status: 404 }) : Response.json({ path: "logos/a.webp" }),
    );
    await expect(ports.uploadLogo("logos/a.webp", Buffer.from("x"), "image/webp")).resolves.toBe("logos/a.webp");
    expect(sent(0)[1].method).toBe("PUT");
    await expect(ports.downloadLogo("logos/missing.webp")).resolves.toBeNull();
  });
});
