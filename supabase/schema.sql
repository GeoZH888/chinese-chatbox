-- The chatbox's learner tables.
--
-- These were first written as the shared platform for every language-learning
-- app, under the assumption that no such layer existed. It does: the main app
-- already has clf_user_learning_state, clf_learning_events, clf_attempts and
-- others. Rather than claim the generic names on a mistaken premise, everything
-- here is prefixed chatbox_ until that reconciliation is actually decided —
-- see UNIFIED_CONTENT_PLAN.md.
--
-- The design below still holds, and is what a shared layer should look like:
-- the *item* is shared, not the app's table.
-- 你好 drilled in the chatbox and 你好 drilled anywhere else would resolve to one
-- row, so practice compounds instead of fragmenting.
--
-- Three tables:
--   chatbox_items    canonical, keyed by language + normalized content
--   chatbox_state    one row per learner per item: counts and SRS schedule
--   chatbox_events   append-only log of every attempt, tagged with the app
--
-- Apps never write these tables directly. They call chatbox_record_attempt(),
-- which resolves the item, logs the event and advances the schedule in one
-- round trip, so the maths lives in one place.
--
-- Run once, in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------- identity --

-- Item identity must not depend on punctuation, case or spacing: 你好。and 你好
-- are the same thing to practise. IMMUTABLE so a generated column can use it,
-- which is what guarantees every app agrees on identity.
create or replace function public.chatbox_normalize_content(txt text)
returns text
language sql
immutable
strict
as $fn$
  select regexp_replace(
    lower(txt),
    '[[:space:]，。、？！；：""''「」《》…·【】,\.\?!;:"''\(\)（）\-—_/～~]',
    '',
    'g'
  );
$fn$;

-- ------------------------------------------------------------------- items --

create table if not exists public.chatbox_items (
  id         bigint generated always as identity primary key,
  lang       text not null,                       -- 'zh', 'it', 'en', …
  kind       text not null default 'phrase',      -- phrase | word | character | grammar
  content    text not null,                       -- as displayed: 你好
  normalized text generated always as (public.chatbox_normalize_content(content)) stored,
  reading    text,                                -- pinyin or other romanisation
  glosses    jsonb not null default '{}'::jsonb,  -- {"en":"hello","it":"ciao"}
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chatbox_items_identity unique (lang, kind, normalized)
);

create index if not exists chatbox_items_lang_idx on public.chatbox_items (lang, kind);

-- ------------------------------------------------------------------- state --

