<p align="center">
  <img src="docs/readme/hero.png" alt="email-flow: a dark, monospace mail client with a bucket rail, a thread list and an open thread" width="900">
</p>

<p align="center">
  <b>Mail for exactly one person.</b><br>
  Three Gmail inboxes, one keyboard, and an AI that learns how I sort.<br>
  Built for me, by me and Claude. Not a product.
</p>

<p align="center">
  <a href="#philosophy">Philosophy</a> ·
  <a href="#a-tour">Tour</a> ·
  <a href="#under-the-hood">Under the hood</a> ·
  <a href="#make-it-yours">Make it yours</a>
</p>

---

## Why

I had three Gmail accounts open in three tabs: personal, and two companies. Every client I tried was built for millions of people, so it fit none of them well. Gmail can't be configured, has no AI over my own mail, no screener for strangers, and mixes newsletters with the email that actually needs me.

So I stopped looking for the right client and built my own. The success criterion was simple: **close the Gmail tabs for two weeks and never reopen them.** They've stayed closed.

## Philosophy

**Software for one.** email-flow has exactly one user. There's no onboarding, no settings for other people's problems, no growth loop. Every decision answers one question: does this make *my* mail better? That freedom is what makes it fast.

**Make it yours, with AI.** Personalized software used to mean a team and a year. Now it's a conversation. This whole client was designed and built with Claude, feature by feature, the way I actually work. The future of software isn't one app for everyone. It's everyone with their own app.

**AI sorts, you correct.** Every new thread lands in one of five buckets: Inbox, News, Paper Trail, Receipts or Triage. The AI suggests, and every correction becomes an example it learns from. Rules are plain language ("vercel failed payments go to inbox"), and nothing is hidden: every thread shows its bucket, and moving it is one key.

**The keyboard is the interface.** Every action has a key, every key can be rebound, and triage never needs the mouse. A single command palette searches mail, runs actions, and previews bulk changes before they happen. A terminal that grew up.

**Own the truth.** My database is the source of truth and Gmail is just the transport. Triage state, snoozes, decisions and rules live in my Postgres. Read, archive and spam sync back to Gmail, so the Gmail app on my phone still works as a fallback.

## A tour

### Triage: strangers wait at the door

<img src="docs/readme/triage.png" alt="The triage view: a queue of new senders and a decision bar to let them in or keep them out" width="900">

New senders don't get into my inbox until I say so. The AI lets in the obvious ones (someone replying to a thread I started, say) and holds everyone else in Triage. Let in or keep out is one key, and it decides for every new sender in the thread at once.

### One palette for everything

<img src="docs/readme/palette.png" alt="The command palette: thread search results on the left, bulk actions with thread counts on the right" width="900">

`⌘K` searches every thread and lists the actions that apply to the results. Bulk actions show exactly which threads they'll touch before anything runs. Single-thread actions run at once and can be undone.

### Write without leaving the thread

<img src="docs/readme/compose.png" alt="A reply composing in a panel docked over the reading pane" width="900">

Replies dock over the reading pane, so the thread stays readable while you write. Rich text, per-account signatures, and replies always leave from the account that received the mail.

### Rules in plain language

<img src="docs/readme/rules.png" alt="Settings, rules: four plain-language rules, each with the AI's parsed summary" width="900">

Write a rule the way you'd say it, in English or Spanish. The AI parses it into literal conditions (sender, domain, account) and judgment calls ("failed payments"), and shows you what it understood.

### Music while you work

<img src="docs/readme/radio.png" alt="The station panel open above the status line, listing five focus stations" width="900">

