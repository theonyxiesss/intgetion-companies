import { HttpError, logger } from "@intgetion/kit";
import type { CompaniesPorts } from "../ports";

export type Endpoint = { url: string; token: string };

export type RemoteConfig = {
  platform: Endpoint;
  notifications: Endpoint;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Ports answered by the platform (audit, limits, moderation queue, logo storage) and notifications. */
export function httpCompaniesPorts(config: RemoteConfig): CompaniesPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 5000;

  async function call(to: Endpoint, path: string, init: RequestInit = {}) {
    return doFetch(`${to.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${to.token}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  async function ok(response: Response, path: string) {
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response;
  }
  const json = { "content-type": "application/json" };

  return {
    async recordAudit(entry) {
      const path = "/api/internal/companies/audit";
      await ok(await call(config.platform, path, { method: "POST", headers: json, body: JSON.stringify(entry) }), path);
    },
    async rateLimit(bucket, key, policy) {
      const path = "/api/internal/companies/rate-limit";
      const response = await call(config.platform, path, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ bucket, key, policy }),
      });
      if (response.status === 429) {
        const retry = Number(response.headers.get("retry-after") ?? 60);
        throw new HttpError(429, "RATE_LIMITED", "Too many requests", undefined, {
          "retry-after": String(retry),
        });
      }
      await ok(response, path);
    },
    async notify(type, recipientIds, payload) {
      try {
        await ok(
          await call(config.notifications, "/v1/notify", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ type, recipientIds, payload }),
          }),
          "/v1/notify",
        );
      } catch (error) {
        logger.error({ err: error, type }, "companies: notify failed");
      }
    },
    async enqueueModeration(input) {
      const path = "/api/internal/companies/moderation-queue";
      await ok(await call(config.platform, path, { method: "POST", headers: json, body: JSON.stringify(input) }), path);
    },
    async uploadLogo(path, bytes, contentType) {
      const query = new URLSearchParams({ path });
      const route = `/api/internal/companies/logos?${query}`;
      const response = await ok(
        await call(config.platform, route, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: new Uint8Array(bytes),
        }),
        route,
      );
      return ((await response.json()) as { path: string }).path;
    },
    async downloadLogo(path) {
      const query = new URLSearchParams({ path });
      const response = await call(config.platform, `/api/internal/companies/logos?${query}`);
      if (response.status === 404) return null;
      await ok(response, "/api/internal/companies/logos");
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
