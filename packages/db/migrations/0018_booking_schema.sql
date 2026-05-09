create table if not exists booking_services (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  duration_minutes int not null,
  price numeric(10,2),
  capacity int default 1,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists booking_slots (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references booking_services(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  capacity int not null,
  booked int default 0
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references booking_slots(id),
  user_id uuid references auth.users(id),
  status text not null check (status in ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),
  customer_phone text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists booking_slots_service_start_idx on booking_slots (service_id, start_at);
create index if not exists bookings_user_idx on bookings (user_id);

insert into schema_migrations (filename) values ('0018_booking_schema.sql') on conflict do nothing;
