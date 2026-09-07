# Unified content layer — migration plan

Status: proposed, nothing executed. Audit figures below were read live from
project `yqcojudvvjntaajnrilr`.

## 1. What is actually there

| Table | Rows | Shape |
|---|---:|---|
| `clf_poems` | 11 | Tang poems, 30 columns, `_zh`/`_en`/`_it` triples, image + audio |
| `jgw_poems` | 1 | 静夜思 — 21 columns, subset of the above |
| `clf_chengyu` | 16 | idioms, with story/example per language, HSK level |
| `clf_panda_assets` | 0 | empty |
| `jgw_panda_assets` | 15 | emotion → image URL |
| `jgw_articulation_diagrams` | 1 | diagram id → image URL |
| `learning_items` | 0 | learner layer, nothing practised yet |

**44 content rows in total.** Volume is not the problem here — the risk in this
migration is entirely in the app changes, not in moving data.

## 2. The finding that shapes the design

`静夜思` exists in both `clf_poems` and `jgw_poems`. The jgw copy has no field
the clf copy lacks, so it looks redundant — but **ten fields hold different
values**:

```
translation_zh, translation_en, translation_it,
background_zh,  background_en,  background_it,
notes_zh, notes_en, image_prompt, sort_order
```

These are not stale duplicates. Two apps wrote two different translations and
two different commentaries of the same poem, each pitched at its own audience.
A naive "de-duplicate by title" would delete one of them.

So the unified layer must separate two things that the current tables conflate:

- **the work** — title, author, dynasty, the lines themselves. Objective, and
  genuinely the same across every app.
- **the edition** — translation, notes, background, image, audio, difficulty,
  ordering. Editorial, and legitimately different per audience.

One poem, many editions. That resolves the conflict instead of forcing a loss,
and it is what lets a future app add its own voice without copying the poem again.

## 3. Target schema

```sql
-- The work: one row per poem, whatever app shows it.
create table public.poems (
  id         bigint generated always as identity primary key,
  slug       text not null unique,          -- 'jing-ye-si'
  title      text not null,                 -- 静夜思
  author     text,                          -- 李白
  dynasty    text,                          -- 唐
  lines      jsonb not null,                -- the poem itself
  pinyin_map jsonb,
  created_at timestamptz not null default now()
);

-- The edition: how one audience presents that work.
create table public.poem_editions (
  id          bigint generated always as identity primary key,
  poem_id     bigint not null references public.poems (id) on delete cascade,
  edition     text not null,                -- 'clf' | 'jgw' | future apps
  title_i18n  jsonb not null default '{}',  -- {"en":"Quiet Night Thoughts","it":"…"}
  translation jsonb not null default '{}',  -- {"zh":"…","en":"…","it":"…"}
  background  jsonb not null default '{}',
  notes       jsonb not null default '{}',
  media       jsonb not null default '{}',  -- {"image_url":…,"audio_url":…,"audio_provider":…}
  difficulty  text,
  level       text,
  age_min     integer,
  tags        text[],
  sort_order  integer,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (poem_id, edition)
);

-- Idioms follow the same split; only clf has them today, but jgw or a future
-- app will want its own gloss eventually.
create table public.idioms (
  id         bigint generated always as identity primary key,
  idiom      text not null unique,
  pinyin     text,
  created_at timestamptz not null default now()
);

create table public.idiom_editions (
  id         bigint generated always as identity primary key,
  idiom_id   bigint not null references public.idioms (id) on delete cascade,
  edition    text not null,
  meaning    jsonb not null default '{}',
  story      jsonb not null default '{}',
  example    jsonb not null default '{}',
  media      jsonb not null default '{}',
  difficulty text,
  hsk_level  integer,
  theme      text,
  sort_order integer,
  active     boolean not null default true,
  unique (idiom_id, edition)
);

-- Media with no editorial dimension: labelled images, keyed by purpose.
create table public.assets (
  id         bigint generated always as identity primary key,
  kind       text not null,                 -- 'panda' | 'articulation' | …
  key        text not null,                 -- emotion, or diagram id
  image_url  text not null,
  label      text,
  meta       jsonb not null default '{}',   -- module_id and similar
  created_at timestamptz not null default now(),
  unique (kind, key)
);
```

### Why `jsonb` for the translations

The current tables carry `title`/`title_en`/`title_it` triples. Every new
language is then a schema migration across every table, and the apps grow a
`switch` per field. With `translation->>'it'` a fourth language is data, not DDL.

The cost is that a typo in a key fails silently where a missing column would not.
Mitigate with a check constraint if that worries you:

```sql
alter table public.poem_editions
  add constraint translation_langs check (translation ?| array['zh','en','it']);
```

### Link to the learner layer

No foreign key is needed. `learning_items` identifies items by language plus
normalized content, so an app that drills 画蛇添足 calls:

```sql
select public.record_attempt('zh', 'idiom', '画蛇添足', 'right', 'clf', 'typed');
```

and it lands on the same item whichever app asked. Optionally store
`meta = {"idiom_id": 12}` on the item for a link back to the content row.

## 4. Migration, in phases

The phases exist so that nothing breaks between them. Each is independently
revertible, and the apps keep running throughout.

### Phase 0 — prerequisites

