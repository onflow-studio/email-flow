import type { Metadata } from "next";

import { db } from "@/lib/db";
import { DEFAULT_DIGEST_SETTINGS, loadStaleSettings, savedDigestSettings } from "@/lib/db/settings";

import { DigestForm } from "./digest-form";

export const metadata: Metadata = { title: "digest · settings · email-flow" };

export default async function DigestPage() {
  const [initial, schedule] = await Promise.all([loadStaleSettings(db), savedDigestSettings(db)]);
  const zones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")];
  return <DigestForm initial={initial} schedule={schedule} defaults={DEFAULT_DIGEST_SETTINGS} zones={zones} />;
}
