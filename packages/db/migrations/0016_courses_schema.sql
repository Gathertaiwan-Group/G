create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  cover_image text,
  price numeric(10,2),
  is_published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  slug text not null,
  video_url text,
  content_md text,
  position int not null default 0,
  created_at timestamptz default now(),
  unique (course_id, slug)
);

create table if not exists course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  enrolled_at timestamptz default now(),
  completed_at timestamptz,
  unique (user_id, course_id)
);

create table if not exists lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id) on delete cascade,
  watched_seconds int default 0,
  completed_at timestamptz,
  primary key (user_id, lesson_id)
);

create index if not exists course_lessons_course_pos_idx on course_lessons (course_id, position);
create index if not exists course_enrollments_user_idx on course_enrollments (user_id);

insert into schema_migrations (filename) values ('0016_courses_schema.sql') on conflict do nothing;
