# superfer — Tech Plan

Companion to REQUIREMENTS.md and DESIGN.md. Decided 2026-09-23.

## Principles

1. Mac first, hosted later, with the move being config only: change the database URL, add a cron, update the OAuth redirect. No rewrite.
2. One language, one process type. TypeScript everywhere. No Redis, no queue service, no separate worker service. Background work is rows in a table processed by a function.
3. Own database is the source of truth for triage state. Gmail is transport plus a rough mirror.
4. Vendors behind one module. Nothing outside `lib/ai` knows which model or gateway answered.
5. Tests only where silent failure misfiles mail: classification and sync.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js App Router, TypeScript | Runs as one process on the Mac, deploys to Vercel unchanged, AI SDK native |
| Package manager | pnpm | Fast, strict |
| Database | Postgres 16 with pgvector, Docker locally, Neon later | Same engine both places, built-in full-text search now, vectors in 1.5 |
| ORM | Drizzle | SQL-shaped, migrations are plain SQL that run identically on Neon |
| Gmail | Google APIs Node client, OAuth 2 per account | Official, supports history sync and label writes |
| Classification | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via `@ai-sdk/anthropic`, structured output | Fast, cheap, same key as the rest; probabilities are self-reported, so thresholds sit higher |
| LLM | Claude via `@ai-sdk/anthropic` with existing key | Summaries, questions, later drafts |
| Embeddings | Deferred to 1.5, likely via Vercel AI Gateway | No key yet, not needed in phase 1 |
| UI | Tailwind 4, shadcn base, custom tokens from DESIGN.md | Fast to build, restyled hard so it isn't generic |
| Palette | cmdk | Keyboard-first command palette, extensible with actions |
| Editor | Tiptap | ProseMirror, emits clean HTML, h1-h3 bold italic underline links images |
| Email HTML | sanitize-html server-side, sandboxed iframe render | Strip scripts and trackers, block remote images by default |
| Sync process | Separate Node script, `pnpm sync`, loops every 5 min | Mirrors Vercel cron later, decoupled from web server |
| Tests | Vitest, unit only on `lib/classify` and `lib/sync` | Lighter to start |

## Repo layout

```
superfer/
  app/                    Next.js routes and UI
    (mail)/               three-pane shell, buckets, thread, compose
    api/sync/route.ts     POST triggers one sync pass, used by cron later
    api/auth/google/      OAuth start and callback per account
  lib/
    db/                   drizzle schema, client, migrations
    gmail/                client factory, fetch, history, label writes, send
    sync/                 orchestration: poll, store, enqueue classify, write back
    classify/             classifier prompt, thresholds, correction context, rules
    ai/                   provider wiring, summarize, later embed and ask
    mail/                 html sanitize, text extraction, thread grouping
    actions/              archive, snooze, set aside, move, undo log
  scripts/
    sync.ts               loop runner for the Mac
    backfill.ts           year-to-date import per account
  docker-compose.yml      postgres with pgvector
  DESIGN.md
  docs/
```

## Data model

Core tables, Drizzle in `lib/db/schema.ts`.

- `accounts`: id, email, label, color, oauth tokens (encrypted at rest with a key from env), gmail history cursor, last sync at, signature html.
- `threads`: id, account id, gmail thread id, subject, last message at, bucket (inbox, news, paper_trail, triage, out), bucket source (ai, user, rule), bucket confidence, seen at, snoozed until, needs reply, set aside at, archived, participants summary.
- `messages`: id, thread id, gmail message id, from, to, cc, date, snippet, html sanitized, text, is inbound, gmail labels, headers subset (list-unsubscribe, precedence, in-reply-to).
- `attachments`: id, message id, filename, mime, size, gmail attachment id. Metadata only.
- `senders`: id, email, domain, display name, first seen, screener decision (allowed, out_spam, out_not_now, none), decided at, decided by (ai, user), images allowed, notes. Shared across accounts, with a per-account seen count in a join table.
- `classifications`: id, thread id, model, raw response json, bucket probabilities, urgency, human written, legit new sender, created at. Append-only.
- `corrections`: id, thread id, sender id, from bucket, to bucket, created at. Append-only, feeds classify context.
- `rules`: id, text, structured json parsed by Claude on save, enabled, created at.
- `jobs`: id, type (classify, writeback, backfill), payload json, status, attempts, run after, error. The queue.
- `actions_log`: id, thread id, action, payload, undone at. Powers undo.

