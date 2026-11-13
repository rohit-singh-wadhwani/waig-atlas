-- WAIG Atlas: Supabase schema (public). Regenerated from the live database on 2026-11-11.
-- Every table has row-level security: only signed-in @wadhwaniaiglobal.com users (is_member()) can read or write.
-- Pipeline outputs (feeds, TB rasters) are files written by GitHub Actions; this schema holds what people edit.

-- ── Access ──────────────────────────────────────────────────────────────
create or replace function public.is_member()
returns boolean language sql stable set search_path to '' as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@wadhwaniaiglobal.com', false)
$$;

-- Everyone who signs in is added to members automatically (trigger on auth.users).
create or replace function public.add_member_on_signup()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.members (id, email, name)
  values (lower(new.email), lower(new.email), nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
-- create trigger on_auth_user_created after insert on auth.users for each row execute function public.add_member_on_signup();

create table public.members (
  id text primary key,               -- lower-case email
  email text not null,
  name text,
  team text,
  role text,                         -- e.g. TB campaign role, used to assign playbook tasks
  district text,
  created_at timestamptz not null default now()
);

-- ── Sources and organisation context ────────────────────────────────────
create table public.sources (
  id text primary key,
  name text not null,
  display_name text,
  category text not null,
  type text not null,
  kind text,
  unit text,
  url text not null,
  enabled boolean default true,
  notes text,
  last_run timestamptz,
  last_status text,
  last_message text,
  item_count integer
);

create table public.org_context (
  id text primary key,
  content_md text not null default '',
  updated_at timestamptz default now()
);

-- ── Grants ──────────────────────────────────────────────────────────────
-- Calls found by the daily grant scout or added by hand (curated = true).
create table public.grants (
  id text primary key,
  title text not null,
  funder text default '',
  summary text default '',
  amount_text text,
  amount_usd numeric,
  deadline date,
  deadline_text text,
  open_date date,
  eligibility text,
  eligible_as text,
  requirements text,
  countries text[] default '{}',
  regions text[] default '{}',
  geography text,
  themes text[] default '{}',
  sector text,
  url text not null,
  source_id text,
  source_name text,
  score integer,
  fit text,
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  score_reason text,
  curated boolean not null default false,
  notes text,
  added_by text,
  fetched_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index grants_curated on public.grants (curated);

-- One row per call we are following: POC and status (watching, pursuing, submitted, won, lost, dropped).
create table public.grant_tracking (
  id text primary key,               -- same as grant_id
  grant_id text not null,
  assignee text,
  status text default 'watching',
  updated_at timestamptz default now()
);

-- Checkpoints on the way to a grant decision (same shape as milestone_checkpoints).
create table public.grant_checkpoints (
  id text primary key,
  grant_id text not null references public.grants(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  target_date date,
  completed_on date,                 -- set = checkpoint done
  owner text,
  notes text,                        -- what needs to be done
  tasks jsonb not null default '[]', -- [{id, title, done}]
  updated_at timestamptz not null default now()
);
create index grant_checkpoints_grant on public.grant_checkpoints (grant_id, position);

-- ── Projects ────────────────────────────────────────────────────────────
-- Templates: milestones = [{key, name, description, statuses: FlowStatus[], checkpoints: [{title, tasks: string[]}]}]
create table public.milestone_templates (
  id text primary key,
  name text not null,
  description text,
  milestones jsonb not null default '[]'
);

create table public.projects (
  id text primary key,
  slug text not null unique,
  name text not null,
  summary text default '',
  countries text[] default '{}',
  diseases text[] default '{}',
  funder text,
  status text default 'idea',
  lead text,
  start_date date,
  end_date date,
  template_id text,
  links jsonb default '[]',
  grant_amount numeric,              -- total grant
  contracted_amount numeric,         -- our share
  currency text default 'USD',
  created_at timestamptz default now()
);

-- flow = the status options for this milestone [{key, label, kind: todo|active|blocked|done|lost}]; status = one of their keys.
create table public.project_milestones (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  key text,
  name text not null,
  "order" integer default 0,
  status text default 'not_started',
  flow jsonb,
  start_date date,
  target_date date,
  owner text,
  team text,
  progress integer default 0         -- calculated from checkpoints when there are any
);
create index project_milestones_project on public.project_milestones (project_id);

create table public.milestone_checkpoints (
  id text primary key,
  milestone_id text not null references public.project_milestones(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  target_date date,
  completed_on date,
  owner text,
  notes text,
  tasks jsonb not null default '[]', -- [{id, title, done}]
  updated_at timestamptz not null default now()
);
create index milestone_checkpoints_milestone on public.milestone_checkpoints (milestone_id, position);

create table public.pages (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  milestone_id text references public.project_milestones(id) on delete cascade,
  title text not null,
  content_md text default '',
  content_json jsonb,                -- BlockNote document
  updated_at timestamptz default now(),
  updated_by text
);
create index pages_project on public.pages (project_id);
create index pages_milestone on public.pages (milestone_id);

-- ── Collaboration (any entity: grant, project, milestone, campaign …) ───
create table public.comments (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  body text not null,
  author text not null,
  created_at timestamptz default now()
);
create index comments_entity on public.comments (entity_type, entity_id);

create table public.attachments (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  url text not null,
  kind text default 'link',
  author text not null,
  created_at timestamptz default now()
);
create index attachments_entity on public.attachments (entity_type, entity_id);

-- ── TB surveillance ─────────────────────────────────────────────────────
create table public.tb_parameters (
  id text primary key,
  grp text not null,
  label text not null,
  value numeric not null,
  unit text,
  description text,
  source_title text,
  source_url text,
  status text not null default 'assumption' check (status in ('evidence', 'assumption', 'policy')),
  updated_at timestamptz default now(),
  updated_by text
);

create table public.tb_playbooks (
  id text primary key,
  name text not null,
  trigger text,
  description text,
  setting text,
  steps jsonb not null default '[]',
  source_title text,
  source_url text,
  enabled boolean not null default true,
  updated_at timestamptz default now()
);

create table public.tb_cities (
  id text primary key,
  name text not null,
  lat numeric not null,
  lon numeric not null,
  radius_km numeric not null default 20,
  h3_res integer not null default 8,
  city_partner text,
  enabled boolean default true
);

create table public.tb_campaigns (
  id text primary key,
  name text not null,
  city text,
  district_id text,
  district_name text,
  hex_ids text[] default '{}',
  setting text,
  playbook_id text references public.tb_playbooks(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'active', 'done', 'cancelled')),
  start_date date,
  end_date date,
  owner text,
  target_screened integer,
  predicted_positivity numeric,
  town text,
  spots jsonb,                       -- [{name, kind, lon, lat, pop_1km}] screening spots picked in the explorer
  notes text,
  created_by text,
  created_at timestamptz default now()
);

create table public.tb_campaign_results (
  id text primary key,
  campaign_id text not null references public.tb_campaigns(id) on delete cascade,
  report_date date not null default current_date,
  screened integer default 0,
  cough_flagged integer default 0,
  cough_flagged_confirmed integer default 0,
  cxr_flagged integer default 0,
  cxr_flagged_confirmed integer default 0,
  presumptive integer default 0,
  tested integer default 0,
  confirmed integer default 0,
  rr_confirmed integer default 0,
  started_treatment integer default 0,
  contacts_identified integer default 0,
  contacts_screened integer default 0,
  tpt_started integer default 0,
  notes text,
  reported_by text,
  created_at timestamptz default now()
);
create index tb_results_campaign on public.tb_campaign_results (campaign_id);

create table public.tb_tasks (
  id text primary key,
  campaign_id text references public.tb_campaigns(id) on delete cascade,
  title text not null,
  detail text,
  role text,
  assignee text,
  district_id text,
  district_name text,
  due date,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done', 'blocked')),
  priority text default 'normal',
  step_key text,
  outcome text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index tb_tasks_campaign on public.tb_tasks (campaign_id);

-- Private district notifications uploaded by programme staff (never in the public repo).
create table public.tb_notifications (
  id text primary key,
  district_id text not null,
  district_name text,
  period text not null,
  notified integer,
  bact_confirmed integer,
  source text,
  uploaded_by text,
  uploaded_at timestamptz default now()
);

-- Written by the weekly TB workflow from the model plus private notifications.
create table public.tb_estimates (
  district_id text primary key,
  district_name text,
  region text,
  expected numeric,
  notified numeric,
  gap numeric,
  hidden numeric,
  calibration numeric,
  blind_spot numeric,
  priority numeric,
  rank integer,
  drivers jsonb,
  updated_at timestamptz default now()
);

create table public.tb_briefs (
  id text primary key,
  scope text not null,
  generated_at timestamptz default now(),
  model text,
  content_md text,
  inputs jsonb
);

-- ── Row-level security: one policy per table ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'members', 'sources', 'org_context', 'grants', 'grant_tracking', 'grant_checkpoints',
    'milestone_templates', 'projects', 'project_milestones', 'milestone_checkpoints', 'pages',
    'comments', 'attachments', 'tb_parameters', 'tb_playbooks', 'tb_cities', 'tb_campaigns',
    'tb_campaign_results', 'tb_tasks', 'tb_notifications', 'tb_estimates', 'tb_briefs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy members_all on public.%I for all to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
  end loop;
end $$;
