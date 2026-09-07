-- Lock down the shared content libraries.
--
-- The problem this solves: these tables had row level security off, so the
-- project's anon key — which ships inside every app bundle and is published in
-- a public repository — could insert, update and delete curated content. Read
-- access was never the issue; write access was.
--
-- The shape after this runs:
--   anyone (signed in or not) may READ the content, exactly as today
--   only a listed admin may INSERT, UPDATE or DELETE
--
-- This is the access model the shared platform needs anyway: many apps read one
-- content library, a small number of authors write it.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- AFTER RUNNING: any authoring app that writes with the anon key from the
-- browser will stop working until it signs its author in. That is the point —
-- an unauthenticated write path is indistinguishable from an attacker.

-- --------------------------------------------------------------- the admin --

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- SECURITY DEFINER matters here: without it, a policy that calls is_admin()
-- while reading platform_admins would recurse into itself. The fixed
-- search_path stops the function resolving to something else later.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$fn$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "admins can see the admin list" on public.platform_admins;
create policy "admins can see the admin list"
  on public.platform_admins for select to authenticated using (public.is_admin());

-- The list is managed from the SQL editor only, which runs with privileges that
-- bypass RLS — so there is no policy allowing anyone to add themselves.

-- ------------------------------------------------------------ the content --

-- Applied to every shared content table. Reads stay open so the public apps
-- keep working unchanged; writes narrow to admins.
do $do$
declare
  t text;
  tables text[] := array[
    'clf_chengyu',
    'clf_poems',
    'clf_panda_assets',
    'jgw_poems',
    'jgw_panda_assets',
    'jgw_articulation_diagrams'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, no such table', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "content is public to read" on public.%I', t);
    execute format(
      'create policy "content is public to read" on public.%I
         for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "only admins add content" on public.%I', t);
    execute format(
      'create policy "only admins add content" on public.%I
         for insert to authenticated with check (public.is_admin())', t);

    execute format('drop policy if exists "only admins change content" on public.%I', t);
    execute format(
      'create policy "only admins change content" on public.%I
         for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);

    execute format('drop policy if exists "only admins remove content" on public.%I', t);
    execute format(
      'create policy "only admins remove content" on public.%I
         for delete to authenticated using (public.is_admin())', t);

    raise notice 'secured %', t;
  end loop;
end
$do$;

-- ------------------------------------------------------------------ checks --

-- 1. Who are the admins? (empty until you add yourself — see below)
-- select u.email, a.note from public.platform_admins a join auth.users u on u.id = a.user_id;

-- 2. Add yourself. Find the id first:
--    select id, email from auth.users order by created_at;
--    insert into public.platform_admins (user_id, note)
--    values ('PASTE-YOUR-UUID', 'me') on conflict do nothing;

-- 3. Confirm nothing in public/ is left unprotected:
--    select c.relname, c.relrowsecurity, count(p.polname) as policies
--    from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    left join pg_policy p on p.polrelid = c.oid
--    where n.nspname = 'public' and c.relkind = 'r'
--    group by 1,2 order by c.relrowsecurity, 1;