Phase 1.5 adds `embeddings` (chunk, vector) and `entities` (people, projects, companies) with `entity_links`.

## Sync pipeline

`lib/sync/run.ts` does one pass for one account:

1. Call Gmail history list from the stored cursor. With no cursor (first sync) or a stale one, store a fresh cursor at once and record a catch-up listing in `accounts.catch_up` (the last 14 days, or since last sync at). Each pass works through up to 250 of its threads in saved batches, so a quota error or restart loses at most one batch.
2. For each new or changed message: fetch full, sanitize, upsert message and thread. Mirror read state and archive state from Gmail labels into our columns.
3. For each thread that is new and inbound: enqueue a classify job.
4. Process pending jobs for the account: classify, then writeback.
5. Store the new cursor.

Every Gmail call goes through a per-account limiter in `lib/gmail/quota.ts`: at most 4 calls in flight, a token bucket spending 100 quota units a second (Gmail allows 15,000 a minute per user, shared by the loop, backfill and web), and 429 or rate-limit 403 retries with jittered exponential backoff that honor Retry-After. A pass that still runs out of quota ends quietly and resumes next pass; it is not a sync failure.

`scripts/sync.ts` loops all accounts every 5 minutes. `app/api/sync/route.ts` runs one pass, protected by a bearer secret, so a Vercel cron can hit it later. The refresh button calls the same route.

Initial backfill: `scripts/backfill.ts` walks messages from January 1 of the current year forward, per account, in batches, enqueuing classify for each thread but with a lower priority so live mail is never behind history. It paces Gmail through the same limiter on a smaller budget (`--rate`, default 60 units a second, about a quarter of the per-user quota) and waits out rate limits instead of failing.

## Classification pipeline

`lib/classify/classify.ts`, one Claude Haiku 4.5 call per thread, structured output validated against a zod schema:

- Prompt: a fixed system prompt (bucket, urgency and screening definitions) marked for prompt caching, then a user message with sender facts (domain, prior decision, counts across accounts), subject, first 2k chars of text, headers like list-unsubscribe and precedence, the enabled rules, and up to 5 similar recent corrections (same sender or domain first, then same subject words) as examples.
- Output in one call: probabilities for inbox, news and paper_trail (normalized to sum to 1, top one is the bucket), urgency 1-5, human written probability, and if sender is unknown, legit new sender probability. The raw output and model id go to `classifications`. Errors and 429s throw with SDK retries off, so the job runner's backoff retries.
- Thresholds in `lib/classify/thresholds.ts`, per bucket. Above threshold: apply and set bucket source ai. Thresholds sit a notch above what a calibrated classifier would need, since the model reports its own confidence. Below: apply the top bucket but mark as suggested and show the `--info` inline note. Unknown sender below the legit threshold: bucket triage.
- Urgency 4 or higher on a paper_trail result promotes to inbox. This is the failed-payment rule.

User moves write a correction row and set bucket source user. Rules are entered as text in settings, Claude parses them into structured hints stored alongside, and both text and structure go into the classifier prompt.

## Write back to Gmail

`lib/sync/writeback.ts`, run as jobs so failures retry:

