# 中文聊天室 · Chinese Chatbox

A **voice-first** chatbox for learners of **Chinese**, with **中文 / English (GB) / Italiano**
throughout: the interface, the tutor's explanations, and the glosses on every phrase.
Built for a phone screen first, and it works on a desktop just as well.

You speak, it answers out loud. The keyboard is there when you want it (⌨), never required.

It runs in four modes so it adapts to whatever environment you have to hand.

| Mode | What it needs | What you get |
|---|---|---|
| **Offline tutor** | Nothing. Double-click `index.html`. | Built-in phrasebook, drills, tone-marked pinyin, spoken audio, progress tracking. No network, no key. |
| **Claude, direct from browser** | Your own API key, pasted into Settings. | Free conversation with a Claude tutor, streamed. Key is stored in your browser only. |
| **Local server** | Node 18+, `npm install`, a key in `.env`. | Same conversation, but the key stays on the machine and never reaches the page. |
| **Hosted (Netlify + Supabase)** | A deploy, see below. | The same server mode on a public URL, gated by sign-in, with progress synced across devices. |

Switch modes at any time from Settings (⚙), or by tapping the mode name under the title.

## Getting started

**No install at all** — open `index.html` in a browser. That is the offline tutor,
and everything below about drills works.

**With a Claude tutor:**

```bash
npm install
cp .env.example .env   # then put your key in it
npm start
```

Open <http://localhost:8787> and choose *Server (local or hosted)* as the mode.

Run `npm test` to exercise the tutor engine (pinyin, marking, lookup, commands).

## Talking to it

Tap the big **Speak** button and say something. The pills to its left say which language
you are speaking — 中文 by default, since speaking Chinese is the point; switch to EN or IT
to ask a question in a language you already have.

Two toggles under the microphone:

- **Hands-free conversation** — the microphone reopens by itself the moment the tutor
  stops speaking, so a whole drill session runs without touching the screen.
- **Read replies aloud** — on by default. Replies that mix Chinese and English or Italian
  are read with a voice per language, and parenthesised pinyin is skipped (it is there
  for the eye, not the ear).

Speech recognition needs Chrome, Edge or Safari and a network connection; where it is
missing the app says so and opens the keyboard instead. Read-aloud quality depends on the
Chinese voices installed on the device — on Windows, *Settings → Time & language → Speech*
adds them.

## Using it

Type or say anything in any of the three languages. Anything that isn't a command is looked up in
the phrasebook (offline mode) or sent to Claude (AI modes).

| Command | Does |
|---|---|
| `/units` | List the eight units |
| `/unit 3` | Work within one unit |
| `/drill` | Get a phrase to translate into Chinese |
| `/review` | Drill the items you have missed or not seen |
| `/hint` | First character and length |
| `/skip` | Reveal the answer |
| `/stats` | Your progress |
| `/help` | All of the above |

Chinese commands work too: `/课程`, `/单元 3`, `/练习`, `/复习`, `/提示`, `/跳过`, `/进度`, `/帮助`.

**Commands and drill answers are always handled locally**, in every mode. So you can
be mid-conversation with Claude, type `/drill`, answer it, and carry on — the drill
marking never depends on the network.

Answers are accepted as characters **or** pinyin, with or without tones:

| You type | Result |
|---|---|
| `你好` | correct |
| `nǐ hǎo` or `ni3 hao3` | correct, tones checked |
| `nihao` | correct syllables, noted as untoned |
| `ní hào` | right syllables, wrong tones — flagged, drill stays open |

Tap any Chinese text, anywhere, to hear just that phrase again.

Pinyin is coloured by tone: <span>1st</span> red, 2nd amber, 3rd green, 4th blue, neutral grey.

## Deploying (Netlify + Supabase)

Netlify hosts the page and the `/api/chat` function that holds your Anthropic key.
Supabase provides sign-in and cross-device progress. **The two go together on purpose:**
a public function with your key on it is an open relay — anyone who finds the URL spends
your credit — so the function rejects any request without a valid Supabase session, and
`ALLOWED_EMAILS` can narrow it further to the learners you name.

### 1. Supabase — the shared learner platform

This app stores progress on a Supabase project shared by all the language-learning
apps, so practice compounds across them (see *The shared platform* below).

