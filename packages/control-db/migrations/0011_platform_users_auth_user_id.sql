-- Defense-in-depth: link platform_users to auth.users so requirePlatformUser()
-- can match by stable auth.uid() instead of (or in addition to) email.
--
-- Email-only matching is safe today because:
--   1. platform_users.email is unique not null (0001), and
--   2. Supabase OTP login requires control of the email inbox.
-- But if an operator's email ever changes (auth.users.email is mutable),
-- the email-based match would silently break. auth_user_id is immutable.

alter table platform_users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

comment on column platform_users.auth_user_id is 'Supabase auth.users.id, populated on first successful sign-in. Preferred over email for session->platform_user resolution.';
