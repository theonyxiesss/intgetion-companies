# INTGETION Companies Service

Companies for INTGETION JOB LIST: company profiles, members and roles, logos (converted to WebP), verification by corporate email or DNS TXT, the review hand-off, the trusted flag, employer profiles, and engagement briefs left on /services.

Runs as its own HTTP process with its own tables and migration. Developed separately; the platform is not wired to it yet.

## Run

```bash
npm install
cp .env.example .env   # fill in values
npm run migrate        # company tables only
npm run dev            # http://localhost:4070
```

Checks: `npm run typecheck`, `npm test`. Integration tests run only when `DATABASE_URL` is set (and need `DATABASE_MIGRATION_URL`).

## How callers talk to it

Every request except `GET /health` needs `Authorization: Bearer <COMPANIES_SERVICE_TOKEN>`. Routes that act for a person need `x-user-id` (and `x-user-locale` for emails). The caller is checked before the body. Answers are `cache-control: no-store` (logos: `public, max-age=300`). Errors are `{ "error": { "code", "message", "details?" } }`.

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | — | `{ ok }` |
| POST | `/v1/companies` | person | create (201); same domain or similar name is queued as a possible duplicate |
| GET | `/v1/me/companies` | person | companies the person belongs to |
| PUT | `/v1/me/company-agent-briefs` | person | `{ enabled }` for companies they manage |
| GET | `/v1/companies/:slug` | public | company card |
| PATCH | `/v1/companies/:id` | owner/admin | edit; complete requisites send it to review |
| GET | `/v1/companies/:slug/logo` | public | WebP logo, 404 if none |
| POST | `/v1/companies/:id/logo` | owner/admin | raw PNG/JPEG/WebP body with its `content-type` |
| GET / POST | `/v1/companies/:id/verification` | owner | state / request (`{ method, target? }`) |
| POST | `/v1/companies/:id/verification/confirm` | owner | `{ token }` from the email |
| GET | `/v1/companies/:id/members` | module | members with names |
| POST | `/v1/companies/:id/members` | owner | `{ userId, cap }` — cap comes from billing (seats) |
| DELETE | `/v1/companies/:id/members/:userId` | owner or self | the last owner cannot leave |
| GET | `/v1/companies/:id/members/:userId/role` | module | `{ role }` or `null` |
| PUT | `/v1/companies/:id/status` | admin flow | `{ status, actorId }` |
| GET | `/v1/users/:id/is-employer` | module | `{ employer }` |
| POST | `/v1/engagement-briefs` | public | brief form; limited per `x-client-ip` |
| POST | `/v1/tasks/refresh-trusted` | scheduler | recompute trusted flags |

Adding a teammate by email stays in the platform: it finds the account by email (auth) and the seat cap (billing), then calls `POST /members` with the user id.

## What it calls

Platform at `PLATFORM_URL` with `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`:

| Method | Path | Answer |
|---|---|---|
| POST | `/api/internal/companies/audit` | `{ actorId, action, entityType, entityId?, diff?, reason? }` → 2xx |
| POST | `/api/internal/companies/rate-limit` | `{ bucket, key, policy? }` → 2xx, or 429 with `retry-after` |
| POST | `/api/internal/companies/moderation-queue` | `{ entityType, entityId, reason, riskFlags }` → 2xx |
| PUT / GET | `/api/internal/companies/logos?path` | store raw WebP → `{ path }` / read bytes or 404 |

Notifications at `NOTIFICATIONS_URL`: `POST /v1/notify` for `company.verification_decided` (failures are logged, never block).

The storage key stays in the platform: this service never holds the Supabase service-role key. Queueing for review happens inside the company transaction; an in-process adapter writes with that transaction.

## Data

Tables owned by companies: `companies`, `company_members`, `company_verifications`, `employer_profiles`, `engagement_briefs`, and their types (`company_status`, `company_origin`, `member_role`, `verification_method`, `verification_status`; `company_size` is shared with candidates). One migration, `migrations/0004_companies.sql`, holds their final shape: generated from a schema dump of a database migrated to the latest platform state (`intgetion-kit/tools/schema-from-dump.mjs`); a dump of the result matches the platform exactly. On a live database it changes nothing; checked against a non-superuser owner with rows present.

Reads (never writes), until those modules are extracted, for verification steps and the trusted flag: `audit_logs`, `jobs`, `job_status_history`, `applications`, `application_status_history`, `reports`, and `users` / `user_profiles` for member names. Needs `pg_trgm` and `public.skill_similarity` from taxonomy, helper `public.set_updated_at`, roles `app_rw`, `anon`, `authenticated`. CI creates stand-ins from `test/sql/platform-stub.sql`.

## Packages inside

- `.` — service functions, schemas, `toCompanyDto`, company marks, free-email rules, `setCompaniesPorts`
- `./ports` — `setCompaniesPorts()`
- `./server` — `createApp()` HTTP handler

Depends on `@intgetion/kit` (v0.3.0) by git tag. Company pages and the public company page with jobs stay in the platform.
