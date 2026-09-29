"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Sync writes new mail every few minutes; checking each minute shows it without a reload.
const EVERY_MS = 60_000;

/** Re-renders the mail views from the server while the tab is visible, and when it comes back. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);
  return null;
}
