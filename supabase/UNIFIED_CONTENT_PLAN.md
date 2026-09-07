# Unified content layer — migration plan

> ## ⚠ ON HOLD — the premise below is wrong
>
> This plan assumed `clf_` and `jgw_` were two apps with two content libraries.
> They are not. Searching the deployed bundles of `zhongwen-allinone`,
> `david-zhongwen` and `lingua-school` shows both prefixes used by **the same
> app**: `clf_` is the learning-content and school subsystem (~70 tables),
> `jgw_` is the points, practice and pinyin subsystem (~20 tables).
>
> Consequences:
>
> 1. **There is no duplicate content library to unify.** `clf_poems` and
>    `clf_chengyu` are live; `jgw_poems` (1 row), `jgw_articulation_diagrams`
>    (1 row) and `clf_panda_assets` (0 rows) are referenced by no deployed app
>    and look like abandoned test tables. The "two editions of 静夜思" that drove
>    the design in §2 is one live poem and one dead test row.
> 2. **A learner-progress layer already exists**: `clf_user_learning_state`,
>    `clf_learning_events`, `clf_attempts`, `clf_chengyu_progress`,
>    `clf_grammar_progress`, `clf_lianzi_progress`, `jgw_progress`,
>    `jgw_practice_log` — all RLS-protected. The `learning_items` /
>    `learner_state` / `learning_events` tables in `schema.sql` parallel it
>    rather than extend it, and would become a second competing progress system.
>
> What remains valid: the security work in `content_security.sql`, and the
> general principle that identity should be content-based and shared. What needs
> redoing: deciding whether the shared platform extends the existing `clf_`
> schema or replaces it — a decision that needs the `zhongwen-allinone` codebase
> in front of us, not guesswork from table names.
>
> Kept for the schema patterns and the phased-migration method, both of which
> still apply to whatever replaces it.

---

Status: superseded. Audit figures were read live from project
`yqcojudvvjntaajnrilr`.

Settled at the time: **`jsonb` for translations**, **slugs as the public
identifier**. Editions were **not** split by audience — see §2.

## 1. What is actually there

| Table | Rows | Shape |
|---|---:|---|
| `clf_poems` | 11 | Tang poems, 30 columns, `_zh`/`_en`/`_it` triples, image + audio |
| `jgw_poems` | 1 | 静夜思 — 21 columns, subset of the above |
| `clf_chengyu` | 16 | idioms, story/example per language, HSK 3–5, themes |
| `clf_panda_assets` | 0 | empty |
| `jgw_panda_assets` | 15 | emotion → image URL, modules: lianzi, pinyin, words, grammar, riddles |
| `jgw_articulation_diagrams` | 1 | diagram id → image URL |
| `learning_items` | 0 | learner layer, nothing practised yet |

**44 content rows.** Volume is not the problem; the risk is in the app changes.

## 2. Why there are no editions

The first draft of this plan split content into *works* and *editions*, on the
theory that `clf` and `jgw` served different audiences and each deserved its own
translation. That turned out to be wrong: both apps serve the same audience —
Chinese learners of every kind. An edition per app would name the same audience
twice, which is the duplication this migration exists to remove.

What actually differs between the two apps is not who they are for, but **which
items they show and in what order**. That is a placement, not an edition.

The one genuine conflict is 静夜思, which exists in both tables with different
wording:

> **clf** — *Before my bed the moonlight gleams so bright, I wonder if it's frost
> upon the ground…*
>
> **jgw** — *Before my bed, bright moonlight glows, I wonder if it's frost
> below…*

Both are competent; neither is a stale copy. The clf row is strictly richer in
coverage (it also has `title_it`, `image_url`, `audio_url`, `notes_it` and audio
metadata that the jgw row lacks), so **clf becomes canonical** — and the jgw
wording is kept in a `variants` field rather than deleted. Nothing authored is
lost, the choice stays reversible, and for a language-learning platform a second
rendering is worth having anyway.

## 3. Target schema

