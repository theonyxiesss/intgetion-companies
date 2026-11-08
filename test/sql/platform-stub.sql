-- Platform and other-module pieces companies needs. CI only; the real ones live elsewhere.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- As on Supabase: API roles can reach the public schema; RLS decides the rows.
GRANT USAGE ON SCHEMA public TO app_rw, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid UNIQUE,
  terms_accepted_at timestamptz,
  terms_version text
);

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name text,
  country char(2),
  city text,
  timezone text,
  languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  about text
);

-- Read-only sources of the trust score (jobs, applications, moderation, audit).
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.job_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.application_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  to_status text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL,
  decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- From taxonomy migration 0003: pg_trgm and the name similarity function.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE SCHEMA extensions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;
END
$$;
CREATE OR REPLACE FUNCTION public.skill_similarity(left_text text, right_text text)
RETURNS real LANGUAGE sql STABLE
AS $fn$ SELECT extensions.similarity(left_text, right_text) $fn$;

-- Same helpers as platform migration 0001.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO app_rw;

-- Same helper as platform migration 0001.
CREATE OR REPLACE FUNCTION public.enable_rls_deny_all(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  short_name text;
BEGIN
  SELECT c.relname INTO short_name FROM pg_class c WHERE c.oid = target;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', target);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO anon, authenticated, app_rw',
    target
  );
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', short_name || '_app_rw_all', target);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL TO app_rw USING (true) WITH CHECK (true)',
    short_name || '_app_rw_all',
    target
  );
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', short_name || '_anon_deny', target);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL TO anon USING (false) WITH CHECK (false)',
    short_name || '_anon_deny',
    target
  );
  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON %s',
    short_name || '_authenticated_deny',
    target
  );
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL TO authenticated USING (false) WITH CHECK (false)',
    short_name || '_authenticated_deny',
    target
  );
END;
$$;
