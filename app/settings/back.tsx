"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { readMailPath } from "@/components/mail/return-path";
import { Button, buttonVariants } from "@/components/ui/button";
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

/** The `back` button alone, for the phone list screen; the esc listener lives in the layout. */
export function LeaveButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button variant="ghost" shortcut="escape" className={cn("self-start", className)} onClick={() => router.push(readMailPath() ?? "/inbox")}>
      back
    </Button>
  );
}

/** Phone detail screens: back to the settings list. */
export function SectionBack() {
  return (
    <Link href="/settings" className={cn(buttonVariants({ variant: "ghost" }), "-ml-3")}>
      back
    </Link>
  );
}

/** Phone: the list screen leaves settings, a section goes back to the list. Sticky above the scroll. */
export function PhoneHeader() {
  const pathname = usePathname();
  return (
    <div className="flex h-touch shrink-0 items-center border-b border-border bg-surface px-3 md:hidden">
      {pathname === "/settings" ? <LeaveButton className="-ml-3 self-center" /> : <SectionBack />}
    </div>
  );
}
