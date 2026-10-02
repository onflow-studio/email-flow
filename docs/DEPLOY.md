# Deploy

How to run your own copy of email-flow on Vercel with a Neon Postgres database. Any Postgres 16 that gives you a direct connection works; Neon is what this guide uses.

You need:

- A fork of this repository on GitHub
- A Vercel account (Pro for the built-in five-minute sync, see [Scheduled sync](#5-scheduled-sync))
- A Neon account, or another hosted Postgres
- A Google Cloud OAuth client with the Gmail API enabled ([GOOGLE-OAUTH.md](GOOGLE-OAUTH.md))
- An Anthropic API key
- Node 24 and pnpm locally, to run migrations and the backfill

## 1. Database

Create a Neon project and database, either directly in Neon or through the Vercel Marketplace integration.

**Use the direct (unpooled) connection string for `DATABASE_URL`.** Sync takes session-level advisory locks on a reserved connection so two passes never run at once. A transaction-mode pooler (Neon's `-pooler` host) cannot keep those locks. In Neon's connection dialog, turn pooling off and copy that string. If you use the Marketplace integration, it sets `DATABASE_URL` to the pooled string; copy the value of `DATABASE_URL_UNPOOLED` into `DATABASE_URL` instead.

Apply the migrations from your machine:

```sh
pnpm install
DATABASE_URL='postgres://…direct connection string…' pnpm db:migrate
```

Migrations are applied by hand. The Vercel build does not run them. When you pull changes that add a migration, run `pnpm db:migrate` against the production database **before** the code that needs it deploys.

A variable set in your shell wins over `.env`, so a local `.env` pointing at Docker stays untouched.

## 2. Secrets

Generate these once and keep a copy somewhere safe:

```sh
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # SYNC_SECRET, also used as CRON_SECRET
```

`TOKEN_ENCRYPTION_KEY` encrypts the Gmail refresh tokens in the database. If you lose or change it, every account has to be reconnected.

## 3. Vercel project

In Vercel, create a new project and import your fork. The framework preset is Next.js; the build command and output need no changes. `vercel.ts` holds the project config (cron and region).

Set the environment variables below for the Production environment, then deploy.

### Environment variables

Required:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Direct (unpooled) Postgres connection string from step 1 |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<your-domain>/api/auth/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 |
| `SESSION_SECRET` | At least 32 characters, signs the session cookie |
| `ALLOWED_EMAILS` | Comma-separated Google accounts allowed to sign in. Everyone listed sees all connected mail |
| `ANTHROPIC_API_KEY` | Anthropic API key, used for classification, summaries and rules |
| `SYNC_SECRET` | Bearer token for `/api/sync` |
| `CRON_SECRET` | Same value as `SYNC_SECRET`, see below |

Optional:

| Variable | Effect |
| --- | --- |
| `LOGIN_REDIRECT_URI` | Sign-in callback. Unset, it is `/api/auth/login/callback` on `GOOGLE_REDIRECT_URI`'s origin |
| `JEV_API_KEY` | TypeSafe Jev key for a second opinion on doubtful classifications. Unset, suggestions stay suggestions |
| `CONNECTABLE_EMAILS` | Optional. Unset keeps the default |
| `GOOGLE_TOKEN_LIFETIME_DAYS` | Optional. Unset keeps the default |
| `DEPLOY_REGION` | Optional. Unset keeps the default |
| `GMAIL_LABEL_PREFIX` | Optional. Unset keeps the default |
| `MAIL_LOCALE` | Optional. Unset keeps the default |

Do not set `AUTH_DISABLED`. It only works outside production anyway: it is ignored when `NODE_ENV` is `production`.

**Why `CRON_SECRET` equals `SYNC_SECRET`:** Vercel cron sends `Authorization: Bearer <CRON_SECRET>` on every scheduled call, and `/api/sync` only accepts `SYNC_SECRET`. Setting both to the same value makes the cron authenticate. Rotate them together.

Keep production credentials out of the Preview and Development environments unless you want previews to read and write real mail.

## 4. Google OAuth redirect URIs

Add both production callbacks to the OAuth client's authorized redirect URIs in Google Cloud, next to the localhost ones:

- `https://<your-domain>/api/auth/google/callback` (connecting Gmail accounts)
- `https://<your-domain>/api/auth/login/callback` (signing in)

[GOOGLE-OAUTH.md](GOOGLE-OAUTH.md) covers creating the client, scopes and the consent screen.

## 5. Scheduled sync

`vercel.ts` schedules `GET /api/sync` every 5 minutes, and `app/api/sync/route.ts` sets `maxDuration = 300` so a first sync can pull a couple of weeks of mail. Both need the Vercel **Pro** plan: Hobby only allows cron jobs that run once a day, and a five-minute schedule fails the deployment. Check Vercel's current plan limits if in doubt.

**On Hobby**, change the schedule in `vercel.ts` to once a day (or remove the `crons` entry) and trigger sync from an external scheduler instead, such as a GitHub Actions `schedule` workflow or any cron service:

```sh
curl -fsS -X POST -H "Authorization: Bearer $SYNC_SECRET" https://<your-domain>/api/sync
```

The route accepts GET and POST with the same bearer token, runs one pass over all accounts, and returns the per-account outcomes as JSON (HTTP 500 if any account errored). Add `?account=<account id>` to sync one account. Sync works in saved batches, so a pass cut short by a lower duration limit resumes on the next call.

Run one sync writer per database: either the hosted cron or a local `pnpm sync` pointed at the same database, not both.

## 6. First run

1. Open `https://<your-domain>` and sign in with an address from `ALLOWED_EMAILS`.
2. Go to `/settings` and connect each Gmail account.
3. The next sync pass imports the last two weeks. To import the rest of this year, run the backfill from your machine against the production database. It needs the same database, Google and encryption settings as production, and the Anthropic key to classify what it imports:

   ```sh
   DATABASE_URL='…direct…' \
   TOKEN_ENCRYPTION_KEY='…' \
   GOOGLE_CLIENT_ID='…' GOOGLE_CLIENT_SECRET='…' \
   GOOGLE_REDIRECT_URI='https://<your-domain>/api/auth/google/callback' \
   ANTHROPIC_API_KEY='…' \
   pnpm backfill
   ```

   It is resumable: stop it any time and run it again. Options: `--account <email>`, `--restart`, `--batch <n>`, `--rate <units/s>`. It shares Gmail quota politely with the hosted sync, so leave the cron running.

The other maintenance scripts (`pnpm summarize`, `pnpm participation`, `pnpm twins`, `pnpm confirm`) take the same environment.

## Google consent screen in Testing mode

While the OAuth consent screen is in **Testing**, Google expires Gmail refresh tokens after 7 days. Each connected account then has to be reconnected from `/settings`. Publishing the app (or using an Internal app for Google Workspace accounts) removes the limit; see [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md).

## Checking that it works

- Vercel's Logs for `/api/sync`, or `vercel logs --environment production --query '/api/sync'`.
- The JSON outcome per account: `ok`, `reauth` (reconnect in `/settings`), `busy`, `throttled` or `error`. Only `error` makes the response an HTTP 500, so check the outcomes as well as the status code.
