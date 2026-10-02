import { asc } from "drizzle-orm";

import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { accessExpiryFromEnv } from "@/lib/sync/expiry";

import { AccountForm } from "./account-form";

export async function AccountsSection() {
  const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      label: accounts.label,
      color: accounts.color,
      signatureHtml: accounts.signatureHtml,
      lastSyncError: accounts.lastSyncError,
      lastSyncAt: accounts.lastSyncAt,
      refreshTokenIssuedAt: accounts.refreshTokenIssuedAt,
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-15 font-medium">accounts</h1>
        {oauthConfigured ? (
          // OAuth start is a route handler redirecting to Google, not a page.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/api/auth/google/start" className={buttonVariants({ variant: "primary" })}>
            connect account
          </a>
        ) : null}
      </div>

      {!oauthConfigured ? (
        <p className="text-warning">google oauth not configured, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env</p>
      ) : null}

      <div className="rounded-sm border border-border bg-surface px-3">
        {rows.length === 0 ? (
          <p className="py-4 text-text-muted">no accounts connected</p>
        ) : (
          rows.map(({ lastSyncAt, refreshTokenIssuedAt, ...account }) => {
            const expiry = accessExpiryFromEnv({ lastSyncAt, refreshTokenIssuedAt });
            return (
              <AccountForm
                key={account.id}
                account={account}
                accessExpiry={expiry ? { state: expiry.state, expiresAt: expiry.expiresAt.toISOString() } : null}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