The status line has a radio. Hover it, pick a station, and focus music plays while you clear the inbox. It got so much use that it now also lives in the menu bar as [Flow Radio](https://github.com/onflow-studio/flow-radio).

### In your pocket

<img src="docs/readme/phone.png" alt="email-flow on a phone: bucket tabs and a one-line thread list" width="900">

On the phone it's a home-screen web app for reading and quick replies. Heavy triage stays on the desktop.

## And also

- **Work.** A separate view for threads that need real effort, out of every bucket until they're done.
- **Snooze with intent.** Snooze can also mark a thread as needing a reply, with a deadline. When it comes back it goes to the top, and a reply in the meantime brings it back early.
- **Twins.** The same mail arriving in two accounts is grouped, and replies go out from the account it was addressed to.
- **Remote images blocked** by default, per sender when you want them.
- **Grouped machine mail.** Notifications from one service fold into a single row.

## Under the hood

| | |
| --- | --- |
| App | Next.js, React, TypeScript, Tailwind. Dark mode only, monospace only, every value from [DESIGN.md](DESIGN.md) |
| Data | Postgres with pgvector, Drizzle |
| AI | Claude: Haiku 4.5 classifies every thread, Sonnet for everything else. Optional second opinion from TypeSafe's Jev. All calls go through `lib/ai` and `lib/classify` |
| Sync | A five-minute loop over the Gmail API, with history IDs for changes and a resumable year-to-date backfill |
| Editor | Tiptap. Palette: cmdk |

It runs locally with Docker, or on Vercel with a managed Postgres, and moving between the two is a config change: no queues, no Redis, no machine-specific dependencies, secrets in env. See [docs/DEPLOY.md](docs/DEPLOY.md) for a fresh deploy.

The thinking behind it is written down:

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): what to build and why, phases, what's out of scope
- [docs/TECH-PLAN.md](docs/TECH-PLAN.md): stack, data model, pipelines, build order
- [DESIGN.md](DESIGN.md): the design system

## Make it yours

email-flow is built around my three accounts and my habits, and that's the point. Don't use mine: fork it and have your AI make it yours. Change the buckets, the keys, the colours, the rules. It's the same conversation that built it.

### One instance, one person

email-flow is single-tenant on purpose. There is no user column anywhere: one deployment holds one person's mail, from as many Gmail accounts as they connect. Everyone who can sign in sees every connected account. So `ALLOWED_EMAILS` should list only your own sign-in addresses, never a colleague's or a partner's. If two people want email-flow, run two instances with two databases.

### Run it

To run it you need Node 24 (see `.nvmrc`), pnpm, Docker, a Google Cloud OAuth client with the Gmail API enabled ([step by step](docs/GOOGLE-OAUTH.md)), and an Anthropic API key.

```sh
cp .env.example .env      # fill in, see below
docker compose up -d      # postgres with pgvector on :5432
pnpm install
pnpm db:migrate
pnpm dev                  # web on :3000
pnpm sync                 # 5-minute sync loop, in a second terminal
```

Open `/settings` and connect each Gmail account, then import this year's mail with `pnpm backfill` (resumable; `--account <email>`, `--restart`, `--batch <n>`).

Just want to look around? `pnpm seed` fills three fictional accounts with sample mail. Don't run it against a database with real mail.

To put it online, [docs/DEPLOY.md](docs/DEPLOY.md) walks through a fresh Vercel and Neon deploy.

### Testing mode: reconnect every 7 days

The Gmail scopes email-flow needs are restricted, and publishing an OAuth app with restricted scopes takes a paid security assessment. A personal instance stays in Google's Testing mode instead, where refresh tokens expire after 7 days. In practice: about once a week, open `/settings` and reconnect each account. The app warns you before a connection expires. The details are in [docs/GOOGLE-OAUTH.md](docs/GOOGLE-OAUTH.md#testing-mode-and-the-7-day-reconnect).

### What leaves your instance

Your mail lives in your Postgres. These are the only outside services the app talks to:

- **Gmail API** (Google): sync, sending, and writing read, archive, spam and bucket labels back.
- **Anthropic API**: thread contents go to Claude for classification, rule parsing and summaries.
- **TypeSafe Jev**, optional and off unless `JEV_API_KEY` is set: a second-opinion classifier. It is asked to confirm Claude's bucket suggestions (when it confidently agrees, the thread stops being marked as a suggestion), and once per new sender whether the mail comes from a person or a machine (for grouped machine mail). Each call sends the sender, subject and the first 1500 characters of the body to TypeSafe's API, which TypeSafe bills per use. Without the key nothing is sent: suggestions stay marked for you to check, and only senders that are obviously automated get grouped.
- **YouTube IFrame API**: the radio loads it from youtube.com the first time you press play. Until then nothing is requested.
- **Remote images** in mail are blocked by default. When you allow them for a sender, your browser fetches them from that sender's servers.

