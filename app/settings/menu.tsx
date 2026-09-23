"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { currentSection, SECTIONS } from "./sections";

const isField = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

const section = () => document.getElementById("settings-section");

/**
 * The settings side menu, styled like the mail rail. On desktop it owns the
 * arrow keys while focus is outside the section: up and down switch section,
 * right moves into it. Left from the section comes back. On phone it is the
 * list screen at `/settings`.
 */
export function SettingsMenu({ variant }: { variant: "rail" | "list" }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = currentSection(pathname);
  const [menuFocused, setMenuFocused] = useState(true);

  useEffect(() => {
    if (variant !== "rail") return;
    const onFocus = () => setMenuFocused(!section()?.contains(document.activeElement));
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const inSection = !!section()?.contains(active);
      if (isField(active)) return;
      if (!inSection && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const i = SECTIONS.findIndex((s) => s.slug === current.slug);
        const next = SECTIONS[i + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) router.push(`/settings/${next.slug}`);
      } else if (!inSection && e.key === "ArrowRight") {
        e.preventDefault();
        section()?.querySelector<HTMLElement>("a[href], button:not(:disabled), input, textarea, select")?.focus();
      } else if (inSection && e.key === "ArrowLeft") {
        e.preventDefault();
        (active as HTMLElement).blur();
        setMenuFocused(true);
      }
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, [variant, current.slug, router]);

  if (variant === "list")
    return (
      <ul className="flex flex-col border-t border-border">
        {SECTIONS.map((s) => (
          <li key={s.slug}>
            <Link href={`/settings/${s.slug}`} className="flex h-touch items-center border-b border-border px-3 text-text">
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <ul className="flex flex-col gap-1">
      {SECTIONS.map((s) => {
        const active = s.slug === current.slug;
        return (
          <li key={s.slug}>
            <Link
              href={`/settings/${s.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-row items-center rounded-sm border-l-2 border-transparent px-2 transition-colors duration-80 ease-snap outline-none",
                active
                  ? menuFocused
                    ? "glow-focus border-accent bg-surface-raised text-text"
                    : "border-accent-dim bg-surface-raised font-medium text-text"
                  : "text-text-muted hover:bg-surface-raised hover:text-text focus-visible:glow-focus focus-visible:border-accent focus-visible:bg-surface-raised focus-visible:text-text",
              )}
            >
              {s.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
