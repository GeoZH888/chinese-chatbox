-- Progress that follows the learner between devices.
-- The table is namespaced because this Supabase project is shared with other
-- apps; nothing here touches their tables.
-- Run once, in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.chatbox_progress (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item_key    text        not null,                      -- e.g. 'greetings:0', from src/curriculum.js
  right_count integer     not null default 0 check (right_count >= 0),
  wrong_count integer     not null default 0 check (wrong_count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);

-- Each learner sees and writes only their own rows. Without this, the anon key
-- would expose everyone's progress to everyone.
alter table public.chatbox_progress enable row level security;

drop policy if exists "chatbox_progress is private to its owner" on public.chatbox_progress;
create policy "chatbox_progress is private to its owner"
  on public.chatbox_progress
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

drop trigger if exists chatbox_progress_touch_updated_at on public.chatbox_progress;
create trigger chatbox_progress_touch_updated_at
  before insert or update on public.chatbox_progress
  for each row execute function public.touch_updated_at();

create index if not exists chatbox_progress_user_idx on public.chatbox_progress (user_id);
