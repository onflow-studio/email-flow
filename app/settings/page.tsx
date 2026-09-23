import type { Metadata } from "next";

import { AccountsSection } from "./accounts-section";
import { SettingsMenu } from "./menu";

export const metadata: Metadata = { title: "settings · superfer" };

/** Desktop opens accounts beside the menu; phone shows the menu as its own list screen. */
export default function SettingsPage() {
  return (
    <>
      <div className="md:hidden">
        <SettingsMenu variant="list" />
      </div>
      <div className="hidden md:block">
        <AccountsSection />
      </div>
    </>
  );
}
