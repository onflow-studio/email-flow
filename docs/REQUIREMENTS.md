# email-flow — Requirements

> Design history. This records the original owner's requirements as decided when the project started: the goals, phases and trade-offs behind the current build. If you run your own instance, read it for the reasoning; your accounts, volume and priorities may differ.

Personal email client for one person. Aggregates several Gmail accounts, adds HEY-style triage, Superhuman-style keyboard speed, and AI that knows the mail. Decided 2026-09-22.

## Context

- Accounts: several Gmail accounts. All Google Workspace / Gmail.
- Volume: under 100 emails/day, very few need action.
- Today: Gmail in separate tabs. Frustrations: no configurability, no AI over mail, no screener, no reliable categorization, no newsletter separation.
- Motivation: make it mine, integrate AI. Inspired by Superhuman (speed) and HEY (triage model), own terminology.
- One instance serves one person. Each person who wants it runs their own copy.

## Success criterion

Close the Gmail tabs for two weeks and not reopen them except for something the client cannot do.

## Buckets

| Bucket | Contents |
|---|---|
| Inbox | Threads from people and services that matter |
| News | Newsletters and things to read. Phase 1: plain emails. Later: extracted content, possibly split. |
| Paper Trail | Order and shipping updates, transactional and account notifications |
| Receipts | Money that moved: receipts, invoices, payment confirmations, refunds, subscription charges |
| Triage | New senders waiting for a decision |

- Some transactional mail deserves Inbox (failed payments, security alerts). AI judges urgency, not just sender.
- Unified view across accounts by default, each thread shows its account, filter per account available.
- Threaded conversations (Gmail style, not HEY message-by-message).
- New/unseen threads grouped at top, seen threads below.

## Classification and learning

- AI classifies every incoming message into a bucket with a confidence score.
- Suggest first, automate when confidence is high. Thresholds per action.
- Learning by both example (user moves a message, it is stored as a correction and fed into future classification) and natural-language rules ("Vercel failed payments go to Inbox").
- Classification should be dynamic: buckets and rules learned from real data over time, AI may ask clarifying questions.
- Model output and user corrections stored separately.
- Classifier: Claude Haiku 4.5 with structured output. No memory or fine-tuning, so the correction loop is ours: inject exemplars and sender facts into each call. Its confidence is self-reported, so thresholds start conservative; a doubtful placement is applied without its suggestion note when TypeSafe's Jev, a calibrated decision model, independently picks the same bucket. General LLM (Claude) for summarization and questions.

## Screener (Triage bucket)

AI-gated:
- High-confidence spam/promo from a new sender: straight to Triage.
- High-confidence legit (replying to a thread the user started, known domain, etc.): lands in Inbox with an inline "new sender, allowed by AI, undo?" note.
- Uncertain: Triage.
- Decision outcomes per sender: Inbox, News, Paper Trail, Receipts, or out. "Out" distinguishes clear spam from "not interested now" and is reviewable.
- Corrections in either direction feed the learning loop.
- Writing in a thread beats the screener. Once the user has a message in a thread (a reply, a forward), every undecided inbound sender in it is let in by AI, the first sender included (a newsletter the user forwarded lets its sender in too), and the thread never sits in Triage: a held one moves to Inbox. Senders who already have a decision keep it. It shows with the usual "let in by AI" note, whose ok and undo cover every sender it let in; after an undo, those senders are not let in again by the same rule.
- Let in and keep out decide on every undecided inbound sender of the thread at once (a newsletter forwarded to a colleague who answered is two senders), named on the buttons, the toast and the reading pane. Senders who already have a decision keep it. With nobody undecided, they decide on the thread's first sender. One undo reverses all of them.

## Actions

