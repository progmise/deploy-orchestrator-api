-- deploy-orchestrator-api — component catalog
-- Apply in the Supabase SQL editor (or `supabase db push`).
--
-- The API talks to this table via PostgREST using the service_role key,
-- so no RLS policies are needed for the dashboard — the API is the only
-- reader/writer and enforces auth itself (GitHub OAuth + allowlist).

-- Template registry — which GitHub template repos the wizard offers, and
-- the kind that drives the provisioning spec (secrets/vars/manifest step).
-- The row is the source of truth; GitHub `is_template` is only the
-- generation mechanism (verified by the provisioner before generating).

create table if not exists public.templates (
  -- Template repo name, e.g. node-express-api-template
  name         text primary key,
  -- Full repo coordinates, e.g. progmise/node-express-api-template
  repo         text not null unique,
  -- 'app' = deployable component (manifest registration); 'lib' = library
  -- (Central publishing, no manifest step)
  kind         text not null check (kind in ('app', 'lib')),
  description  text not null default '',
  -- Wizard "Personalización" schema — array of fields the dashboard
  -- renders for this template:
  --   {key, label, type:'select', options:[{value,label}], default}
  --   {key, label, type:'fixed', value}
  -- Answers land in components.config; branch_strategy drives which
  -- branches the provisioner creates (gitflow: main+development;
  -- trunk: main only).
  fields       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.templates enable row level security;
revoke all on public.templates from anon, authenticated;

-- On an existing database (components already created), also run:
--   alter table public.components
--     add constraint components_template_fkey
--     foreign key (template) references public.templates(name);
-- after seeding templates so existing rows resolve.

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
  template         text not null references public.templates(name),
  -- Provisioning state machine:
  --   pending -> repo_created -> secrets_written
  --           -> vars_written -> manifest_pr_opened -> ready
  --   (any step can end in 'failed'; provision_log carries the details)
  status           text not null default 'pending',
  -- Branch model the provisioner materializes: 'gitflow' creates
  -- protected main + development (dev = default); 'trunk' only main.
  branch_strategy  text not null default 'gitflow'
    check (branch_strategy in ('gitflow', 'trunk')),
  -- Wizard "Personalización" answers (declared by templates.fields).
  config           jsonb not null default '{}'::jsonb,
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

-- Platform credential store (the provisioner's "credential store"):
-- plain values in platform_vars; secret VALUES in Supabase Vault
-- (pgsodium-encrypted), exposed to service_role via platform_secrets.

create table if not exists public.platform_vars (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.platform_vars enable row level security;

drop trigger if exists platform_vars_touch on public.platform_vars;
create trigger platform_vars_touch before update on public.platform_vars
  for each row execute function public.touch_updated_at();

create extension if not exists supabase_vault with schema vault;

create or replace view public.platform_secrets as
  select name, decrypted_secret as value from vault.decrypted_secrets;

-- Views run with owner rights — keep them out of reach of anon/auth roles.
revoke all on public.platform_secrets from anon, authenticated;
revoke all on public.platform_vars from anon, authenticated;
