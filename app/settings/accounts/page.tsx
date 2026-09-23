import type { Metadata } from "next";

import { AccountsSection } from "../accounts-section";

export const metadata: Metadata = { title: "accounts · settings · superfer" };

export default function AccountsPage() {
  return <AccountsSection />;
}
