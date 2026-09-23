import type { Metadata } from "next";

import { loadOverrides } from "@/lib/db/keybindings";

import { KeyboardSection } from "./keyboard-section";

export const metadata: Metadata = { title: "keyboard · settings · superfer" };

export default async function KeyboardPage() {
  return <KeyboardSection initial={await loadOverrides()} />;
}