- Ensure labels `superfer/inbox`, `superfer/news`, `superfer/paper-trail`, `superfer/triage` exist per account.
- On bucket change: set the matching label, remove the others. For news, paper_trail, and triage: also remove INBOX so Gmail's inbox mirrors our Inbox bucket.
- Read, archive, trash, spam: mirror both ways. Gmail changes come in via history, ours go out via modify.
- Snooze, set aside, screener decisions, deadlines: never written to Gmail.

## Actions and undo

Every user action goes through `lib/actions`. It writes the local change, logs to `actions_log`, enqueues writeback, and returns an undo token. The UI shows the toast and calls undo with the token. Single-thread actions never confirm. Bulk actions from the palette call a preview function first that returns the affected thread list.

## Command palette

cmdk with three sources: navigation (buckets, accounts, settings), thread search, and actions. Phase 1 search is Postgres full-text over subject, sender, and text with a tsvector column and a GIN index, with simple filters parsed from the query: `from:`, `account:`, `before:`, `after:`. Actions on results show the preview count in `--info` and execute after Enter.

## Keyboard

Global handler in the mail shell. Phase 1 map:

```
j / k         next / previous thread
← / →         focus rail / list / reading pane (→ in the list opens the thread)
↑ / ↓         move in the focused pane: rail items, threads, or scroll and step messages
enter         open thread
esc           back to list
e             archive
r / a / f     reply / reply all / forward
s             snooze (opens picker, with needs-reply toggle)
h             set aside
1 2 3         move to inbox / news / paper trail
x             keep out (from triage)
i             let in (from triage)
u             unsubscribe (one-click, else mailto, else opens the page)
#             delete (to trash)
z / cmd+z     undo last
g then i/n/p/t  go to bucket
cmd+k         palette
/             search
c             compose
?             show this map
```

## Compose

Tiptap editor with the allowed marks only. On send: HTML plus a generated text alternative, signature for the selected account appended, sent via Gmail send with the thread id for replies. Account selection: reply uses the thread's account, new compose defaults to the last active account stored in local state.

## Rendering

Server sanitizes HTML on ingest and stores it. The reading pane renders it in an iframe with `sandbox` and a strict CSP, no remote images unless the sender or message is allowed. Dark rendering: a light-background email is inverted with a hue rotation filter, and an email that declares a dark color scheme is left alone. Attachments list from metadata with a link that opens the Gmail attachment URL.

## Mobile

Same app, responsive. Below 768px the shell becomes list-then-thread with a back header. Touch rows at 44px. Compose is a full-screen sheet. Palette works but is not the primary path. Install as a home-screen web app through a manifest.

## Environment

```
DATABASE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
TOKEN_ENCRYPTION_KEY
ANTHROPIC_API_KEY
SYNC_SECRET
```

## Hosting later

1. Neon from Vercel marketplace, `DATABASE_URL` set automatically.
2. `pnpm drizzle-kit migrate` against Neon.
3. Cron in `vercel.ts` hitting `/api/sync` every 5 minutes with the secret.
4. Update `GOOGLE_REDIRECT_URI` in Google Cloud and env.
5. Optionally swap providers in `lib/ai` for AI Gateway model strings.

## Build order

1. Scaffold: Next.js, Tailwind, shadcn, Drizzle, Docker compose, env, DESIGN.md tokens as CSS variables.
2. Accounts: OAuth flow, token storage, three accounts connected.
3. Sync: history polling, message storage, sanitize, `pnpm sync` loop, refresh route.
4. Shell: three panes, bucket rail, thread list, reading pane, status line, keyboard nav. Static buckets from Gmail labels at first.
5. Classify: Claude call, thresholds, corrections, inline notes, triage bucket, write back.
6. Actions: archive, snooze with flag, set aside, move, undo, Gmail mirror.
7. Compose: Tiptap, signatures, reply all, forward, send.
8. Palette: navigation, full-text search, actions with preview.
9. Backfill year to date, rules in settings.
10. Mobile pass, manifest, polish against DESIGN.md.
11. Unit tests on classify and sync.

Success check: two weeks without opening the Gmail tabs.
