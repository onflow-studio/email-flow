"use client";

import Link from "next/link";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { AccountSquare } from "./account-square";
import { useAccountToggles } from "./account-toggles";
import { useOpenPalette } from "./palette/palette";

/** Logo, the one search, and the account toggles. Phone shows it on the list screen only. */
export function Header({ className }: { className?: string }) {
  const openPalette = useOpenPalette();
  const { accounts, toggle } = useAccountToggles();
  const toggles = accounts.length > 1 ? accounts : [];

  return (
    <header
      className={cn(
        // Sides share the leftover width equally so the search sits at the window's centre and shrinks first.
        "flex h-touch shrink-0 items-center gap-3 border-b border-header-border bg-header pl-3 md:grid md:h-header md:grid-cols-[minmax(max-content,1fr)_minmax(0,var(--container-search))_minmax(max-content,1fr)] md:px-3",
        className,
      )}
    >
      <Link href="/inbox" className="flex shrink-0 items-center gap-2 font-medium">
        <span className="text-accent">&gt;_</span>
        <span className="hidden text-text md:inline">superfer</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-end md:justify-center">
        <button
          type="button"
          onClick={openPalette}
          aria-label="search"
          className="hidden h-6 w-full max-w-search min-w-0 items-center justify-between rounded-sm border border-border bg-bg px-2 text-12 text-text-dim outline-none transition-colors duration-80 ease-snap focus-visible:border-accent md:flex"
        >
          search
          <Kbd keys="/" />
        </button>
        <button
          type="button"
          onClick={openPalette}
          className="flex h-touch items-center px-2 text-text-muted transition-colors duration-80 ease-snap hover:text-text md:hidden"
        >
          search
        </button>
      </div>

      {toggles.length ? (
        <ul aria-label="accounts" className="flex shrink-0 items-center md:justify-self-end md:gap-2">
          {toggles.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={a.on}
                title={a.email}
                onClick={() => toggle(a.id)}
                className={cn(
                  "flex size-touch items-center justify-center gap-2 text-12 transition-colors duration-80 ease-snap md:h-6 md:w-auto md:px-2",
                  a.on ? "text-text" : "text-text-dim hover:text-text-muted",
                )}
              >
                <AccountSquare color={a.color} off={!a.on} />
                <span className="hidden md:inline">{a.label}</span>
                <span className="sr-only md:hidden">{a.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
