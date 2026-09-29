"use client";

import { useEffect, useState, type RefObject } from "react";

import { cn } from "@/lib/utils";

type Spot = { top: number; height: number };

// Where each bar last stood. Navigating remounts the page, so this is how a bar can glide from the
// row it was on to the new one instead of appearing there.
const lastSpot = new Map<string, Spot>();

/**
 * A 2px bar on the left edge of `root` that glides to whichever element `selector` matches, so
 * focus moves as one mark instead of jumping row to row. Draw it inside `root`, which must be
 * positioned.
 */
export function Glider({
  root,
  selector,
  memory,
  watch,
  className,
}: {
  root: RefObject<HTMLElement | null>;
  /** The element the bar sits beside; null hides it. */
  selector: string | null;
  /** Names the bar across remounts: the rail, a view's list. */
  memory: string;
  /** Anything that can move the target without resizing the root, e.g. the rows it holds. */
  watch?: unknown;
  className?: string;
}) {
  const [spot, setSpot] = useState<(Spot & { glide: boolean }) | null>(() => {
    const last = lastSpot.get(memory);
    return last ? { ...last, glide: false } : null;
  });

  // A plain effect: a child's layout effect runs before its parent's ref is attached, and the root is
  // usually that parent.
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const measure = () => {
      const target = selector ? box.querySelector<HTMLElement>(selector) : null;
      if (!target) {
        setSpot(null);
        return;
      }
      const t = target.getBoundingClientRect();
      const next = { top: t.top - box.getBoundingClientRect().top + box.scrollTop, height: t.height };
      lastSpot.set(memory, next);
      // The first placement lands; every later one glides.
      setSpot((s) => (s && s.top === next.top && s.height === next.height ? s : { ...next, glide: s !== null }));
    };
    // Coming back with a remembered spot: paint there first, then glide on the next frame. A
    // background tab runs no frames, so a timer backs it up; measuring twice changes nothing.
    const frame = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 50);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [root, selector, memory, watch]);

  if (!spot) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-20 w-0.5",
        spot.glide && "transition-[transform,height] duration-150 ease-snap",
        className,
      )}
      style={{ transform: `translateY(${spot.top}px)`, height: spot.height }}
    />
  );
}
