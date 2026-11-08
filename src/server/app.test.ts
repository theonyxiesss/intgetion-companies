import { beforeEach, describe, expect, it, vi } from "vitest";

const company = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  domain: "acme.test",
  websiteUrl: null,
  linkedinUrl: null,
  telegramUrl: null,
  xUrl: null,
  description: null,
  logoPath: null,
  country: null,
  size: null,
  status: "unverified",
  origin: "internal",
};
const service = vi.hoisted(() => ({
  createCompany: vi.fn(async () => company),
  findMemberRole: vi.fn(async (): Promise<string | null> => "member"),
  addCompanyMember: vi.fn(async () => "added"),
  removeCompanyMember: vi.fn(async () => {}),
  getPublicCompany: vi.fn(async () => ({ company, jobs: [] })),
  limitEngagementBrief: vi.fn(async () => {}),
  saveEngagementBrief: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("../modules/companies/service", async (orig) => ({
  ...(await orig<typeof import("../modules/companies/service")>()),
  ...service,
}));

const { createApp } = await import("./app");

const TOKEN = "test-companies-token";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const handle = createApp({ serviceToken: TOKEN });

function call(path: string, init: RequestInit & { user?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.user) headers.set("x-user-id", init.user);
  return handle(new Request(`http://companies${path}`, { ...init, headers }));
}

beforeEach(() => vi.clearAllMocks());

describe("companies service HTTP", () => {
  it("refuses a wrong token and needs the person to create", async () => {
    const refused = await handle(
      new Request("http://companies/v1/companies", { method: "POST", headers: { authorization: "Bearer nope" } }),
    );
    expect(refused.status).toBe(401);
    expect((await call("/v1/companies", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("creates with 201 and validates the form", async () => {
    const bad = await call("/v1/companies", { method: "POST", user: USER, body: JSON.stringify({ name: "A" }) });
    expect(bad.status).toBe(400);
    const ok = await call("/v1/companies", { method: "POST", user: USER, body: JSON.stringify({ name: "Acme" }) });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { company: { slug: string } }).company.slug).toBe("acme");
  });

  it("lets only the owner add a teammate", async () => {
    const path = `/v1/companies/${company.id}/members`;
    const body = JSON.stringify({ userId: OTHER, cap: 2 });
    expect((await call(path, { method: "POST", user: USER, body })).status).toBe(403);
    expect(service.addCompanyMember).not.toHaveBeenCalled();
    service.findMemberRole.mockResolvedValueOnce("owner");
    expect((await call(path, { method: "POST", user: USER, body })).status).toBe(200);
    expect(service.addCompanyMember).toHaveBeenCalledWith(company.id, OTHER, 2);
  });

  it("lets a member leave but not remove others", async () => {
    expect((await call(`/v1/companies/${company.id}/members/${USER}`, { method: "DELETE", user: USER })).status).toBe(200);
    expect((await call(`/v1/companies/${company.id}/members/${OTHER}`, { method: "DELETE", user: USER })).status).toBe(403);
  });

  it("serves no logo when the company has none", async () => {
    expect((await call(`/v1/companies/acme/logo`)).status).toBe(404);
  });

  it("rate limits engagement briefs by the forwarded address", async () => {
    await call("/v1/engagement-briefs", {
      method: "POST",
      headers: { "x-client-ip": "203.0.113.9" },
      body: JSON.stringify({ task: "x".repeat(30), reply: "me@example.com" }),
    });
    expect(service.limitEngagementBrief).toHaveBeenCalledWith("203.0.113.9");
    expect(service.saveEngagementBrief).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});
