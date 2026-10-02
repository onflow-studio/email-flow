# Google OAuth setup

email-flow talks to Gmail through your own Google Cloud OAuth client. Google uses that client twice:

- **Signing in** to email-flow, to prove who is at the keyboard. Callback: `/api/auth/login/callback`.
- **Connecting** a Gmail account, so sync can read and change its mail. Callback: `/api/auth/google/callback`.

Both use the same client ID and secret. This guide takes about ten minutes. The examples use `http://localhost:3000` for local development and `https://mail.example.com` for a deployed instance; replace that with your own domain.

## 1. Create a project and enable the Gmail API

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a new project. Any name works; only you will see it.
2. With the project selected, go to **APIs & Services > Library**, search for **Gmail API** and click **Enable**.

## 2. Configure the consent screen

Go to **APIs & Services > OAuth consent screen** (in newer consoles: **Google Auth Platform**).

1. **User type: External.** Internal only exists for Google Workspace organisations and only lets in accounts from that organisation, so it can't connect a personal `@gmail.com` address.
2. Fill in the app name, a support email and a developer contact email. These appear on Google's consent page, which only you will see.
3. **Scopes:** you can leave this step empty. The app asks for its scopes at runtime (listed below). Adding them here changes nothing for a Testing-mode app.
4. **Test users:** add every Google address you will use, both the ones you sign in with and every Gmail account you will connect. In Testing mode Google refuses anyone not on this list.
5. Leave the **publishing status on Testing.** See [Testing mode](#testing-mode-and-the-7-day-reconnect) below for why.

## 3. Create the OAuth client

Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**.

1. **Application type: Web application.**
2. **Authorized JavaScript origins:** not needed.
3. **Authorized redirect URIs:** add both callbacks for every place the app runs.

   Local development:

   ```
   http://localhost:3000/api/auth/google/callback
   http://localhost:3000/api/auth/login/callback
   ```

   Deployed instance:

   ```
   https://mail.example.com/api/auth/google/callback
   https://mail.example.com/api/auth/login/callback
   ```

   One client can hold all four. Google matches redirect URIs exactly, including the scheme, the port and the absence of a trailing slash.

4. Create it, then copy the **client ID** and **client secret**.

## 4. Fill in `.env`

```sh
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
ALLOWED_EMAILS=you@example.com
```

`GOOGLE_REDIRECT_URI` is the connect callback. The sign-in callback is derived from it (same origin, path `/api/auth/login/callback`), so you only set `LOGIN_REDIRECT_URI` if sign-in has to come back somewhere else. On a deployment, set `GOOGLE_REDIRECT_URI` to the production URL, for example `https://mail.example.com/api/auth/google/callback`.

Then start the app, sign in with an address from `ALLOWED_EMAILS`, open `/settings` and connect each Gmail account.

The first time, Google shows **"Google hasn't verified this app"**. That is expected for a Testing-mode app you created yourself: click **Advanced**, then **Go to (your app name)**.

## Scopes and why

Signing in (`lib/auth/google.ts`) asks only for identity, no mail access:

| Scope | Why |
|---|---|
| `openid`, `email`, `profile` | Read the verified address of whoever signs in and check it against `ALLOWED_EMAILS` |

Connecting an account (`lib/gmail/oauth.ts`) asks for:

| Scope | Why |
|---|---|
| `openid`, `email` | Know which Gmail address was just connected |
| `gmail.modify` | Read mail and sync changes: mark read, archive, trash, spam, and add or remove labels on messages and threads |
| `gmail.labels` | Create and rename the bucket labels email-flow writes back to Gmail |
| `gmail.send` | Send replies and new mail from that account |

The connect flow requests offline access and always shows the consent screen, so Google returns a refresh token on every connect, including reconnects. Tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY`.

## Testing mode and the 7-day reconnect

`gmail.modify` is one of Google's **restricted** scopes. Publishing an app that uses restricted scopes requires Google's verification plus an annual third-party security assessment, which costs real money and is aimed at companies shipping an app to the public. For an instance that serves one person, that isn't practical, so the app stays in Testing mode.

What Testing mode means:

- **Refresh tokens expire after 7 days.** Every connected Gmail account has to be reconnected from `/settings` about once a week. When a token expires, sync for that account stops with an authorization error until you reconnect. Nothing already in the database is lost, and sync resumes after reconnecting.
- The app shows a warning in settings before a connection expires. `GOOGLE_TOKEN_LIFETIME_DAYS` tells it how long tokens last (default 7). If you do publish the consent screen, set it to `0` to turn the warnings off.
- Only addresses on the test user list can sign in or be connected (up to 100).
- Google shows the "hasn't verified this app" warning on each consent.

Signing in is not affected by the 7-day limit: the app doesn't keep Google tokens for sign-in, only its own session cookie.
