"use client";

import { Command } from "cmdk";
import { useEffect, useRef } from "react";

import { bulkActions } from "@/app/(mail)/_lib/bulk";
import { KeyHints } from "@/components/ui/kbd";
import type { AskEvent, AskSource } from "@/lib/ai/ask";
import { parseCitations } from "@/lib/ai/citations";
import { cn } from "@/lib/utils";

import { AccountSquare } from "../account-square";
import { useProjects } from "../projects-context";
import { Time } from "../time";
import { Highlight, Snippet } from "./highlight";

export type AskState = {
  question: string;
  attempt: number;
  status: "idle" | "loading" | "done" | "error" | "key";
  plan?: Extract<AskEvent, { type: "plan" }>;
  sources: AskSource[];
  list?: Extract<AskEvent, { type: "list" }>;
  answer: string;
};

function Heading({ name, count }: { name: string; count?: number }) {
  return <span className="palette-section-heading flex items-center gap-2 px-3 pt-3 pb-1 text-11">
    <span className="text-text-muted uppercase">{name}</span><span aria-hidden className="h-px flex-1 bg-border" />
    {count !== undefined ? <span className="text-text-dim">{count}</span> : null}
  </span>;
}

function Item(props: React.ComponentProps<typeof Command.Item>) {
  return <Command.Item {...props} className={cn(
    "palette-row flex h-touch cursor-default items-center gap-2 border-l-2 border-transparent pr-3 pl-2 transition-colors duration-80 ease-snap md:h-row",
    "data-[disabled=true]:text-text-dim", props.className,
  )} />;
}

const plural = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;

