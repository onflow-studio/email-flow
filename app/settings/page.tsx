import { asc } from "drizzle-orm";
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "settings · superfer" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const connected = typeof params.connected === "string" ? params.connected : null;
  const error = typeof params.error === "string" ? params.error : null;
  const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      label: accounts.label,
      color: accounts.color,
      signatureHtml: accounts.signatureHtml,
      lastSyncError: accounts.lastSyncError,
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-8">
        <div className="mx-auto flex max-w-palette flex-col gap-4">
          <p className="text-11 text-text-dim">superfer / settings</p>

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
              <p className="text-warning">
                google oauth not configured, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
              </p>
            ) : null}

            <div className="rounded-sm border border-border bg-surface px-3">
              {rows.length === 0 ? (
                <p className="py-4 text-text-muted">no accounts connected</p>
              ) : (
                rows.map((account) => <AccountForm key={account.id} account={account} />)
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="status-rule flex h-status shrink-0 items-center justify-between gap-3 bg-surface px-3 text-11 text-text-muted">
        {error ? (
          <span className="truncate text-danger">{error}</span>
        ) : connected ? (
          <span className="truncate">connected {connected}</span>
        ) : (
          <span>{rows.length} of 3 accounts</span>
        )}
        <span className="shrink-0">settings</span>
      </footer>
    </div>
  );
}
