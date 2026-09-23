import { count } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

import { SettingsBack } from "./back";
import { SettingsTabs } from "./tabs";
import { SettingsStatus } from "./status";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  // Every section reads the database; nothing here is prerendered.
  await connection();
  const [{ n }] = await db.select({ n: count() }).from(accounts);

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <nav className="flex h-touch shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-surface px-3">
        <SettingsBack className="self-center" />
        <SettingsTabs />
      </nav>
      <main id="settings-section" className="min-h-0 flex-1 overflow-y-auto p-3 md:p-8">
        <div className="mx-auto flex max-w-palette flex-col gap-4">{children}</div>
      </main>

      <footer className="status-rule box-content flex h-status shrink-0 items-center justify-between gap-3 bg-surface px-3 pb-safe text-11 text-text-muted">
        <Suspense fallback={<span>{n} of 3 accounts</span>}>
          <SettingsStatus accountCount={n} />
        </Suspense>
        <span className="shrink-0">settings</span>
      </footer>
    </div>
  );
}
