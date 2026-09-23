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
 * The settings tabs. While focus is outside the section they own the arrow
 * keys: left and right switch tab, down moves into the section. Up from the
 * section's first stop comes back to the tabs.
 */
export function SettingsTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const current = currentSection(pathname);
  const [tabsFocused, setTabsFocused] = useState(true);

  useEffect(() => {
    const onFocus = () => setTabsFocused(!section()?.contains(document.activeElement));
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const inSection = !!section()?.contains(active);
      if (isField(active)) return;
      if (!inSection && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const i = SECTIONS.findIndex((s) => s.slug === current.slug);
        const next = SECTIONS[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) router.push(`/settings/${next.slug}`);
      } else if (!inSection && e.key === "ArrowDown") {
        e.preventDefault();
        section()?.querySelector<HTMLElement>("a[href], button:not(:disabled), input, textarea, select")?.focus();
      } else if (inSection && e.key === "ArrowUp" && active === firstStop()) {
        e.preventDefault();
        (active as HTMLElement).blur();
        setTabsFocused(true);
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
  }, [current.slug, router]);

  return (
    <ul role="tablist" aria-label="settings" className="flex items-stretch self-stretch">
      {SECTIONS.map((s) => {
        const active = s.slug === current.slug;
        return (
          <li key={s.slug} className="flex">
            <Link
              href={`/settings/${s.slug}`}
              role="tab"
              aria-selected={active}
              className={cn(
                "flex items-center border-b-2 border-transparent px-3 transition-colors duration-80 ease-snap outline-none",
                active
                  ? tabsFocused
                    ? "border-accent text-text"
                    : "border-accent-dim font-medium text-text"
                  : "text-text-muted hover:text-text focus-visible:border-accent focus-visible:text-text",
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

function firstStop() {
  return section()?.querySelector<HTMLElement>("a[href], button:not(:disabled), input, textarea, select") ?? null;
}