1. Create a project at [supabase.com](https://supabase.com), or use the existing one.
2. SQL Editor → New query → paste `supabase/schema.sql` → Run. Safe to re-run.
3. Authentication → URL Configuration → add your Netlify site URL under **Site URL**
   and **Redirect URLs** (add `http://localhost:8787` too, for local testing).
   Email sign-in is on by default; no password is used, only a magic link.
4. Project Settings → API → copy the **Project URL** and the **anon** key into
   `src/config.js`. Both are meant to be public — RLS is what protects the data.
   Never put the `service_role` key in there.

Because the anon key is public, **every table in that project must have RLS enabled**.
Audit it with:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled, count(p.polname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by 1,2 order by rls_enabled, 1;
```

### 2. Netlify

```bash
npm install -g netlify-cli
netlify login
netlify init          # or: netlify sites:create
```

Set the function's environment variables (Site configuration → Environment variables,
or from the CLI):

```bash
netlify env:set ANTHROPIC_API_KEY sk-ant-...
netlify env:set SUPABASE_URL https://YOUR-PROJECT.supabase.co
netlify env:set SUPABASE_ANON_KEY YOUR-ANON-KEY
netlify env:set ALLOWED_EMAILS "you@example.com,student@example.com"   # optional but wise
```

Then deploy:

```bash
netlify deploy --build          # preview URL
netlify deploy --build --prod   # live
```

On the deployed site, open Settings, sign in with your email, and choose
**Server (local or hosted)** as the mode — with the page served over https the "server" is the Netlify function at the
same origin, so leave *Server address* empty.

### What lands where

| Piece | Where it runs | Holds the key? |
|---|---|---|
| `index.html`, `src/*` | Netlify CDN | no |
| `netlify/functions/chat.mjs` | Netlify Function, `/api/chat` | yes, from an env var |
| `supabase/schema.sql` | Supabase Postgres | no |
| `server/server.mjs` | your machine only | yes, from `.env` |

The function asks for `effort: 'low'` and caps `max_tokens` at 1024: a tutor reply is
short, and a serverless function has a timeout to respect. The local server has no such
pressure, so it runs with the defaults.

### Costs and limits

Netlify's and Supabase's free tiers cover a personal class comfortably. The Anthropic
bill is the one that scales with use — which is exactly why the sign-in gate and
`ALLOWED_EMAILS` exist. Watch it in the Anthropic console for the first week.

### If you would rather not host the AI at all

Deploy without setting `ANTHROPIC_API_KEY`. The site still serves the full offline tutor —
phrasebook, drills, voice, all three languages — and nothing can cost you money. Supabase
sign-in still syncs progress if you configure it.


## The shared platform

Progress does not belong to this app. It belongs to the learner, and lives in a
Supabase project shared by every language-learning app, so that a phrase drilled
in one app is the same phrase in the next and scheduling sees the whole picture.

The key idea: **the item is shared, not the app's table.**

| Table | Holds | Visible to |
|---|---|---|
| `learning_items` | canonical items, keyed by `lang` + normalized content | every signed-in learner (read, and add) |
| `learner_state` | per learner per item: counts, ease, interval, `due_at` | its owner only |
| `learning_events` | every attempt, tagged with the app that saw it | its owner only |

Identity is content, not position: `你好`, `你好。` and ` 你 好 ` are one item.
`normalize_content()` in Postgres decides that, and [src/identity.js](src/identity.js)
mirrors it so the offline tutor keys local progress the same way. This is why a
curriculum can be reordered without resetting anyone's progress.

Apps never write these tables directly. They call three functions:

```sql
record_attempt(p_lang, p_kind, p_content, p_verdict, p_app, p_mode, p_reading, p_glosses)
learner_snapshot(p_lang)          -- everything practised, for merging into local state
due_items(p_lang, p_limit)        -- what to review now, across every app
```

`record_attempt` resolves the item, writes the event and advances the schedule in
one round trip, so **every app schedules identically** — none of them can drift into
its own spaced-repetition maths. Verdicts are `right`, `partial` (right syllables,
tones not marked), `tones`, `wrong`, `skip`, `seen`.

**To adopt this in another app:** call `record_attempt` with your own `p_app` name
and the content the learner practised. Nothing else is required — no table of your
own, no migration. Read `due_items` when you want the platform to choose what to
practise next.

The event log is what makes better scheduling possible later: because every attempt
is kept, a future algorithm can be recomputed over real history rather than starting
from nothing.

## Content

Eight units, 66 phrases: greetings, introducing yourself, numbers and money, ordering
food, asking directions, shopping, time and dates, and getting by. Each phrase carries
characters, tone-marked pinyin, an English gloss, an Italian gloss, and — where a
learner usually trips — a short note in whichever language you have selected
(tone sandhi on 不, 两 vs 二 before measure words, 吗 questions, and so on).

To add material, edit `src/curriculum.js`; the tests check the shape of every entry.

## Layout

```
index.html          the app
src/i18n.js         every UI and tutor string, in zh / en / it
src/curriculum.js   the phrasebook
src/tutor.js        pinyin utilities, marking, drills, lookup, progress
src/prompt.js       the tutor's system prompt (shared by both AI modes)
src/voice.js        speech in (recognition) and out (synthesis)
src/providers.js    offline / direct / server transports
src/config.js       Supabase URL + anon key (empty = no accounts, no sync)
src/identity.js     how an item is identified, mirrored from the SQL
src/sync.js         magic-link sign-in and the shared-platform RPCs
src/app.js          UI wiring
server/server.mjs   static server + streaming proxy to the Claude API
netlify/functions/  the same proxy as a Netlify function, behind sign-in
supabase/schema.sql the shared learner platform: items, state, events, RPCs
test/               engine tests
```

The browser files are plain classic scripts with no build step, which is why the page
works straight from `file://`. The server uses `@anthropic-ai/sdk` with `claude-opus-5`.

## A note on the direct-from-browser mode

It sends `anthropic-dangerous-direct-browser-access: true`, which is what lets a page
call the API without a backend. Your key then lives in `localStorage` and is readable
by anything running on the page. That is fine for your own machine; do not host this
mode anywhere other people can reach it. Use the local server mode instead — that is
what it is for.
