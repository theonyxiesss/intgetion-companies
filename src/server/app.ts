import { z, ZodError } from "zod";
import {
  forbidden,
  HttpError,
  httpErrorResponse,
  notFound,
  reportError,
  validationError,
} from "@intgetion/kit";
import * as companies from "../modules/companies/service";
import { isUuid, optionalCaller, requireCaller, requireServiceToken } from "./auth";

export type AppConfig = { serviceToken: string };

const memberBody = z
  .object({ userId: z.string().uuid(), cap: z.number().int().min(1).max(1000) })
  .strict();
const statusBody = z
  .object({
    status: z.enum(["unverified", "pending_verification", "verified", "rejected", "suspended"]),
    actorId: z.string().uuid(),
  })
  .strict();
const briefsBody = z.object({ enabled: z.boolean() }).strict();
const engagementBody = z
  .object({
    task: z.string().max(4000),
    reply: z.string().max(200),
    organization: z.string().max(120).nullable().optional(),
    budget: z.string().max(80).nullable().optional(),
    duration: z.string().max(80).nullable().optional(),
    start: z.string().max(80).nullable().optional(),
  })
  .strict();

const MAX_JSON = 64 * 1024;
const MAX_LOGO = companies.LOGO_MAX_BYTES + 1024;

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw validationError({ body: "invalid json" });
  }
  return schema.parse(json);
}

function idParam(value: string | undefined): string {
  if (!value || !isUuid(value)) throw notFound();
  return value;
}

function actor(request: Request) {
  const caller = requireCaller(request);
  return { id: caller.userId, locale: caller.locale };
}

type Result = unknown | Response;
type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[]) => Promise<Result>;
};

const storage = new companies.PortLogoStorage();

const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/v1\/companies$/,
    run: async (request) => {
      const who = actor(request);
      const input = await parseBody(request, companies.createCompanyInput);
      const company = await companies.createCompany(who, input);
      return Response.json({ company: companies.toCompanyDto(company) }, { status: 201 });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/me\/companies$/,
    run: async (request) => ({
      companies: (await companies.getCompaniesForUser(requireCaller(request).userId)).map(
        (company) => ({ ...companies.toCompanyDto(company), role: company.role }),
      ),
    }),
  },
  {
    method: "PUT",
    pattern: /^\/v1\/me\/company-agent-briefs$/,
    run: async (request) => {
      const { userId } = requireCaller(request);
      const { enabled } = await parseBody(request, briefsBody);
      return { enabled: await companies.setOwnCompanyAgentBriefs(userId, enabled) };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)$/,
    run: async (_request, [identifier]) => {
      if (!identifier) throw notFound();
      const { company } = await companies.getPublicCompany(identifier);
      return { company: companies.toCompanyDto(company) };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/v1\/companies\/([^/]+)$/,
    run: async (request, [id]) => {
      const who = actor(request);
      const input = await parseBody(request, companies.patchCompanyInput);
      const company = await companies.editCompany(idParam(id), who, input);
      return { company: companies.toCompanyDto(company) };
    },
  },
  {
    method: "PUT",
    pattern: /^\/v1\/companies\/([^/]+)\/status$/,
    run: async (request, [id]) => {
      const { status, actorId } = await parseBody(request, statusBody);
      await companies.changeCompanyStatus(idParam(id), actorId, status);
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)\/logo$/,
    run: async (_request, [identifier]) => {
      if (!identifier) throw notFound();
      const { company } = await companies.getPublicCompany(identifier);
      if (!company.logoPath || !companies.isSafeLogoPath(company.logoPath)) throw notFound();
      const bytes = await storage.download(company.logoPath);
      if (!bytes) throw notFound();
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/companies\/([^/]+)\/logo$/,
    run: async (request, [id]) => {
      const companyId = idParam(id);
      await companies.assertCanEditCompany(companyId, actor(request));
      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length > MAX_LOGO) {
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Logo too large");
      }
      const mime = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
      const saved = await companies.setCompanyLogo(companyId, bytes, mime, storage);
      return { logoPath: saved.logoPath };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)\/members$/,
    run: async (_request, [id]) => ({
      members: await companies.listCompanyMembers(idParam(id)),
    }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/companies\/([^/]+)\/members$/,
    run: async (request, [id]) => {
      const { userId: caller } = requireCaller(request);
      const companyId = idParam(id);
      if ((await companies.findMemberRole(companyId, caller)) !== "owner") {
        throw new HttpError(403, "FORBIDDEN", "Only the owner can add teammates");
      }
      const { userId, cap } = await parseBody(request, memberBody);
      return { result: await companies.addCompanyMember(companyId, userId, cap) };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/v1\/companies\/([^/]+)\/members\/([^/]+)$/,
    run: async (request, [id, member]) => {
      const companyId = idParam(id);
      const memberId = idParam(member);
      const { userId: caller } = requireCaller(request);
      const role = await companies.findMemberRole(companyId, caller);
      if (caller !== memberId && role !== "owner") throw forbidden();
      await companies.removeCompanyMember(companyId, memberId);
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)\/members\/([^/]+)\/role$/,
    run: async (_request, [id, member]) => ({
      role: await companies.findMemberRole(idParam(id), idParam(member)),
    }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/companies\/([^/]+)\/verification$/,
    run: async (request, [id]) => companies.getVerificationState(actor(request), idParam(id)),
  },
  {
    method: "POST",
    pattern: /^\/v1\/companies\/([^/]+)\/verification$/,
    run: async (request, [id]) => {
      const who = actor(request);
      const input = await parseBody(request, companies.requestVerificationInput);
      return companies.requestVerification(who, idParam(id), input);
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/companies\/([^/]+)\/verification\/confirm$/,
    run: async (request, [id]) => {
      const who = actor(request);
      const { token } = await parseBody(request, companies.confirmVerificationInput);
      return companies.confirmVerification(who, idParam(id), token);
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/users\/([^/]+)\/is-employer$/,
    run: async (_request, [id]) => ({ employer: await companies.isEmployer(idParam(id)) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/engagement-briefs$/,
    run: async (request) => {
      const ip = request.headers.get("x-client-ip") ?? "unknown";
      await companies.limitEngagementBrief(ip);
      const input = await parseBody(request, engagementBody);
      const saved = await companies.saveEngagementBrief({
        userId: optionalCaller(request)?.userId ?? null,
        task: input.task,
        reply: input.reply,
        organization: input.organization ?? null,
        budget: input.budget ?? null,
        duration: input.duration ?? null,
        start: input.start ?? null,
      });
      if (!saved.ok) throw validationError({ field: saved.field });
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/refresh-trusted$/,
    run: async () => ({ ok: true, ...(await companies.refreshTrustedFlags()) }),
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) {
    return httpErrorResponse(validationError(error.issues));
  }
  reportError(error, "companies-service");
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal error" } },
    { status: 500 },
  );
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        const result = await route.run(request, match.slice(1));
        if (result instanceof Response) return result;
        return Response.json(result, { headers: { "cache-control": "no-store" } });
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