`content_security.sql` has run, you are in `platform_admins`, and the authoring
apps sign in. Do not start this migration while writes still go through the anon
key: you would be migrating a table anyone can edit underneath you.

### Phase 1 — create, do not move

Create the seven tables above with RLS and the same policy shape as
`content_security.sql`: public read, admin write. Nothing reads them yet, so
this phase cannot break anything.

### Phase 2 — copy the data

44 rows. Runs in one transaction, in this order:

1. `poems` ← distinct works from `clf_poems` ∪ `jgw_poems`, matched on
   normalized title + author, so 静夜思 lands **once**. Slugs from pinyin.
2. `poem_editions` ← one row per source row: 11 from clf, 1 from jgw. The two
   静夜思 editions both survive, pointing at one work.
3. `idioms` + `idiom_editions` ← 16 from `clf_chengyu`, edition `'clf'`.
4. `assets` ← 15 from `jgw_panda_assets` as `kind='panda'`, 1 from
   `jgw_articulation_diagrams` as `kind='articulation'`. `clf_panda_assets` is
   empty, so nothing to carry.

Then verify before going further:

```sql
select (select count(*) from public.poems)          as works,          -- expect 11
       (select count(*) from public.poem_editions)  as editions,       -- expect 12
       (select count(*) from public.idioms)         as idioms,         -- expect 16
       (select count(*) from public.assets)         as assets;         -- expect 16

-- The duplicate must be one work with two editions:
select p.title, count(e.id) from public.poems p
  join public.poem_editions e on e.poem_id = p.id
 group by p.title having count(e.id) > 1;                              -- expect 静夜思, 2

-- No text may be lost in translation, literally:
select count(*) from public.poem_editions where translation = '{}'::jsonb;  -- expect 0
```

### Phase 3 — compatibility views

This is what makes the migration incremental instead of a big bang. Rename the
old tables aside and put views with the **same names and columns** over the new
tables:

```sql
alter table public.clf_poems rename to clf_poems_legacy;

create view public.clf_poems with (security_invoker = true) as
select p.id, p.title,
       e.title_i18n->>'en' as title_en,
       e.title_i18n->>'it' as title_it,
       p.author, p.dynasty, p.lines, p.pinyin_map,
       e.translation->>'zh' as translation_zh,
       e.translation->>'en' as translation_en,
       e.translation->>'it' as translation_it,
       e.media->>'image_url' as image_url,
       e.media->>'audio_url' as audio_url,
       e.difficulty, e.level, e.age_min, e.active, e.sort_order, e.created_at
  from public.poems p
  join public.poem_editions e on e.poem_id = p.id and e.edition = 'clf';
```

`security_invoker = true` matters: without it the view runs as its owner and
bypasses the RLS you just put on the underlying tables.

Both apps now read the new data through their old names, **with no code change
at all**. Read paths are proven before a single app is touched.

Views are read-only here. Authoring must move to the new tables in phase 4 —
which is fine, because authoring is already paused by phase 0.

### Phase 4 — move the apps, one at a time

Per app: point reads at `poems` + `poem_editions` (filtering
`edition = 'clf'`), point writes at the new tables, deploy, watch. If it
misbehaves, revert that deploy — the view is still there and the old code still
works. No coordination between apps is needed.

### Phase 5 — remove the scaffolding

Once every app is off the views for a week or two: drop the views, then drop
`*_legacy`. Take a snapshot first.

```sql
drop view if exists public.clf_poems, public.jgw_poems, public.clf_chengyu,
                    public.jgw_panda_assets, public.jgw_articulation_diagrams;
drop table if exists public.clf_poems_legacy, public.jgw_poems_legacy,
                     public.clf_chengyu_legacy, public.clf_panda_assets_legacy,
                     public.jgw_panda_assets_legacy,
                     public.jgw_articulation_diagrams_legacy;
```

## 5. Rollback

| Phase | To undo |
|---|---|
| 1 | `drop table` the new tables. Nothing referenced them. |
| 2 | `truncate` and re-run. Sources are untouched. |
| 3 | `drop view`, `alter table … rename to` the original name. Seconds. |
| 4 | Revert that app's deploy. The view still serves the old shape. |
| 5 | Restore from the snapshot. This is the only irreversible phase — hence the wait. |

## 6. Effort

| Phase | Work |
|---|---|
| 1–2 | One SQL file, ~200 lines. An hour, mostly writing the verification. |
| 3 | One view per legacy table, five views. |
| 4 | Per app: a day each, most of it testing. This is where the real time goes. |
| 5 | Minutes, after a deliberate wait. |

## 7. Open decisions

1. **`jsonb` or flat columns for translations?** Recommended: `jsonb`, per §3.
   Flat columns are less disruptive to existing queries but make the fourth
   language another migration.
2. **Edition names.** `'clf'` and `'jgw'` preserve today's meaning but are
   opaque. If those apps have audiences rather than codenames — `'kids'`,
   `'hsk'`, `'adult-beginner'` — name editions after the audience, since that
   is what actually differs.
3. **Should assets be per edition too?** Today the panda images are shared and
   the poem images are per app. The schema above puts poem media on the edition
   and standalone media in `assets`, which matches current use.
4. **Slugs.** `jing-ye-si` from pinyin, or keep the existing uuids as the
   public identifier? Slugs read better in URLs and survive a re-import.
