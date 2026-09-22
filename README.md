# superfer

A personal email client for one person. Aggregates three Gmail accounts into one keyboard-driven, dark-only web app with AI triage.

Think Superhuman's speed and HEY's screener, rebuilt as a cyberpunk terminal that grew up, with an AI layer that learns how you sort your mail and, later, answers questions about it.

## Status

Planning done, no code yet. See:

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

```
cp .env.example .env      # fill in keys
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
pnpm sync                 # separate terminal
```

Single user, private. Not a product.
