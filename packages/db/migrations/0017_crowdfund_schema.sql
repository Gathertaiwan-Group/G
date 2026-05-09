create table if not exists crowdfund_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  cover_image text,
  goal_amount numeric(12,2) not null,
  raised_amount numeric(12,2) default 0,
  deadline timestamptz not null,
  status text not null check (status in ('draft', 'active', 'funded', 'failed', 'canceled')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists crowdfund_tiers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  title text not null,
  price numeric(10,2) not null,
  description text,
  max_pledges int,
  current_pledges int default 0
);

create table if not exists crowdfund_pledges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  tier_id uuid references crowdfund_tiers(id) on delete set null,
  user_id uuid not null references auth.users(id),
  amount numeric(10,2) not null,
  status text not null check (status in ('reserved', 'captured', 'refunded', 'failed')),
  captured_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists crowdfund_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crowdfund_projects(id) on delete cascade,
  title text not null,
  body_md text,
  posted_at timestamptz default now()
);

create index if not exists crowdfund_pledges_project_idx on crowdfund_pledges (project_id);

insert into schema_migrations (filename) values ('0017_crowdfund_schema.sql') on conflict do nothing;
