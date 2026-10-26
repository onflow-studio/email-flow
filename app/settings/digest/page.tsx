import type { Metadata } from "next";

import { loadStaleSettings } from "@/lib/db/settings";

import { DigestForm } from "./digest-form";

export const metadata: Metadata = { title: "digest · settings · email-flow" };

export default async function DigestPage() {
  return <DigestForm initial={await loadStaleSettings()} />;
}
