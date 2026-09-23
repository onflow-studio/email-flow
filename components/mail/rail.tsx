"use client";

import { Bookmark, Clock, Inbox, Newspaper, Receipt, ShieldQuestionMark, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useKeys } from "./keys/keymap";
import { useMailSelection } from "./selection";
import { mailHref, VIEWS, type ViewSlug } from "./views";

const ICONS: Record<ViewSlug, LucideIcon> = {
  inbox: Inbox,
  news: Newspaper,
  "paper-trail": Receipt,
  triage: ShieldQuestionMark,
  snoozed: Clock,
  "set-aside": Bookmark,
  trash: Trash2,
};

type RailAccount = { id: string; label: string; color: string };

export function Rail({
  view,
  account,
  counts,
  accounts,
}: {
  view: ViewSlug;
  account: string | null;
  counts: Record<ViewSlug, number>;
  accounts: RailAccount[];
}) {
  const sel = useMailSelection();
  const router = useRouter();
  const focused = sel.pane === "rail";

  // Keyboard items: views, then accounts while the rail is wide enough to list them.
  const accountHrefs = [null, ...accounts.map((a) => a.id)].map((id) => mailHref(view, { account: id }));
  const hrefs = () => [
    ...VIEWS.map((v) => mailHref(v.slug, { account })),
    ...(accounts.length > 1 && window.matchMedia("(min-width: 1100px)").matches ? accountHrefs : []),
  ];
  const current = VIEWS.findIndex((v) => v.slug === view);
  const [cursor, setCursor] = useState<number | null>(null);
  const at = cursor ?? current;
  // Entering the rail starts from the open view.
  if (!focused && cursor !== null) setCursor(null);

  const activate = () => {
    const href = hrefs()[at];
    if (href && at !== current) router.push(href);
  };
  const inRail = () => sel.pane === "rail";
  useKeys([
    { keys: "arrowdown", when: inRail, run: () => setCursor(Math.min(at + 1, hrefs().length - 1)) },
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

  return (
    <nav
      aria-label="views"
      className={cn(
        "hidden w-rail-icons shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface py-3 md:flex rail:w-rail rail:px-3",
        focused && "md:pane-focus",
      )}
    >
      <ul className="flex flex-col gap-1">
        {VIEWS.map((v, i) => {
          const Icon = ICONS[v.slug];
          const active = v.slug === view;
          const n = counts[v.slug];
          return (
            <li key={v.slug} className={cn(i === 4 && "mt-3")}>
              <Link
                href={mailHref(v.slug, { account })}
                title={v.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-row items-center justify-center gap-2 border-l-2 border-transparent transition-colors duration-80 ease-snap rail:justify-between rail:rounded-sm rail:px-2",
                  active
                    ? "border-accent-dim bg-surface-raised font-medium text-text"
                    : "text-text-muted hover:bg-surface-raised hover:text-text",
                  cursorClass(i),
                )}
              >
                <Icon aria-hidden className="size-4 rail:hidden" strokeWidth={1.5} />
                <span className="hidden rail:inline">{v.label}</span>
                {n > 0 ? (
                  <span className={cn("hidden text-11 rail:inline", v.bucket ? "text-text" : "text-text-dim")}>{n}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {accounts.length > 1 ? (
        <section className="hidden rail:block">
          <h2 className="mb-1 px-2 text-11 text-text-dim">accounts</h2>
          <ul className="flex flex-col gap-1">
            <AccountLink view={view} active={!account} label="all" className={cursorClass(VIEWS.length)} />
            {accounts.map((a, i) => (
              <AccountLink
                key={a.id}
                view={view}
                id={a.id}
                active={account === a.id}
                label={a.label}
                color={a.color}
                className={cursorClass(VIEWS.length + 1 + i)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </nav>
  );
}

function AccountLink({
  view,
  id,
  active,
  label,
  color,
  className,
}: {
  view: ViewSlug;
  id?: string;
  active: boolean;
  label: string;
  color?: string;
  className?: string | false;
}) {
  return (
    <li>
      <Link
        href={mailHref(view, { account: id })}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-row items-center gap-2 rounded-sm border-l-2 border-transparent px-2 transition-colors duration-80 ease-snap",
          active ? "bg-surface-raised font-medium text-text" : "text-text-muted hover:bg-surface-raised hover:text-text",
          className,
        )}
      >
        <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: color ?? "var(--text-dim)" }} />
        {label}
      </Link>
    </li>
  );
}