export function AskPane({
  ask, counts, colors, onOpen, onBulk, onRetry, onBack,
}: {
  ask: AskState;
  counts: Record<string, number> | null;
  colors: Map<string, string>;
  onOpen: (id: string, bucket: AskSource["bucket"]) => void;
  onBulk: (key: string, label: string) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const projects = useProjects();
  const focusRef = useRef<HTMLInputElement>(null);
  useEffect(() => focusRef.current?.focus(), []);
  const cited = parseCitations(ask.answer, ask.sources.length);
  const citedSet = new Set(cited);
  const ordered = [...ask.sources.filter((s) => citedSet.has(s.n)), ...ask.sources.filter((s) => !citedSet.has(s.n))];
  const byNumber = new Map(ask.sources.map((s) => [s.n, s]));
  const answer = ask.answer.split(/(\[\d+\])/g).map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    const source = match && citedSet.has(Number(match[1])) ? byNumber.get(Number(match[1])) : null;
    return source ? <button key={i} type="button" className="text-info hover:text-text" onClick={() => onOpen(source.id, source.bucket)}>{part}</button> : part;
  });
  const list = ask.list;
  return <>
    <div className="palette-search-header flex h-touch shrink-0 items-center gap-2 border-b border-border px-3">
      <span className="min-w-0 flex-1 truncate">{ask.question}</span>
      <Command.Input ref={focusRef} value="" readOnly aria-label="ask results" className="sr-only" />
    </div>
    <div className="min-h-0 overflow-y-auto border-b border-border px-3 py-2 text-11 text-text-muted">
      {ask.plan ? <div>search: {ask.plan.query}</div> : null}
      {!ask.answer && ask.status === "loading" ? <div role="status">thinking</div> : null}
      {ask.status === "key" ? <div role="alert" className="text-danger">ask needs an Anthropic key</div> : null}
      {ask.status === "error" ? <div role="alert" className="text-danger">ask failed, retry</div> : null}
      {ask.answer ? <p className="whitespace-pre-wrap text-13 text-text">{answer}</p> : null}
    </div>
    <Command.List className={cn("palette-lists flex min-h-0 flex-col overflow-hidden [&>[cmdk-list-sizer]]:min-h-0 [&>[cmdk-list-sizer]]:overflow-hidden", list
      ? "[&>[cmdk-list-sizer]]:grid [&>[cmdk-list-sizer]]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:[&>[cmdk-list-sizer]]:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] md:[&>[cmdk-list-sizer]]:grid-rows-1"
      : "[&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:flex-col")}>
      <div className="palette-pane palette-pane-threads flex min-h-0 min-w-0 flex-col" data-active="true">
        <div className="palette-pane-heading shrink-0"><Heading name={list ? "threads" : "sources"} count={list?.total ?? ask.sources.length} />
          {list ? <span role="status" className="block px-3 pb-2 text-11 text-text-muted">{list.total} matched{list.total > list.hits.length ? ` · showing ${list.hits.length}` : ""}</span> : null}
        </div>
        <div className="palette-pane-scroll min-h-0 overflow-y-auto overscroll-contain pb-1">
          {(ask.status === "error" || ask.status === "key") ? <Item value="ask:retry" onSelect={onRetry}>retry ask</Item> : null}
          {list ? <Command.Group heading={<span className="sr-only">threads</span>}>
            {list.hits.map((hit) => <Item key={hit.id} className="palette-thread-row" value={`thread:${hit.id}`} onSelect={() => onOpen(hit.id, hit.bucket)}>
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="flex shrink-0 gap-1">{hit.accountIds.map((id) => <AccountSquare key={id} color={colors.get(id)} />)}</span>
                <span className="min-w-0 flex-1 break-words font-medium" title={hit.sender}>{hit.related ? hit.sender : <Highlight text={hit.sender} words={ask.plan?.query.split(/\s+/) ?? []} />}</span>
                {hit.related ? <span className="shrink-0 text-11 text-text-muted">related</span> : null}
                {hit.archived ? <span className="shrink-0 text-11 text-text-dim">archived</span> : null}
                <Time iso={hit.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
              </span>
              <span className="line-clamp-2 w-full break-words" title={hit.subject}>{hit.subject}</span>
              {hit.snippet ? <span className="flex w-full min-w-0 items-baseline gap-2 text-12 text-text-muted"><span className="shrink-0 text-11">message</span><span className="line-clamp-2 min-w-0 break-words">{hit.related ? hit.snippet : <Snippet text={hit.snippet} />}</span></span> : null}
            </Item>)}
          </Command.Group> : null}
          <Command.Group heading={list ? <Heading name="sources" count={ask.sources.length} /> : <span className="sr-only">sources</span>}>
            {ordered.map((source) => <Item key={source.id} className="palette-thread-row" value={`source:${source.id}`} onSelect={() => onOpen(source.id, source.bucket)}>
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="flex shrink-0 gap-1">{source.accountIds.map((id) => <AccountSquare key={id} color={colors.get(id)} />)}</span>
                <span className="min-w-0 flex-1 break-words font-medium">[{source.n}] {source.sender}</span>
                <Time iso={source.lastMessageAt} className="shrink-0 text-11 text-text-muted" />
              </span>
              <span className="line-clamp-2 w-full break-words">{source.subject}</span>
              {source.attachments.length ? <span className="text-11 text-text-muted">{source.attachments.join(", ")}</span> : null}
            </Item>)}
          </Command.Group>
        </div>
      </div>
      {list ? <div className="palette-pane palette-pane-actions flex min-h-0 min-w-0 flex-col" data-active="true">
        <div className="palette-pane-heading shrink-0"><Heading name="act on results" /><p className="px-3 pb-2 text-11 text-text-muted">bulk actions preview before running</p></div>
        <div className="palette-pane-scroll min-h-0 overflow-y-auto overscroll-contain pb-1"><Command.Group heading={<span className="sr-only">bulk previews</span>}>
          {bulkActions(projects).map((action) => {
            const n = counts?.[action.key] ?? 0;
            return <Item key={action.key} value={`act:${action.key}`} disabled={!n} onSelect={() => onBulk(action.key, action.label)}>
              <span className="flex-1">{action.label}</span><span className={cn("text-11", n > 1 ? "text-info" : "text-text-dim")}>{counts ? n ? plural(n) : "nothing to change" : "counting"}</span>
            </Item>;
          })}
        </Command.Group></div>
      </div> : null}
    </Command.List>
    <div className="palette-footer flex min-h-row shrink-0 items-center border-t border-border px-3 text-11 text-text-muted md:h-row">
      <button type="button" onClick={onBack} className="h-touch md:hidden">back</button>
      <KeyHints className="ml-auto" hints={[["arrowup arrowdown", "move"], ["enter", "open"], ["escape", "back"]]} />
    </div>
  </>;
}
