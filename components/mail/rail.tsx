"use client";

import { Clock, Inbox, Newspaper, Receipt, Settings, ShieldQuestionMark, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { mailHref, VIEWS, type View, type ViewSlug } from "./views";

const ICONS: Record<ViewSlug, LucideIcon> = {
  inbox: Inbox,
  news: Newspaper,
  "paper-trail": Receipt,
  triage: ShieldQuestionMark,
  snoozed: Clock,
  trash: Trash2,
};

type RailItem = { key: string; label: string; href: string; icon: LucideIcon; count?: number; bucket?: boolean };

export function Rail({ view, counts }: { view: ViewSlug; counts: Record<ViewSlug, number> }) {
  const sel = useMailSelection();
  const router = useRouter();
  const focused = sel.pane === "rail";

  const item = (v: View): RailItem => ({
    key: v.slug,
    label: sentenceCase(v.label),
    href: mailHref(v.slug),
    icon: ICONS[v.slug],
    // Trash carries no count.
    count: v.group === "bottom" ? undefined : counts[v.slug],
    bucket: !!v.bucket,
  });
  const act = VIEWS.filter((v) => v.group === "act").map(item);
  const later = VIEWS.filter((v) => v.group === "later").map(item);
  const bottom = [
    ...VIEWS.filter((v) => v.group === "bottom").map(item),
    { key: "settings", label: "Settings", href: "/settings", icon: Settings },
  ];

  // Keyboard items in screen order.
  const items = [...act, ...later, ...bottom];
  const [cursor, setCursor] = useState<number | null>(null);
  const currentHref = mailHref(view);
  const current = items.findIndex((i) => i.href === currentHref);
  const at = cursor ?? current;
  // Entering the rail starts from the open view.
  if (!focused && cursor !== null) setCursor(null);

  const activate = () => {
    const href = items[at]?.href;
    if (href && at !== current) router.push(href);
  };
  const inRail = () => sel.pane === "rail";
  useKeys([
    { keys: "arrowdown", when: inRail, run: () => setCursor(Math.min(at + 1, items.length - 1)) },
    { keys: "arrowup", when: inRail, run: () => setCursor(Math.max(at - 1, 0)) },
    { keys: "enter", when: inRail, run: activate },
    {
      keys: "arrowright",
      when: inRail,
      run: () => {
        activate();
        sel.setPane("list");
      },
    },
  ]);

  const cursorClass = (i: number) => focused && i === at && "border-accent glow-focus bg-surface-raised text-text";

  const row = (it: RailItem, i: number, dim = false) => {
    const Icon = it.icon;
    const active = it.href === currentHref;
    return (
      <li key={it.key}>
        <Link
          href={it.href}
          title={it.label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex h-row items-center justify-center gap-2 border-l-2 border-transparent transition-colors duration-80 ease-snap rail:justify-between rail:rounded-sm rail:px-2",
            active
              ? "border-accent-dim bg-surface-raised font-medium text-text"
              : dim
                ? "text-text-dim hover:bg-surface-raised hover:text-text-muted"
                : "text-text-muted hover:bg-surface-raised hover:text-text",
            cursorClass(i),
          )}
        >
          <Icon aria-hidden className="size-4 rail:hidden" strokeWidth={1.5} />
          <span className="hidden rail:inline">{it.label}</span>
          {it.count ? (
            <span className={cn("hidden text-11 rail:inline", it.bucket ? "text-text" : "text-text-dim")}>{it.count}</span>
          ) : null}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="views"
      className={cn(
        "hidden w-rail-icons shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface py-3 md:flex rail:w-rail rail:px-3",
        focused && "md:pane-focus",
      )}
    >
      <ul className="flex flex-col gap-1">{act.map((it, i) => row(it, i))}</ul>
      <ul className="flex flex-col gap-1">{later.map((it, i) => row(it, act.length + i))}</ul>

      <ul className="mt-auto flex flex-col gap-1">{bottom.map((it, i) => row(it, act.length + later.length + i, true))}</ul>
    </nav>
  );
}

/** The rail is the one list in sentence case: `paper trail` reads `Paper trail`. */
function sentenceCase(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
