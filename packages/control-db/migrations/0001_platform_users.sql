create extension if not exists "pgcrypto";

create table if not exists platform_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

comment on table platform_users is 'Platform-level accounts (operators + paying customers as billing entities). Distinct from per-tenant Supabase Auth users.';
