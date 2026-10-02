"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { AccountSquare } from "./account-square";
import { useAccountToggles } from "./account-toggles";
import { useOpenPalette } from "./palette/palette";

/** Logo and the account toggles, plus a search button on phone. Phone shows it on the list screen only. */
export function Header({ className }: { className?: string }) {
  const openPalette = useOpenPalette();
  const { accounts, toggle } = useAccountToggles();
  const toggles = accounts.length > 1 ? accounts : [];

  return (
    <header
      className={cn(
        "flex h-touch shrink-0 items-center gap-3 border-b border-header-border bg-header pl-3 md:h-header md:justify-between md:px-3",
        className,
      )}
    >
      <Link href="/inbox" className="flex shrink-0 items-center gap-2 font-medium">
        <span className="text-accent">&gt;<span className="cursor-blink">_</span></span>
        <span className="hidden text-text md:inline">email-flow</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-end md:hidden">
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
