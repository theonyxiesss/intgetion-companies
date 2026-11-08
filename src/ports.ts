export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: Record<string, unknown> | null;
  reason?: string | null;
};

export type RatePolicy = { limit: number; windowSeconds: number };

/** Who is acting: the platform signs the person in and passes these. */
export type CompanyActor = { id: string; locale: string };

export type CompaniesPorts = {
  /** platform: append an audit row. */
  recordAudit: (entry: AuditEntry) => Promise<void>;
  /**
   * platform: count one hit; throws a 429 HttpError when over the limit.
   * `bucket` names a platform policy; `policy` overrides it for module-local limits.
   */
  rateLimit: (bucket: string, key: string, policy?: RatePolicy) => Promise<void>;
  /** notifications: deliver a notice; failures are logged, never thrown. */
  notify: (type: string, recipientIds: readonly string[], payload: unknown) => Promise<void>;
  /**
   * moderation: put an entity on the review queue. Called inside the company
   * transaction; an in-process adapter writes with `tx`, an HTTP adapter
   * fails the step on error.
   */
  enqueueModeration: (
    input: { entityType: "company"; entityId: string; reason: string; riskFlags: string[] },
    tx?: unknown,
  ) => Promise<void>;
  /** platform: store and read company logos (holds the storage key). */
  uploadLogo: (path: string, bytes: Buffer, contentType: "image/webp") => Promise<string>;
  downloadLogo: (path: string) => Promise<Buffer | null>;
};

let ports: CompaniesPorts | null = null;

export function setCompaniesPorts(next: CompaniesPorts): void {
  ports = next;
}

export function companiesPorts(): CompaniesPorts {
  if (!ports) throw new Error("companies ports are not configured");
  return ports;
}
