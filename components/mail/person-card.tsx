"use client";

import { Popover } from "@base-ui/react/popover";
import Link from "next/link";
import { useEffect, useState } from "react";

import { personCard, type PersonCardData } from "@/app/(mail)/person-actions";
import type { Address } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { useCompose } from "./compose/compose";
import { useKeys } from "./keys/keymap";
import { CopyButton } from "./message";
import { usePaletteOpener } from "./palette/palette";
import { Time } from "./time";

/**
 * A name in the reading pane that opens who it is: the address to copy, their threads and
 * standing, and ways on: write to them, find their mail, their page under people.
 */
export function PersonName({ address, className }: { address: Address; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={address.email}
        className={cn(
          "min-w-0 cursor-pointer truncate text-left decoration-text-dim underline-offset-2 outline-none hover:underline focus-visible:text-accent focus-visible:underline",
          open && "underline",
          className,
        )}
      >
        {address.name || address.email}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className="flex w-person-card max-w-[calc(100vw-24px)] flex-col gap-2 rounded-md border border-border bg-surface-top p-3 text-12 outline-none">
            <PersonBody address={address} close={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PersonBody({ address, close }: { address: Address; close: () => void }) {
  const compose = useCompose();
  const openPalette = usePaletteOpener();
  const [data, setData] = useState<PersonCardData | null>(null);
  useEffect(() => {
    let live = true;
    personCard(address.email).then(
      (d) => live && setData(d),
      () => live && setData({ sender: null, person: null }),
    );
    return () => {
      live = false;
    };
  }, [address.email]);
  // Open, the card holds the keys: esc closes it and never reaches the list behind.
  useKeys([{ keys: "escape", allowInInput: true, run: close }], { exclusive: true });

  const sender = data?.sender;
  const action = "flex h-touch items-center rounded-sm px-2 text-text-muted transition-colors duration-80 ease-snap hover:bg-surface-raised hover:text-text focus-visible:text-accent md:h-6";
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        {address.name ? <span className="truncate text-13 font-medium text-text">{address.name}</span> : null}
        <div className="group/address flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-text-muted select-all">{address.email}</span>
          <CopyButton text={() => address.email} label="copy address" className="md:opacity-100" />
        </div>
      </div>
      <p className="text-11 text-text-muted tabular-nums">
        {!data ? (
          " "
        ) : sender ? (
          <>
            {sender.threadCount} {sender.threadCount === 1 ? "thread" : "threads"}
            {sender.lastSeenAt ? (
              <>
                {" · last "}
                <Time iso={sender.lastSeenAt} format="ago" />
              </>
            ) : null}
            {sender.decision === "allowed" ? (sender.decidedBy === "ai" ? " · let in by AI" : " · let in") : sender.decision === "out_spam" || sender.decision === "out_not_now" ? " · kept out" : null}
          </>
        ) : (
          "never wrote to you"
        )}
      </p>
      <div className="-mx-2 flex flex-wrap items-center">
        <button
          type="button"
          className={action}
          onClick={() => {
            close();
            compose.open("new", null, null, address.name ? `${address.name} <${address.email}>` : address.email);
          }}
        >
          write
        </button>
        <button
          type="button"
          className={action}
          onClick={() => {
            close();
            openPalette?.(`from:${address.email} `);
          }}
        >
          their mail
        </button>
        {data?.person ? (
          <Link href={`/settings/people/${data.person.id}`} onClick={close} className={action}>
            person page
          </Link>
        ) : null}
      </div>
    </>
  );
}

/** Names, each opening its card, comma-separated: a recipients line. */
export function AddressList({ list }: { list: Address[] }) {
  if (!list.length) return <>undisclosed</>;
  return (
    <>
      {list.map((a, i) => (
        <span key={`${a.email}-${i}`}>
          <PersonName address={a} />
          {i < list.length - 1 ? ", " : null}
        </span>
      ))}
    </>
  );
}
