"use client";

import { BriefcaseBusiness, Clock, FilePen, Inbox, Newspaper, Receipt, ScrollText, Send, Settings, ShieldQuestionMark, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ViewCounts } from "@/app/(mail)/_lib/queries";
import { cn } from "@/lib/utils";

import { useKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { UnreadDot } from "./unread-dot";
import { mailHref, VIEWS, type View, type ViewSlug } from "./views";

const ICONS: Record<ViewSlug, LucideIcon> = {
  inbox: Inbox,
  news: Newspaper,
  "paper-trail": ScrollText,
  receipts: Receipt,
  triage: ShieldQuestionMark,
  work: BriefcaseBusiness,
  snoozed: Clock,
  sent: Send,
  drafts: FilePen,
  trash: Trash2,
};

type RailItem = { key: string; label: string; href: string; icon: LucideIcon; count?: number; strong?: boolean; unread?: boolean };

export function Rail({ view, counts }: { view: ViewSlug; counts: ViewCounts }) {
  const sel = useMailSelection();
  const router = useRouter();
  const focused = sel.pane === "rail";

  const item = (v: View): RailItem => ({
    key: v.slug,
    label: sentenceCase(v.label),
    href: mailHref(v.slug),
    icon: ICONS[v.slug],
    // Trash and sent carry no count; drafts shows how many wait.
    count: v.group === "bottom" && v.slug !== "drafts" ? undefined : counts.n[v.slug],
    // Bucket and Work counts are what is left to do; snoozed only waits.
    strong: !!v.bucket || v.slug === "work",
    unread: counts.unread[v.slug],
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
            "group flex h-row items-center justify-center gap-2 border-l-2 border-transparent transition-colors duration-80 ease-snap rail:justify-start rail:rounded-sm rail:px-2",
            active
              ? "rail-active font-medium text-text"
              : dim
                ? "text-text-dim hover:rail-hover hover:text-text-muted"
                : "text-text-muted hover:rail-hover hover:text-text",
            cursorClass(i),
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-colors duration-80 ease-snap",
              active ? "text-accent" : "group-hover:text-info",
            )}
            strokeWidth={1.5}
          />
          <span className={cn("hidden min-w-0 flex-1 truncate rail:inline", active && "rail-text")}>{it.label}</span>
          {it.count !== undefined && (it.count > 0 || it.key === "inbox" || it.key === "triage") ? (
            <span
              className={cn(
                "hidden items-center gap-1 text-11 tabular-nums rail:flex",
                active ? "text-info" : it.strong && it.count > 0 ? "text-text" : "text-text-dim",
              )}
            >
              {it.unread ? <UnreadDot /> : null}
              {it.count}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="views"
      className={cn(
        "rail-surface hidden w-rail-icons shrink-0 flex-col gap-4 overflow-y-auto py-3 md:flex rail:w-rail rail:px-3",
        focused && "md:pane-focus",
      )}
    >
      <ul className="flex flex-col gap-1">{act.map((it, i) => row(it, i))}</ul>
      <div aria-hidden className="rail-rule mx-2 h-px shrink-0" />
      <ul className="flex flex-col gap-1">{later.map((it, i) => row(it, act.length + i))}</ul>

      <ul className="mt-auto flex flex-col gap-1">{bottom.map((it, i) => row(it, act.length + later.length + i, true))}</ul>
    </nav>
  );
}

/** The rail is the one list in sentence case: `paper trail` reads `Paper trail`. */
function sentenceCase(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