The font is bundled at build time, and there is no analytics or telemetry.

<details>
<summary><b>Environment variables</b></summary>

All in `.env`, which is gitignored; on Vercel, in the project's environment variables. [.env.example](.env.example) has the same list with comments.

Required:

| Variable | Purpose | Value |
|---|---|---|
| `DATABASE_URL` | Postgres with pgvector | `postgres://superfer:superfer@localhost:5432/superfer` with the compose file |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | signing in and connecting accounts | OAuth client (web application), see [docs/GOOGLE-OAUTH.md](docs/GOOGLE-OAUTH.md) |
| `GOOGLE_REDIRECT_URI` | connecting accounts | `http://localhost:3000/api/auth/google/callback`. Register it on the OAuth client together with `/api/auth/login/callback` on the same origin |
| `TOKEN_ENCRYPTION_KEY` | encrypting stored OAuth tokens | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | classification, rules, summaries | Anthropic API key |
| `ALLOWED_EMAILS` | signing in | comma-separated Google addresses allowed in. Only your own: everyone listed sees all mail from every connected account |
| `SESSION_SECRET` | signing the session cookie | at least 32 characters, `openssl rand -base64 48` |
| `SYNC_SECRET` | `/api/sync` | any long random string, sent as `Authorization: Bearer <secret>`. Needed when sync runs over HTTP (Vercel cron); `pnpm sync` doesn't use it |

Required on Vercel:

| Variable | Purpose | Value |
|---|---|---|
| `CRON_SECRET` | the five-minute sync cron | Vercel cron sends it as the bearer token. Set it to the same value as `SYNC_SECRET` |

Optional (unset keeps the default):

| Variable | Purpose | Default |
|---|---|---|
| `LOGIN_REDIRECT_URI` | sign-in callback | `/api/auth/login/callback` on `GOOGLE_REDIRECT_URI`'s origin |
| `AUTH_DISABLED` | `1` skips the login gate in development | off. Ignored in production |
| `CONNECTABLE_EMAILS` | comma-separated Gmail addresses that may be connected as accounts | any address |
| `GOOGLE_TOKEN_LIFETIME_DAYS` | days before a connection must be renewed, for the expiry warning | `7` (Testing mode). `0` turns the warnings off, for a published consent screen |
| `GMAIL_LABEL_PREFIX` | prefix of the bucket labels written to Gmail | `superfer` (labels `superfer/inbox`, `superfer/news`, …) |
| `MAIL_LOCALE` | locale for dates in quoted and forwarded headers | `en-US` |
| `JEV_API_KEY` | TypeSafe Jev second opinion, see [What leaves your instance](#what-leaves-your-instance) | unset: never called |

</details>

<details>
<summary><b>Checks</b></summary>

```sh
pnpm typecheck
pnpm lint
pnpm test                 # unit tests, lib/classify and lib/sync only
pnpm build
```

</details>

<details>
<summary><b>On the phone</b></summary>

Open the app in the phone's browser and add it to the home screen; it runs standalone from the web manifest. Running locally, the dev server already listens on the local network, so use `http://<computer-ip>:3000`. iOS adds plain-HTTP sites to the home screen; Android's install prompt needs HTTPS, which comes with hosting. Locally, connect Gmail accounts from the desktop browser, since the OAuth redirect points at localhost.

</details>

## Where it's going

Phase 1, replacing the Gmail tabs, is done: sync, AI buckets and screener, actions with undo, compose, the palette, rules and the phone layout.

Next is **an AI that knows the mail.** That means semantic search over the full history, questions in plain language ("what happened in the website relaunch project last year?"), a picture of the people, projects and companies in my mail, and a daily digest. Later, replies drafted in my own voice, and channels beyond email.

## License and contributing

MIT, see [LICENSE](LICENSE). It's a personal project, so read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and report security issues as described in [SECURITY.md](SECURITY.md).