```sql
-- One row per poem, shared by every app.
create table public.poems (
  id          bigint generated always as identity primary key,
  slug        text not null unique,            -- 'jing-ye-si'
  title       text not null,                   -- 静夜思
  title_i18n  jsonb not null default '{}',     -- {"en":"Quiet Night Thoughts","it":"…"}
  author      text,
  dynasty     text,
  dynasty_i18n jsonb not null default '{}',
  type        text,                            -- 五言律诗 / 七言绝句
  lines       jsonb not null,
  pinyin_map  jsonb,
  translation jsonb not null default '{}',     -- {"zh":"…","en":"…","it":"…"}
  background  jsonb not null default '{}',
  notes       jsonb not null default '{}',
  media       jsonb not null default '{}',     -- image_url, audio_url, audio_provider…
  difficulty  integer,
  level       integer,
  age_min     integer,
  tags        text[],
  variants    jsonb not null default '{}',     -- alternate wordings, keyed by source
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.idioms (
  id         bigint generated always as identity primary key,
  slug       text not null unique,             -- 'hua-she-tian-zu'
  idiom      text not null unique,             -- 画蛇添足
  pinyin     text,
  meaning    jsonb not null default '{}',
  story      jsonb not null default '{}',
  example    jsonb not null default '{}',
  media      jsonb not null default '{}',
  difficulty integer,
  hsk_level  integer,
  theme      text,                             -- history | animals | emotion | nature
  variants   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Labelled media with no editorial dimension.
create table public.assets (
  id         bigint generated always as identity primary key,
  kind       text not null,                    -- 'panda' | 'articulation'
  key        text not null,                    -- emotion, or diagram id
  image_url  text not null,
  label      text,
  meta       jsonb not null default '{}',      -- module_id and similar
  created_at timestamptz not null default now(),
  unique (kind, key)
);

-- What each app shows, and in what order. This is the only per-app dimension.
create table public.content_placements (
  app          text not null,                  -- 'clf' | 'jgw' | 'chinese-chatbox' | …
  content_type text not null check (content_type in ('poem','idiom','asset')),
  content_id   bigint not null,
  sort_order   integer,
  active       boolean not null default true,
  meta         jsonb not null default '{}',    -- app-specific extras, e.g. module
  primary key (app, content_type, content_id)
);

create index on public.content_placements (app, content_type, sort_order);
```

`content_placements` is deliberately not a foreign key to three different
tables — a polymorphic reference is the price of one placement table instead of
three. If you would rather have referential integrity, split it into
`poem_placements` / `idiom_placements` / `asset_placements` with real foreign
keys; the migration is otherwise identical.

### Why `jsonb`

`title`/`title_en`/`title_it` triples make every new language a schema migration
across every table, and grow a `switch` per field in every app. With
`translation->>'it'` a fourth language is data. Optional guard:

```sql
alter table public.poems
  add constraint poems_translation_langs check (translation ?& array['zh','en']);
```

### Link to the learner layer

No foreign key needed. `learning_items` identifies by language plus normalized
content, so any app drilling an idiom calls:

```sql
select public.record_attempt('zh', 'idiom', '画蛇添足', 'right', 'clf', 'typed');
```

and lands on the same item whichever app asked. Store `meta = {"idiom_id": 12}`
on the item if you want a link back.

## 4. Migration, in phases

Each phase is independently revertible and the apps keep running throughout.

### Phase 0 — prerequisites

`content_security.sql` has run, you are in `platform_admins`, and the authoring
apps sign in. Do not migrate tables that anyone holding the public anon key can
still edit underneath you.

### Phase 1 — create, do not move

Create the four tables with RLS and the policy shape from
`content_security.sql`: public read, admin write. Nothing reads them yet, so
this cannot break anything.

### Phase 2 — copy the data

44 rows, one transaction:

1. `poems` ← 11 from `clf_poems`. Slugs from pinyin (`jing-ye-si`). Triples fold
   into `translation` / `background` / `notes`; image and audio into `media`.
2. 静夜思 ← the jgw wording is written into
   `variants = {"jgw": {"translation": {...}, "background": {...}, "notes": {...}}}`
   on the existing row. No second poem row is created.
3. `idioms` ← 16 from `clf_chengyu`.
4. `assets` ← 15 from `jgw_panda_assets` as `kind='panda'` (module into `meta`),
   1 from `jgw_articulation_diagrams` as `kind='articulation'`.
   `clf_panda_assets` is empty.
