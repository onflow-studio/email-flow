"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readMailPath } from "@/components/mail/return-path";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const isField = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

/**
 * Esc leaves settings for the view and thread you came from, or inbox when
 * settings was opened directly. In a field, the first esc only blurs it.
 */
export function SettingsBack({ className }: { className?: string }) {
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

  return <LeaveButton className={className} />;
}

function LeaveButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button variant="ghost" shortcut="escape" className={cn("self-start", className)} onClick={() => router.push(readMailPath() ?? "/inbox")}>
      back
    </Button>
  );
}

/** `>_ superfer / settings`: the logo half goes back like esc does. */
export function SettingsPath() {
  const router = useRouter();
  return (
    <p className="hidden items-center gap-2 font-medium md:absolute md:left-3 md:flex">
      <Link
        href="/inbox"
        onClick={(e) => {
          e.preventDefault();
          router.push(readMailPath() ?? "/inbox");
        }}
        className="flex items-center gap-2 rounded-sm text-text-muted outline-none transition-colors duration-80 ease-snap hover:text-text focus-visible:text-text"
      >
        <span className="text-accent">&gt;_</span>
        superfer
      </Link>
      <span className="text-text-dim">/</span>
      <span className="text-text">settings</span>
    </p>
  );
}
