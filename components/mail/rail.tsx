import { Bookmark, Clock, Inbox, Newspaper, Receipt, ShieldQuestionMark, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { mailHref, VIEWS, type ViewSlug } from "./views";

const ICONS: Record<ViewSlug, LucideIcon> = {
  inbox: Inbox,
  news: Newspaper,
  "paper-trail": Receipt,
  triage: ShieldQuestionMark,
  snoozed: Clock,
  "set-aside": Bookmark,
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
  return (
    <nav
      aria-label="views"
      className="hidden w-rail-icons shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface py-3 md:flex rail:w-rail rail:px-3"
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
            <AccountLink view={view} active={!account} label="all" />
            {accounts.map((a) => (
              <AccountLink key={a.id} view={view} id={a.id} active={account === a.id} label={a.label} color={a.color} />
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
}: {
  view: ViewSlug;
  id?: string;
  active: boolean;
  label: string;
  color?: string;
}) {
  return (
    <li>
      <Link
        href={mailHref(view, { account: id })}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-row items-center gap-2 rounded-sm px-2 transition-colors duration-80 ease-snap",
          active ? "bg-surface-raised font-medium text-text" : "text-text-muted hover:bg-surface-raised hover:text-text",
        )}
      >
        <span aria-hidden className="h-3 w-0.5" style={{ backgroundColor: color ?? "var(--text-dim)" }} />
        {label}
      </Link>
    </li>
  );
}
