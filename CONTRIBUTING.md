# Contributing

email-flow is a personal mail client, built to be forked and changed. Issues and pull requests are welcome, but features are judged by whether they fit one person's mail, not by how many people want them.

## Setup

Follow **Make it yours** in the [README](README.md) for local setup: Node 24 (see `.nvmrc`), pnpm, Docker for Postgres, a Google OAuth client and an Anthropic API key. To deploy your own copy, see [docs/DEPLOY.md](docs/DEPLOY.md).

Read these before larger changes:

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): what to build and why, and what is out of scope
- [docs/TECH-PLAN.md](docs/TECH-PLAN.md): stack, data model, pipelines
- [DESIGN.md](DESIGN.md): visual tokens and rules

## Checks

Run these before opening a pull request. CI runs the same ones, and none of them need secrets or a database.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

## Conventions

- **Package manager:** pnpm only. Commit `pnpm-lock.yaml` changes with the dependency change that caused them.
- **Tests** live only in `lib/classify` and `lib/sync`, where a silent failure misfiles mail. Other code is not unit tested.
- **Design:** every UI value (color, size, spacing, font) comes from DESIGN.md. Dark mode only, monospace only. If you need a new value, add it to DESIGN.md first.
- **AI calls** go through `lib/ai` or `lib/classify`. No provider SDK imports anywhere else.
- **Buckets** are Inbox, News, Paper Trail, Receipts and Triage.
- **Sync:** the app's database is the source of truth and Gmail is transport plus a mirror. Read the write-back section of the tech plan before changing sync.
- **Actions:** single-thread actions run immediately with undo; bulk actions show a preview first.
- **Hosting stays config-only:** no Redis, no queues, no worker services, no platform-specific dependencies, secrets in env.
- **Migrations:** change `lib/db/schema.ts`, then `pnpm db:generate`, and commit the generated SQL.
- **Secrets:** never commit `.env` or keys.

## Security issues

Report them privately, as described in [SECURITY.md](SECURITY.md).
