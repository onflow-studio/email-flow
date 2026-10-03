# Self-host

How to run your own copy of email-flow on a machine you control: a VPS, a home server or your own computer. Docker Compose is the documented path. It runs four services from one file:

- `db`: Postgres 16 with pgvector, data in a named volume
- `migrate`: applies database migrations, then exits. The app waits for it
- `web`: the Next.js server
- `sync`: the five-minute sync loop over the Gmail API

There is nothing else: no Redis, no queue, no extra workers. To host on Vercel with a managed Postgres instead, see [DEPLOY.md](DEPLOY.md).

## Requirements

- Docker with Compose v2 (`docker compose version`)
- About 2 GB of free disk for the images, plus room for your mail in Postgres
- A Google Cloud OAuth client with the Gmail API enabled ([GOOGLE-OAUTH.md](GOOGLE-OAUTH.md))
- An Anthropic API key
- For anything beyond your own computer: a domain name and HTTPS, see [HTTPS](#https)

## 1. Configure `.env`

```sh
git clone https://github.com/<you>/email-flow.git
cd email-flow
cp .env.example .env
```

Fill in `.env`. Generate the secrets once and keep a copy somewhere safe:

```sh
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # SYNC_SECRET
```

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | Password of the bundled database. The compose file builds `DATABASE_URL` from it, so the `DATABASE_URL` line in `.env` is not used |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From your OAuth client |
| `GOOGLE_REDIRECT_URI` | `https://<your-domain>/api/auth/google/callback`, or `http://localhost:3000/api/auth/google/callback` on your own computer |
| `TOKEN_ENCRYPTION_KEY` | Encrypts the Gmail refresh tokens in the database. Lose or change it and every account has to be reconnected |
| `SESSION_SECRET` | Signs the session cookie |
| `ANTHROPIC_API_KEY` | Classification, rules and summaries |
| `ALLOWED_EMAILS` | Your own Google addresses only. Everyone listed sees all connected mail |
| `SYNC_SECRET` | Bearer token for `/api/sync`. The sync container doesn't use it, but set it anyway so the endpoint stays closed |
| `WEB_PORT` | Optional. Host port for the web app, default `3000` |
| `WEB_BIND` | Optional. Host address the port is published on, default `127.0.0.1` (only reachable from the machine itself, for a reverse proxy). Set `0.0.0.0` to expose it directly |

The optional variables in the [README](../README.md#make-it-yours) work the same here. Leave `AUTH_DISABLED` unset: the containers run in production mode, where it is ignored.

**Redirect URIs must match your public URL.** In the OAuth client, add both callbacks for the address you will open in the browser, exactly, scheme and port included:

- `https://<your-domain>/api/auth/google/callback`
- `https://<your-domain>/api/auth/login/callback`

The sign-in callback is derived from `GOOGLE_REDIRECT_URI`, so the two always share an origin.

## 2. Start it

```sh
docker compose -f docker-compose.self-host.yml up -d --build
```

The first build takes a few minutes. Then:

```sh
docker compose -f docker-compose.self-host.yml ps        # db healthy, migrate exited (0), web and sync up
docker compose -f docker-compose.self-host.yml logs -f sync
```

The web app listens on `http://127.0.0.1:3000` (or your `WEB_PORT`). Until an account is connected, sync logs `sync idle, no accounts connected` every five minutes.

`docker-compose.yml`, without the suffix, is a different file: the database for local development. Don't mix the two.

## 3. First run

1. Open your URL and sign in with an address from `ALLOWED_EMAILS`.
2. Go to `/settings` and connect each Gmail account. The first time, Google warns that it hasn't verified the app; that is expected for your own Testing-mode client.
3. The next sync pass imports the last two weeks. To import the rest of this year, run the backfill inside the sync container:

   ```sh
   docker compose -f docker-compose.self-host.yml exec sync pnpm backfill
   ```

   It is resumable: stop it any time and run it again. Options: `--account <email>`, `--restart`, `--batch <n>`, `--rate <units/s>`. It shares Gmail quota with the sync loop, so leave that running.

The other maintenance scripts run the same way: `pnpm summarize`, `pnpm participation`, `pnpm twins`, `pnpm confirm`.

## Updating

```sh
git pull
docker compose -f docker-compose.self-host.yml up -d --build
```

`migrate` runs again on every `up` and applies any new migrations before `web` and `sync` restart. Old images pile up over time; `docker image prune` clears them.

## Backups

Your mail, buckets, rules and decisions are all in Postgres. Dump it regularly, for example from a daily cron job:

```sh
docker compose -f docker-compose.self-host.yml exec -T db \
  pg_dump -U emailflow -d emailflow -Fc > email-flow-$(date +%F).dump
```

Restore into a fresh stack (stop `web` and `sync` first so nothing writes during the restore):

```sh
docker compose -f docker-compose.self-host.yml stop web sync
docker compose -f docker-compose.self-host.yml exec -T db \
  pg_restore -U emailflow -d emailflow --clean --if-exists < email-flow-2026-01-31.dump
docker compose -f docker-compose.self-host.yml start web sync
```

Back up `.env` too, somewhere private. Without the same `TOKEN_ENCRYPTION_KEY` a restored database can't use its stored Gmail tokens, and every account has to be reconnected.

`docker compose down` keeps the data. `docker compose down -v` deletes the database volume.

## HTTPS

Put the app behind a reverse proxy that terminates HTTPS. In production the session cookie is marked `Secure`, so signing in only works over HTTPS, or over plain HTTP on `localhost`. Phones also need HTTPS to install the app from the browser.

[Caddy](https://caddyserver.com/) on the same machine gets and renews a certificate by itself. With the default `WEB_BIND=127.0.0.1`, the app is reachable only through it. A complete `Caddyfile`:

```
mail.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Point the domain's DNS at the server, open ports 80 and 443, and run Caddy. Any other proxy (nginx, Traefik, a Cloudflare tunnel) works the same way: forward to the web port and keep the `Host` header.

## Testing mode: reconnect every 7 days

While the OAuth consent screen is in Testing, Google expires Gmail refresh tokens after 7 days. About once a week, open `/settings` and reconnect each account; the app warns you before a connection expires, and sync logs `reconnect required` for an expired one. Details in [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md#testing-mode-and-the-7-day-reconnect).

## Using your own Postgres

To use a database you already run, remove the `DATABASE_URL` line under `x-app` in `docker-compose.self-host.yml`, set `DATABASE_URL` in `.env`, and drop the `db` service and the `migrate` dependency on it. Use Postgres 16 or later with a direct connection, not a transaction-mode pooler: sync holds session-level advisory locks. The pgvector image is used so planned semantic search can arrive without a database change; no migration needs the extension yet.

## Without Docker

Any machine with Node 24, pnpm and Postgres 16 or later runs it directly:

```sh
pnpm install
pnpm db:migrate           # with DATABASE_URL in .env
pnpm build
pnpm start                # web on :3000, PORT=… to change it
pnpm sync                 # the sync loop, as a second long-running process
```

Keep both `pnpm start` and `pnpm sync` running under a process manager (systemd, launchd, pm2). Run one sync writer per database: either `pnpm sync` (or the `sync` container) or the Vercel cron, never both.
