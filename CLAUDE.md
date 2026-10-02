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

## Running

```
docker compose up -d      # postgres
pnpm db:migrate           # apply migrations
pnpm dev                  # web on :3000
pnpm sync                 # 5-minute sync loop, separate terminal
```

@AGENTS.md