5. `content_placements` ← one row per source row, carrying that app's existing
   `sort_order` and `active`: 11 for `clf` poems, 1 for `jgw` poems, 16 for
   `clf` idioms, 16 for `jgw` assets.

Verify before continuing:

```sql
select (select count(*) from public.poems)              as poems,       -- expect 11
       (select count(*) from public.idioms)             as idioms,      -- expect 16
       (select count(*) from public.assets)             as assets,      -- expect 16
       (select count(*) from public.content_placements) as placements;  -- expect 44

-- 静夜思 must be one row that still carries both wordings:
select slug, translation->>'en' as canonical,
       variants->'jgw'->'translation'->>'en' as preserved
  from public.poems where slug = 'jing-ye-si';

-- Nothing may lose its text:
select count(*) from public.poems  where translation = '{}'::jsonb;  -- expect 0
select count(*) from public.idioms where meaning     = '{}'::jsonb;  -- expect 0

-- Every source row must have a placement:
select app, content_type, count(*) from public.content_placements group by 1,2 order by 1,2;
```

### Phase 3 — compatibility views

This is what makes it incremental rather than a big bang. Rename the old tables
aside and put views with the **same names and columns** over the new ones:

```sql
alter table public.clf_poems rename to clf_poems_legacy;

create view public.clf_poems with (security_invoker = true) as
select p.id, p.title,
       p.title_i18n->>'en'  as title_en,
       p.title_i18n->>'it'  as title_it,
       p.author, p.dynasty, p.type, p.lines, p.pinyin_map,
       p.translation->>'zh' as translation_zh,
       p.translation->>'en' as translation_en,
       p.translation->>'it' as translation_it,
       p.background->>'zh'  as background_zh,
       p.background->>'en'  as background_en,
       p.background->>'it'  as background_it,
       p.notes->>'zh'       as notes_zh,
       p.notes->>'en'       as notes_en,
       p.notes->>'it'       as notes_it,
       p.media->>'image_url' as image_url,
       p.media->>'audio_url' as audio_url,
       p.difficulty, p.level, p.age_min, p.tags,
       c.sort_order, c.active, p.created_at
  from public.poems p
  join public.content_placements c
    on c.content_type = 'poem' and c.content_id = p.id and c.app = 'clf';
```

`security_invoker = true` is not optional: without it the view runs as its owner
and bypasses the RLS you just added.

Both apps now read the new data through their old names **with no code change**,
so the read paths are proven before any app is touched. The views are read-only;
authoring moves to the new tables in phase 4, which is fine because phase 0
already paused it.

### Phase 4 — move the apps, one at a time

Per app: point reads at `poems` / `idioms` / `assets` joined to
`content_placements` for its own `app`, point writes at the new tables, deploy,
watch. If it misbehaves, revert that one deploy — the view is still there and
the old code still works. No coordination between apps needed.

### Phase 5 — remove the scaffolding

After every app has been off the views for a week or two, take a snapshot, then
drop the views and the `*_legacy` tables.

## 5. Rollback

| Phase | To undo |
|---|---|
| 1 | `drop table` the new tables. Nothing referenced them. |
| 2 | `truncate` and re-run. Sources untouched. |
| 3 | `drop view`, rename the legacy table back. Seconds. |
| 4 | Revert that app's deploy. The view still serves the old shape. |
| 5 | Restore from the snapshot. The only irreversible phase — hence the wait. |

## 6. Effort

| Phase | Work |
|---|---|
| 1–2 | One SQL file, ~200 lines. An hour, mostly the verification queries. |
| 3 | Five views. |
| 4 | Per app: a day each, most of it testing. The real time goes here. |
| 5 | Minutes, after a deliberate wait. |

## 7. Remaining decisions

1. **`content_placements` polymorphic, or three typed tables?** One table is
   less to maintain; three give real foreign keys. Recommended: start with one,
   split later if integrity bites.
2. **App keys.** `'clf'` and `'jgw'` are codenames. Since they do not denote
   audiences, they may as well become the actual app names, which is what a
   third app will expect to see.
3. **Does 静夜思 keep the clf wording as canonical?** Recommended yes, with the
   jgw wording preserved in `variants`. Reversible either way — both texts
   survive.
