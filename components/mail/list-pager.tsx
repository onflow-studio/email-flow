"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadNextPage } from "@/app/(mail)/page-actions";

export const LIST_NEXT_PAGE_EVENT = "mail:next-page";

export function ListPager({ view, pages, hasMore }: { view: string; pages: number; hasMore: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!hasMore || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      await loadNextPage(view, pages);
      router.refresh();
    } catch {
      busy.current = false;
      setLoading(false);
      setFailed(true);
    }
  }, [hasMore, pages, router, view]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    const root = el.closest<HTMLElement>("[data-list-scroll]") ?? null;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void load(); }, { root, rootMargin: "100px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, load]);
  useEffect(() => {
    const next = () => { void load(); };
    window.addEventListener(LIST_NEXT_PAGE_EVENT, next);
    return () => window.removeEventListener(LIST_NEXT_PAGE_EVENT, next);
  }, [load]);

  if (!hasMore) return null;
  return (
    <div ref={ref} data-list-pager className="flex h-row items-center border-t border-border px-3 text-11 text-text-dim" aria-live="polite">
      {failed ? <>couldn&apos;t load threads · <button type="button" onClick={() => void load()} className="ml-1 text-accent">retry</button></> : loading ? "loading more threads…" : "load more threads"}
    </div>
  );
}
