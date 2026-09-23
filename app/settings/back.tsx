"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readMailPath } from "@/components/mail/return-path";
import { Button } from "@/components/ui/button";

const isField = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

/**
 * Esc leaves settings for the view and thread you came from, or inbox when
 * settings was opened directly. In a field, the first esc only blurs it.
 */
export function SettingsBack() {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const active = document.activeElement;
      if (isField(active)) (active as HTMLElement).blur();
      else router.push(readMailPath() ?? "/inbox");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Button variant="ghost" shortcut="escape" className="-ml-3 self-start" onClick={() => router.push(readMailPath() ?? "/inbox")}>
      back
    </Button>
  );
}
