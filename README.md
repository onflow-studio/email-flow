# superfer

A personal email client for one person. Aggregates three Gmail accounts into one keyboard-driven, dark-only web app with AI triage.

Think Superhuman's speed and HEY's screener, rebuilt as a cyberpunk terminal that grew up, with an AI layer that learns how you sort your mail and, later, answers questions about it.

## Status

Phase 1 built: sync, AI buckets and screener, actions with undo, compose, palette, backfill and rules, phone layout. See:

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): features, phases, scope
- [docs/TECH-PLAN.md](docs/TECH-PLAN.md): stack, data model, pipelines, build order
- [DESIGN.md](DESIGN.md): design system

## Core ideas

- **Four buckets**: Inbox, News, Paper Trail, Triage. AI sorts, you correct, it learns.
- **AI-gated screener**: new senders are held in Triage unless the AI is confident they're legit.
- **Own database is the truth**: Gmail becomes transport plus a rough mirror, so the Gmail app still works as a fallback.
- **Keyboard first**: full triage without a mouse, command palette for search and actions.
- **Mac first, hosted later**: Postgres in Docker now, Neon and Vercel later, with the move being config only.

## Stack

Next.js, TypeScript, Postgres with pgvector, Drizzle, Jev for classification, Claude for the rest, Tailwind, Tiptap, cmdk.

## Running

Needs Node 20.9+ (Next.js 16), pnpm, and Docker.

```
cp .env.example .env      # fill in, see below
docker compose up -d      # postgres with pgvector on :5432
pnpm install
pnpm db:migrate
pnpm dev                  # web on :3000
pnpm sync                 # 5-minute sync loop, separate terminal
```

Then open `/settings` and connect each Gmail account. Once connected:

```
pnpm backfill             # year-to-date import, resumable; --account <email>, --restart, --batch <n>
```

Without Gmail, `pnpm seed` fills three fake accounts with sample threads so the UI can be tried. It replaces only its own `seed-` threads, but do not run it against a database with real mail.

### Environment

All in `.env` (gitignored).

| Variable | Needed for | Value |
|---|---|---|
| `DATABASE_URL` | everything | `postgres://superfer:superfer@localhost:5432/superfer` with the compose file |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | connecting accounts | OAuth client (web application) in Google Cloud, Gmail API enabled |
| `GOOGLE_REDIRECT_URI` | connecting accounts | `http://localhost:3000/api/auth/google/callback`, also listed on the OAuth client |
| `TOKEN_ENCRYPTION_KEY` | storing OAuth tokens | `openssl rand -base64 32` |
| `JEV_API_KEY` | classification | Jev (TypeSafe AI) key |
| `ANTHROPIC_API_KEY` | parsing rules in settings (Claude) | Anthropic API key |
| `SYNC_SECRET` | `POST /api/sync` (cron later) | any long random string, sent as `Authorization: Bearer <secret>` |

### Checks

```
pnpm typecheck
pnpm lint
pnpm test                 # unit tests, lib/classify and lib/sync only
pnpm build
```

### Phone

Open the app from the phone's browser and add it to the home screen: it runs standalone from the web manifest. On the Mac setup the dev server already listens on the local network, so use `http://<mac-ip>:3000`. iOS adds plain-HTTP sites to the home screen; Android's install prompt needs HTTPS, which comes with hosting. Connect Gmail accounts from the desktop browser, since the OAuth redirect points at localhost.

Single user, private. Not a product.