create table if not exists public.chatbox_state (
  user_id       uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  item_id       bigint  not null references public.chatbox_items (id) on delete cascade,
  reps          integer not null default 0,       -- consecutive successes
  lapses        integer not null default 0,
  right_count   integer not null default 0,
  wrong_count   integer not null default 0,
  ease          real    not null default 2.5,     -- SM-2 style difficulty factor
  interval_days real    not null default 0,
  due_at        timestamptz,
  last_seen_at  timestamptz,
  apps          text[]  not null default '{}',    -- which apps this was practised in
  updated_at    timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index if not exists chatbox_state_due_idx on public.chatbox_state (user_id, due_at);

-- ------------------------------------------------------------------ events --

create table if not exists public.chatbox_events (
  id         bigint generated always as identity primary key,
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  item_id    bigint not null references public.chatbox_items (id) on delete cascade,
  app        text   not null,
  verdict    text   not null check (verdict in ('right','partial','tones','wrong','skip','seen')),
  mode       text,                                -- 'voice' | 'typed'
  created_at timestamptz not null default now()
);

create index if not exists chatbox_events_user_idx on public.chatbox_events (user_id, created_at desc);

-- --------------------------------------------------------------------- RLS --

alter table public.chatbox_items  enable row level security;
alter table public.chatbox_state  enable row level security;
alter table public.chatbox_events enable row level security;

-- Items are shared vocabulary, readable by any signed-in learner. They may be
-- added but not rewritten, so one app cannot change what another is drilling.
drop policy if exists "items are readable by signed-in learners" on public.chatbox_items;
create policy "items are readable by signed-in learners"
  on public.chatbox_items for select to authenticated using (true);

drop policy if exists "items may be added by signed-in learners" on public.chatbox_items;
create policy "items may be added by signed-in learners"
  on public.chatbox_items for insert to authenticated with check (true);

-- State and events are private, always.
drop policy if exists "state is private to its owner" on public.chatbox_state;
create policy "state is private to its owner"
  on public.chatbox_state for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "events are private to their owner" on public.chatbox_events;
create policy "events are private to their owner"
  on public.chatbox_events for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------- the API --

-- Resolve an item by content, creating it the first time any app sees it.
create or replace function public.chatbox_resolve_item(
  p_lang text, p_kind text, p_content text,
  p_reading text default null, p_glosses jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security invoker
as $fn$
declare
  v_id bigint;
begin
  insert into public.chatbox_items (lang, kind, content, reading, glosses)
  values (p_lang, p_kind, p_content, p_reading, coalesce(p_glosses, '{}'::jsonb))
  on conflict on constraint chatbox_items_identity do update
    -- Fill in a reading or gloss a later app knows and an earlier one did not.
    set reading = coalesce(public.chatbox_items.reading, excluded.reading),
        glosses = public.chatbox_items.glosses || excluded.glosses
  returning id into v_id;
  return v_id;
end;
$fn$;

-- One call per answer: log it, advance the schedule, return the new state.
-- SM-2 in spirit, deliberately gentle: a wrong answer costs the interval but
-- not the whole history, and a partly-right answer (right syllables, no tones)
-- still counts as progress.
create or replace function public.chatbox_record_attempt(
  p_lang text, p_kind text, p_content text, p_verdict text,
  p_app text, p_mode text default null,
  p_reading text default null, p_glosses jsonb default '{}'::jsonb
)
returns public.chatbox_state
language plpgsql
security invoker
as $fn$
declare
  v_item bigint;
  v_state public.chatbox_state;
  v_good boolean := p_verdict in ('right','partial');
begin
  v_item := public.chatbox_resolve_item(p_lang, p_kind, p_content, p_reading, p_glosses);

  insert into public.chatbox_events (item_id, app, verdict, mode)
  values (v_item, p_app, p_verdict, p_mode);

  insert into public.chatbox_state (user_id, item_id)
  values (auth.uid(), v_item)
  on conflict (user_id, item_id) do nothing;

  update public.chatbox_state s
     set reps = case when v_good then s.reps + 1 else 0 end,
         lapses = case when v_good then s.lapses else s.lapses + 1 end,
         right_count = s.right_count + (case when v_good then 1 else 0 end),
         wrong_count = s.wrong_count + (case when v_good then 0 else 1 end),
         ease = greatest(1.3, least(3.0,
                  s.ease + (case when p_verdict = 'right' then 0.1
                                 when p_verdict = 'partial' then 0.0
                                 else -0.2 end))),
         interval_days = case
             when not v_good then 0
             when s.reps = 0 then 1
             when s.reps = 1 then 3
             else greatest(1, s.interval_days * s.ease)
           end,
         due_at = now() + (case
             when not v_good then interval '10 minutes'
             when s.reps = 0 then interval '1 day'
             when s.reps = 1 then interval '3 days'
             else (greatest(1, s.interval_days * s.ease) || ' days')::interval
           end),
         last_seen_at = now(),
         apps = case when p_app = any(s.apps) then s.apps else array_append(s.apps, p_app) end,
         updated_at = now()
   where s.user_id = auth.uid() and s.item_id = v_item
   returning s.* into v_state;

  return v_state;
end;
$fn$;

-- Everything this learner has practised in one language, whichever app taught
-- it. The chatbox merges this into its local progress on sign-in.
create or replace function public.chatbox_snapshot(p_lang text)
returns table (content text, reading text, right_count integer, wrong_count integer, due_at timestamptz)
language sql
security invoker
stable
as $fn$
  select i.content, i.reading, s.right_count, s.wrong_count, s.due_at
    from public.chatbox_state s
    join public.chatbox_items i on i.id = s.item_id
   where s.user_id = auth.uid() and i.lang = p_lang;
$fn$;

-- What is due for review right now, across every app. This is the adaptive bit.
create or replace function public.chatbox_due_items(p_lang text, p_limit integer default 20)
returns table (content text, reading text, glosses jsonb, due_at timestamptz, lapses integer)
language sql
security invoker
stable
as $fn$
  select i.content, i.reading, i.glosses, s.due_at, s.lapses
    from public.chatbox_state s
    join public.chatbox_items i on i.id = s.item_id
   where s.user_id = auth.uid()
     and i.lang = p_lang
     and (s.due_at is null or s.due_at <= now())
   order by s.lapses desc, s.due_at nulls first
   limit greatest(1, least(p_limit, 200));
$fn$;

grant execute on function public.chatbox_resolve_item(text, text, text, text, jsonb) to authenticated;
grant execute on function public.chatbox_record_attempt(text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.chatbox_snapshot(text) to authenticated;
grant execute on function public.chatbox_due_items(text, integer) to authenticated;
