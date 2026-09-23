"use client";

import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useKeys } from "./keys/keymap";
import { displayName, MessageContent, type MessageItem } from "./message";
import { useMailSelection } from "./selection";
import { shortTime, Time } from "./time";

type Item = { key: string; message: MessageItem; index: number } | { key: "fold"; count: number };

const SCROLL_STEP = 64;

/**
 * Threads with two or more messages: a line with one node per message, collapsed
 * messages as flat rows and exactly one open message as the pane's only raised surface.
 */
export function ThreadTimeline({ messages }: { messages: MessageItem[] }) {
  const sel = useMailSelection();
  const [openId, setOpenId] = useState(messages[messages.length - 1].id);
  const [unfolded, setUnfolded] = useState(false);
  const [cursor, setCursor] = useState<string>(openId);
  const listRef = useRef<HTMLOListElement>(null);

  const openIndex = messages.findIndex((m) => m.id === openId);
  // More than two collapsed messages above the open one: keep the two nearest, fold the rest.
  const folded = !unfolded && openIndex > 2 ? openIndex - 2 : 0;
  const items: Item[] = [
    ...(folded ? [{ key: "fold" as const, count: folded }] : []),
    ...messages.slice(folded).map((m, i) => ({ key: m.id, message: m, index: folded + i })),
  ];

  const activate = (item: Item) => {
    if ("message" in item) {
      setOpenId(item.key);
      setCursor(item.key);
    } else {
      setUnfolded(true);
      setCursor(messages[0].id);
    }
  };

  const itemEl = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-item="${key}"]`) ?? null;

  // A newly opened message comes into view; the first render keeps the pane at the top.
  const shown = useRef(openId);
  useEffect(() => {
    if (shown.current === openId) return;
    shown.current = openId;
    itemEl(openId)?.scrollIntoView({ block: "nearest" });
  }, [openId]);

  // Arrow keys scroll through the item under the cursor, then step to the next one.
  const reading = () => sel.pane === "reading";
  const moveCursor = (dir: 1 | -1) => {
    const scroller = listRef.current?.closest("main");
    const i = items.findIndex((it) => it.key === cursor);
    const el = itemEl(cursor);
    if (!scroller || !el) return;
    const view = scroller.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const more = dir === 1 ? box.bottom > view.bottom : box.top < view.top;
    const next = items[i + dir];
    if (more || !next) {
      scroller.scrollBy({ top: dir * SCROLL_STEP });
      return;
    }
    setCursor(next.key);
    itemEl(next.key)?.scrollIntoView({ block: "nearest" });
  };
  useKeys([
    { keys: "arrowdown", when: reading, run: () => moveCursor(1) },
    { keys: "arrowup", when: reading, run: () => moveCursor(-1) },
    {
      keys: "enter",
      // A focused button or link keeps its own enter.
      when: () => reading() && !document.activeElement?.closest("button, a"),
      run: () => {
        const item = items.find((it) => it.key === cursor);
        if (item) activate(item);
      },
    },
  ]);

  return (
    <ol ref={listRef} className="flex flex-col">
      {items.map((item, i) => {
        const open = item.key === openId;
        const onCursor = sel.pane === "reading" && item.key === cursor;
        return (
          <li key={item.key} data-item={item.key} onPointerDown={() => setCursor(item.key)} className="group flex">
            <Gutter open={open} first={i === 0} last={i === items.length - 1} onCursor={onCursor} />
            <div className="min-w-0 flex-1">
              {"message" in item && open ? (
                <div className="py-2">
                  <div className="rounded-sm bg-surface-raised p-4">
                    <MessageContent message={item.message} quoteLabel={quoteLabel(messages, item.index)} />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => activate(item)}
                  className={cn(
                    "flex h-touch w-full items-center gap-2 rounded-sm px-3 text-left transition-colors duration-80 ease-snap outline-none hover:bg-surface-raised focus-visible:bg-surface-raised md:h-row",
                    onCursor && "md:bg-surface-raised",
                  )}
                >
                  {"message" in item ? (
                    <>
                      <span className="w-sender shrink-0 truncate text-text">{displayName(item.message)}</span>
                      <span className="min-w-0 flex-1 truncate text-text-muted">{item.message.snippet}</span>
                      {item.message.attachments.length ? <Paperclip aria-hidden className="size-3 shrink-0 text-text-dim" /> : null}
                      <Time iso={item.message.date} className="shrink-0 text-11 text-text-muted" />
                    </>
                  ) : (
                    <span className="text-12 text-text-muted">{item.count} earlier messages</span>
                  )}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The item's stretch of the line and its node. Collapsed nodes sit at the middle of the row,
 * the open node on the card's header line (8 margin + 16 padding down); the accent runs beside the card.
 */
function Gutter({ open, first, last, onCursor }: { open: boolean; first: boolean; last: boolean; onCursor: boolean }) {
  const line = "absolute inset-x-0 mx-auto w-px";
  return (
    <div aria-hidden className="relative w-4 shrink-0 md:w-timeline">
      {first ? null : <span className={cn(line, "top-0 bg-border", open ? "h-8" : "h-1/2")} />}
      {open ? (
        <>
          <span className={cn(line, "top-8 bottom-2 bg-accent")} />
          {last ? null : <span className={cn(line, "bottom-0 h-2 bg-border")} />}
          <span className="absolute inset-x-0 top-6 flex items-center justify-center">
            {/* A zero-width character gives the wrapper the header's line height. */}
            <span className="w-0 overflow-hidden">{"\u200b"}</span>
            <span className="flex size-2.75 items-center justify-center rounded-full border border-accent bg-bg glow-bleed">
              <span className="size-1.25 rounded-full bg-accent" />
            </span>
          </span>
        </>
      ) : (
        <>
          {last ? null : <span className={cn(line, "top-1/2 bottom-0 bg-border")} />}
          <span className="absolute inset-x-0 top-0 flex h-touch items-center justify-center md:h-row">
            <span
              className={cn(
                "size-1.75 rounded-full border bg-bg transition-colors duration-80 ease-snap",
                onCursor ? "border-text-dim md:border-text-muted" : "border-text-dim group-hover:border-text-muted",
              )}
            />
          </span>
        </>
      )}
    </div>
  );
}

/** A reply quotes the message before it. The first message's quote is a forward or outside history: shown whole. */
function quoteLabel(messages: MessageItem[], index: number) {
  const prev = messages[index - 1];
  if (!prev) return null;
  return `··· quoted text from ${displayName(prev).toLowerCase()}, ${shortTime(prev.date)}`;
}
