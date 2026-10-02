# Security

## Reporting a vulnerability

Report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Please do not open a public issue for anything that could expose someone's mail or credentials.

Include what you found, how to reproduce it, and which commit you tested. This is a personal project maintained in spare time, so there is no fixed response window, but reports are read and fixed issues are credited in the advisory unless you ask otherwise.

## Security model

email-flow is single-tenant. One deployment serves one owner. Every Google account listed in `ALLOWED_EMAILS` can sign in, and everyone who signs in sees all connected mail, every account, and every setting. There are no per-user permissions. Only list addresses that belong to the same person, or to people you would hand all of that mail to.

## What the app does to protect mail

**Login gate.** `proxy.ts` sits in front of every page, route handler and server action. Without a valid session, pages redirect to `/login` and everything else gets 401. Sign-in is Google OAuth, and the verified email must be in `ALLOWED_EMAILS`. The session is an HMAC-signed, httpOnly, SameSite=Lax cookie signed with `SESSION_SECRET`. Removing an email from `ALLOWED_EMAILS` ends its sessions.

**`AUTH_DISABLED` is ignored in production.** `AUTH_DISABLED=1` skips the login gate for local development only. `lib/auth/session.ts` honors it only when `NODE_ENV` is not `production`, so a deployed build always requires login.

**Sync endpoint.** `/api/sync` is outside the login gate and requires `Authorization: Bearer <SYNC_SECRET>`, compared in constant time. With `SYNC_SECRET` unset, every request is rejected.

**OAuth tokens encrypted at rest.** Gmail refresh tokens are stored with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64). Losing the key means reconnecting every account; leaking it together with a database dump exposes the tokens.

**Email HTML.** Mail is untrusted input:

- It is sanitized once on ingest with `sanitize-html` (`lib/mail/sanitize.ts`): scripts and event handlers are removed, remote CSS `url()` and `@import` are stripped, suspicious CSS is dropped, and tracking pixels are removed.
- It is rendered in a sandboxed iframe without `allow-scripts` (`components/mail/email-frame.tsx`). The frame document carries a Content-Security-Policy of `default-src 'none'`, with no scripts, no forms, no remote styles or fonts, no `<base>` changes, and a `no-referrer` policy. Meta refresh tags are removed.
- Remote images are blocked by default. The sanitizer moves image URLs aside, and the CSP only allows remote images for a sender or message the user has allowed.

**Secrets.** All secrets come from environment variables. `.env` is gitignored and excluded from Vercel uploads by `.vercelignore`.

## Out of scope

- Anything that requires access to the deployment's environment variables or database.
- Issues in Google, Vercel, Neon or Anthropic services themselves.
- Mail content shown to someone you put in `ALLOWED_EMAILS`. That is the intended model.
