"use client";

import type { DraftListItem } from "@/app/(mail)/_lib/queries";

import { useCompose } from "./compose/compose";
import { Time } from "./time";

/** Drafts open in compose, not in the reading pane. Arrows move between rows, enter opens. */
export function DraftList({
  drafts,
  accountColors,
  accountNames,
}: {
  drafts: DraftListItem[];
  accountColors: Record<string, string>;
  accountNames: Record<string, string>;
}) {
  const compose = useCompose();

  if (!drafts.length) return <p className="p-3 text-text-muted">no drafts</p>;

  const step = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const li = e.currentTarget.closest("li");
    const next = e.key === "ArrowDown" ? li?.nextElementSibling : li?.previousElementSibling;
    next?.querySelector("button")?.focus();
  };

  return (
    <ul aria-label="drafts" className="flex flex-col py-1">
      {drafts.map((d) => {
        const color = accountColors[d.accountId];
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => compose.openDraft(d.id)}
              onKeyDown={step}
              className="flex min-h-mail-row w-full min-w-0 flex-col justify-center gap-1 border-l-2 border-transparent pr-3 pl-6 text-left leading-list transition-colors duration-80 ease-snap outline-none hover:bg-surface-raised focus-visible:glow-focus focus-visible:border-accent focus-visible:bg-surface-raised"
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-text">{d.to}</span>
                <span
                  className="shrink-0 text-11"
                  style={{ color: color ? `color-mix(in srgb, ${color} 40%, var(--text-muted))` : "var(--text-muted)" }}
                >
                  {accountNames[d.accountId] ?? "unknown account"}
                </span>
                <Time iso={d.date} className="shrink-0 text-11 tabular-nums text-text-muted" />
              </span>
              <span className="w-full min-w-0 truncate">
                <span className="text-text">{d.subject}</span>
                {d.snippet ? <span className="text-text-muted"> · {d.snippet}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
