# email-flow

Personal email client over any number of Gmail accounts. One instance serves one person; anyone can run their own. Read these before any work:

- `docs/REQUIREMENTS.md`: the original requirements, kept as design history: what to build and why, phases, what is out of scope
- `docs/TECH-PLAN.md`: stack, data model, pipelines, build order
- `DESIGN.md`: visual tokens and rules, every UI value comes from here

## Rules

- Buckets are named Inbox, News, Paper Trail, Receipts, Triage. Never use HEY's terminology.
- Own database is the source of truth. Gmail is transport plus a rough mirror. See the write-back section of the tech plan before touching sync.
- All AI calls go through `lib/ai` or `lib/classify`. No provider imports elsewhere.
- Single-thread actions execute immediately with undo. Bulk actions preview first.
- Remote images blocked by default.
- Dark mode only. Monospace only. No value outside DESIGN.md without adding it there first.
- Tests only on `lib/classify` and `lib/sync`.
- Never assume a number of accounts, an owner's name, or anything else about one person's setup. Read accounts from the database.
- Keep moving between a local machine and Vercel config-only: no Redis, no queues, no worker services, no OS-specific dependencies, secrets in env.
- Package manager: pnpm. Add files to git individually, never `git add .`.
- Secrets live in `.env`, which is gitignored. Never commit keys.

- No personal info in the repo, issues, commits or images: no real names, addresses, companies or places. Sample data is fictional (Alex Rivera, `*.example`, accounts personal / work1 / work2).
- Copy voice: "email that works your way", sentence case, no hype. Never "for one person".
- Some internal identifiers keep the app's former name on purpose: Gmail labels (`GMAIL_LABEL_PREFIX` default), cookies, localStorage keys, lock names, Docker and database names. Renaming them would orphan Gmail labels, log people out or reset settings.

## Deploying

- Production runs on Vercel from `master`; Postgres must use the direct (unpooled) URL. Migrations are not part of the build: apply them by hand to the production database before pushing code that needs them. See `docs/DEPLOY.md`.
- Self-hosting is the other supported path: `Dockerfile` and `docker-compose.self-host.yml`, see `docs/SELF-HOST.md`. Changes to env, scripts or migrations must keep both working.
- The functions region is a Vercel project setting, not `vercel.ts` (it's compiled before env vars exist).
- After pushing, confirm the deploy started; some pushes don't trigger one.

## Screenshots

README and website images come from a separate demo database seeded with `pnpm seed`, never real mail. Run a copy of the app against that database on another port, capture with a headless browser at 2x, and frame with the cyan → periwinkle gradient.

## Running

```
docker compose up -d      # postgres
pnpm db:migrate           # apply migrations
pnpm dev                  # web on :3000
pnpm sync                 # 5-minute sync loop, separate terminal
```

@AGENTS.md
