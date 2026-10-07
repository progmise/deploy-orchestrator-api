-- deploy-orchestrator-api — component catalog
-- Apply in the Supabase SQL editor (or `supabase db push`).
--
-- The API talks to this table via PostgREST using the service_role key,
-- so no RLS policies are needed for the dashboard — the API is the only
-- reader/writer and enforces auth itself (GitHub OAuth + allowlist).

create table if not exists public.components (
  -- Component identity — lands in deploy-manifest as components[].name
  name             text primary key,
  -- Uppercase/digit alias (Gluon "short_name"); prefixes manifest infra ids
  -- e.g. LOANSAPI -> loans-api-pro
  shortname        text not null,
  -- Full repo coordinates, e.g. progmise/loans-api
  repo             text not null unique,
  description      text not null default '',
  -- Template repo it was generated from, e.g. node-express-api-template
  template         text not null,
  -- Provisioning state machine:
  --   pending -> repo_created -> secrets_written -> vercel_project_created
  --           -> vars_written -> manifest_pr_opened -> ready
  --   (any step can end in 'failed'; provision_log carries the details)
  status           text not null default 'pending',
  manifest_pr      integer,
  provision_log    jsonb not null default '[]'::jsonb,
  created_by       text not null default '',   -- GitHub login of the creator
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.components enable row level security;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists components_touch on public.components;
create trigger components_touch before update on public.components
  for each row execute function public.touch_updated_at();
