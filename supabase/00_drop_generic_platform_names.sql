-- Release the generic names, one time only.
--
-- The chatbox's learner tables were first created as learning_items,
-- learner_state and learning_events, on the assumption that the project had no
-- learner layer. It has one already (clf_user_learning_state,
-- clf_learning_events, clf_attempts and others), so those generic names were
-- claimed on a mistaken premise and are given back here.
--
-- Safe because nothing has been practised yet: all three tables are empty. If
-- that is no longer true when you run this, STOP — the counts below will tell
-- you, and the data would need migrating into the chatbox_ tables instead.
--
-- Run this first, then run schema.sql to create the chatbox_ versions.

do $do$
declare
  v_rows bigint := 0;
  v_n bigint;
  t text;
begin
  foreach t in array array['learning_items','learner_state','learning_events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into v_n;
      raise notice '%: % rows', t, v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;

  if v_rows > 0 then
    raise exception 'Refusing to drop: % rows across the old tables. Migrate them into the chatbox_ tables first.', v_rows;
  end if;
end
$do$;

drop function if exists public.due_items(text, integer);
drop function if exists public.learner_snapshot(text);
drop function if exists public.record_attempt(text, text, text, text, text, text, text, jsonb);
drop function if exists public.resolve_item(text, text, text, text, jsonb);

drop table if exists public.learning_events;
drop table if exists public.learner_state;
drop table if exists public.learning_items;

-- Dropped last: the generated column on learning_items depended on it.
drop function if exists public.normalize_content(text);

-- platform_admins and is_admin() are deliberately NOT dropped. They gate the
-- clf_/jgw_ content tables, which is a project-wide job, not the chatbox's.