- Top actions: reply all, forward, snooze.
- Reply later and snooze merge into one mechanism: snooze with an optional "needs reply" flag and optional deadline. Past due, the thread resurfaces at the top of Inbox (a Work thread returns to Work instead).
- Needs reply and deadline are the thread's own properties, independent of snooze: set from the snooze picker, or on a Work thread without snoozing.
- Work: its own view for things that need real effort after Inbox zero. `w` or the move menu moves a thread to Work from any view and out of every bucket view; a previously archived, trashed, spammed, or snoozed thread is restored so it appears in Work immediately. Inbox can reach zero. Order: overdue deadlines first, then upcoming deadlines soonest first, then the rest newest activity first, under this week, last week and older headings. Done (`w` again, or archive) archives it and takes it out of Work; delete takes it out too. A new reply keeps it in Work, unread, and never lands in Inbox. After sending a reply on a Work thread, the sent toast offers done. Snoozing a Work thread hides it until the snooze ends, then it returns to Work.
- Starred: a pin, not a place. A star keeps a thread on top of whichever list holds it (Inbox, Work, a project, Receipts, ...), in a `starred` section, for threads to keep close at hand (a booking, a doc to look at, someone to answer this week). Star from any list with `*` (Gmail's `s` is snooze here), the star on the row or in the reading pane, or `star` in the action bar. Starring a done, trashed or spam thread brings it back to its list. A move, a project, Work or a snooze keeps the star: the thread is pinned wherever it goes, and a snoozed one comes back pinned. Done (archive), delete and spam unstar it. Unstar (`*` again, the star, `unstar`) only drops the pin.
- Snoozed/reply-later lives as a separate view with a count badge; Work shows its total, marked when any thread has an unread reply. Digest is its own rail view and counts stale threads across the accounts toggled on. Work becomes stale after 7 days from entering Work, needs-reply threads without a deadline after 3 days from their last message, and Triage after 3 days from creation; these thresholds are configurable in settings from 1 to 90 days. An active snooze excludes a thread. When several rules match, Work wins, then reply, then Triage. Rows show the kind and age, oldest stale first; ordinary thread actions with undo clear them.
- Single-message triage actions execute immediately with undo, no confirmation.
- Moving a thread to Paper Trail or Receipts marks it read in the same undoable action, including a move that confirms its existing placement there. Other bucket moves preserve read state.
- Bulk actions from cmd+k show a preview list before executing.
- Exception: star and unstar act at once on the whole selection, with one undo toast for the batch. They only pin or unpin threads and one undo reverses them, so a preview would only slow them down.
- Phase 1: nothing requires confirmation beyond bulk preview.

## Compose

- Rich text: h1-h3, bold, italic, underline, links, inline images.
- Per-account signature.
- Reply always from the account that received the thread.
- New mail: toggle to choose account in compose, default is the last account the user was reading or sending from.

## Command palette (cmd+k)

- Single entry point for search, questions, and actions.
- Phase 1: keyword search over synced mail, actions with preview.
- Phase 1.5: semantic search over full history, natural-language questions, e.g. "what happened in the website relaunch project last year", "find the school's class calendar for this year", "show me all emails related to Vercel bills".
- Can take actions on results (archive, move, etc.) after preview.

## Semantic layer (phase 1.5)

- AI-built knowledge over people, projects, companies, inferred from data, may ask questions.
- All history across all connected accounts, size unknown.
- Attachments: metadata only (filename, type, sender). No content extraction.
- Minimal sender card on each thread: name, which accounts they email, thread count, last contact, screener decision (editable).
- Retrieval architecture: hybrid full-text plus vector search with metadata filters, inspired by tobi/qmd but not a dependency (file-only ingestion, local-only models).

## Keyboard

Full keyboard triage in phase 1: navigate, archive, reply, snooze, move to bucket, open cmd+k. No user-defined split inboxes (redundant with AI buckets). Revised 2026-10-29: the owner names projects, buckets of their own mirrored to Gmail labels; see TECH-PLAN.

Every shortcut has a default and can be rebound in settings (keyboard): single keys, modifiers, two-key sequences, or unbound. A few structural keys are fixed (esc, enter, arrows, mod+enter in compose, mod+z). Two actions never share a key in the same scope.

## Gmail sync (hybrid model)

- Own database is source of truth for triage state. Gmail is transport plus rough mirror.
- Poll every 5 minutes, plus manual refresh button.
- Mirrored both ways: read/unread, archive, trash, spam, star (Gmail's `STARRED`). A star added or removed in Gmail stars or unstars the thread here, on the same rules, and a star on any copy of a twin acts on all of them. Mail already starred in Gmail is pinned in its list.
- One-way client to Gmail: one label per bucket.
- Client-only: snooze, work, screener decisions, deadlines.
- Actions taken in the Gmail app (e.g. archive from phone) flow back on next poll.

## Platform

- Web app, dark mode only, responsive. Installed on phone home screen as a web app.
- Mobile use: reading and quick replies. Heavy triage on desktop.
- Hosting: runs on the user's Mac first, later hosted (Vercel plus a managed Postgres such as Neon). Stack must be portable: no Mac-only dependencies, secrets in env.
- ANTHROPIC_API_KEY in .env (gitignored).

## Explicitly out of phase 1

- Offline mode, push notifications, multiple windows, light mode.
- AI-drafted replies in the user's voice (nice-to-have, later).
- Contacts directory beyond the minimal card.
- Daily digest.
- Integrations: Linear, calendar, WhatsApp. Data model should treat email as one channel among several.
- News content extraction.

## Phases

### Phase 1: replace the Gmail tabs
1. All connected accounts synced, unified thread list, account indicator
2. AI buckets with learn-from-corrections and NL rules
3. AI-gated screener
4. Reply all, forward, snooze-with-flag, work
5. Rich text compose, per-account signature, account toggle
6. Keyboard triage
7. cmd+k with keyword search and actions with preview
8. Dark mode responsive web

### Phase 1.5: AI that knows the mail
- Full-history import (background job) and semantic search
- Semantic layer: people, projects, companies
- Natural-language questions in cmd+k
- Minimal sender card
- Daily digest and stale-item nudges

### Later
- News content extraction
- AI-drafted replies in own voice
- Linear, calendar, WhatsApp integrations
- Hosted deployment
