import type { Metadata } from "next";

import { AccountsSection } from "./accounts-section";

export const metadata: Metadata = { title: "settings · superfer" };

/** `/settings` opens the accounts tab. */
export default function SettingsPage() {
  return <AccountsSection />;
}
