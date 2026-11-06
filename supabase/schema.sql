-- WAIG Atlas schema. Every table is readable and writable only by signed-in
-- users whose email is on the allowed domain. The scheduled jobs use the
-- service-role key, which bypasses RLS.

create or replace function public.is_member() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@wadhwaniaiglobal.com', false)
$$;

create table if not exists public.grants (
  id text primary key,
  title text not null,
  funder text default '',
  summary text default '',
  amount_text text,
  amount_usd numeric,
  deadline date,
  open_date date,
  eligibility text,
  requirements text,
  countries text[] default '{}',
  regions text[] default '{}',
  themes text[] default '{}',
  url text not null,
  source_id text,
  source_name text,
  fetched_at timestamptz default now(),
  score int,
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  score_reason text
);

create table if not exists public.grant_tracking (
  id text primary key,
  grant_id text not null,
  assignee text,
  stage text default 'submission',
  milestones jsonb default '[]',
  status text default 'watching',
  updated_at timestamptz default now()
);

create table if not exists public.comments (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  body text not null,
  author text not null,
  created_at timestamptz default now()
);
create index if not exists comments_entity on public.comments (entity_type, entity_id);

create table if not exists public.attachments (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  url text not null,
  kind text default 'link',
  author text not null,
  created_at timestamptz default now()
);
create index if not exists attachments_entity on public.attachments (entity_type, entity_id);

create table if not exists public.sources (
  id text primary key,
  name text not null,
  category text not null,
  type text not null,
  url text not null,
  enabled boolean default true,
  notes text,
  last_run timestamptz,
  last_status text,
  last_message text,
  item_count int
);

create table if not exists public.org_context (
  id text primary key,
  content_md text not null default '',
  updated_at timestamptz default now()
);

create table if not exists public.milestone_templates (
  id text primary key,
  name text not null,
  description text,
  milestones jsonb not null default '[]'
);

create table if not exists public.projects (
  id text primary key,
  slug text unique not null,
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
  created_at timestamptz default now()
);

create table if not exists public.project_milestones (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  key text,
  name text not null,
  "order" int default 0,
  status text default 'not_started',
  start_date date,
  target_date date,
  owner text,
  team text,
  progress int default 0,
  stages jsonb
);
create index if not exists project_milestones_project on public.project_milestones (project_id);

create table if not exists public.pages (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  milestone_id text references public.project_milestones(id) on delete cascade,
  title text not null,
  content_md text default '',
  updated_at timestamptz default now(),
  updated_by text
);
create index if not exists pages_project on public.pages (project_id);
create index if not exists pages_milestone on public.pages (milestone_id);

create table if not exists public.tasks (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  milestone_id text references public.project_milestones(id) on delete set null,
  title text not null,
  team text,
  owner text,
  status text default 'todo',
  due date,
  url text
);
create index if not exists tasks_project on public.tasks (project_id);
create index if not exists tasks_milestone on public.tasks (milestone_id);

-- Row-level security: members only
do $$
declare t text;
begin
  foreach t in array array['grants','grant_tracking','comments','attachments','sources','org_context','milestone_templates','projects','project_milestones','pages','tasks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists members_all on public.%I', t);
    execute format('create policy members_all on public.%I for all to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
  end loop;
end $$;

-- Private bucket for uploaded attachments
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "members read attachments" on storage.objects;
create policy "members read attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (select public.is_member()));
drop policy if exists "members upload attachments" on storage.objects;
create policy "members upload attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (select public.is_member()));
drop policy if exists "members delete attachments" on storage.objects;
create policy "members delete attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (select public.is_member()));
