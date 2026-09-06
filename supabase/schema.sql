-- Progress that follows the learner between devices.
-- Run once, in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.progress (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item_key    text        not null,                      -- e.g. 'greetings:0', from src/curriculum.js
  right_count integer     not null default 0 check (right_count >= 0),
  wrong_count integer     not null default 0 check (wrong_count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);

-- Each learner sees and writes only their own rows. Without this, the anon key
-- would expose everyone's progress to everyone.
alter table public.progress enable row level security;

drop policy if exists "progress is private to its owner" on public.progress;
create policy "progress is private to its owner"
  on public.progress
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at honest even when the client forgets to send it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists progress_touch_updated_at on public.progress;
create trigger progress_touch_updated_at
  before insert or update on public.progress
  for each row execute function public.touch_updated_at();

create index if not exists progress_user_idx on public.progress (user_id);
