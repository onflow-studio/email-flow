"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { AccountSquare } from "@/components/mail/account-square";
import { Time } from "@/components/mail/time";
import { mailHref } from "@/components/mail/views";
import { Button } from "@/components/ui/button";
import type { EntityType } from "@/lib/db/schema";

import { deleteEntity, mergeEntities, renameEntity, setAliases, setSummary, unlinkThread } from "./people-actions";
import { Questions } from "./people-section";
import type { QuestionRow } from "./people-data";

type Entity = { id: string; type: EntityType; name: string; aliases: string[]; summary: string | null };
type ThreadRow = { id: string; subject: string | null; lastMessageAt: string; copies: { id: string; color: string }[] };
type SenderRow = { email: string; color: string | null; accountId: string | null };

const field = "min-w-0 rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none focus:border-accent";

export function EntitySection({ entity, mergeTargets, questions, senders, related, threads }: {
  entity: Entity;
  mergeTargets: { id: string; name: string }[];
  questions: QuestionRow[];
  senders: SenderRow[];
  related: { id: string; name: string; relation: string | null }[];
  threads: ThreadRow[];
}) {
  const [nameState, nameAction, naming] = useActionState(renameEntity.bind(null, entity.id), null);
  const [aliasState, aliasAction, aliasing] = useActionState(setAliases.bind(null, entity.id), null);
  const [summaryState, summaryAction, summarizing] = useActionState(setSummary.bind(null, entity.id), null);
  const [editing, setEditing] = useState<"name" | "aliases" | "summary" | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirm, setConfirm] = useState<"merge" | "delete" | null>(null);
  const [pending, start] = useTransition();
  const addresses = new Map<string, (string | null)[]>();
  for (const sender of senders) addresses.set(sender.email, [...(addresses.get(sender.email) ?? []), sender.color]);

  return <div className="flex min-w-0 flex-col gap-4">
    <Link href="/settings/people" className="self-start text-11 text-text-muted hover:text-text">← people</Link>
    <header className="flex min-w-0 flex-col gap-2">
      <p className="text-11 text-text-muted">{entity.type}</p>
      <h1 className="break-words text-20 font-semibold">{entity.name}</h1>
      {editing === "name" ? <form action={nameAction} className="flex min-w-0 flex-wrap gap-2">
        <input name="name" aria-label="name" defaultValue={entity.name} required maxLength={120} className={`${field} h-row flex-1`} />
        <Button type="submit" disabled={naming}>save</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>cancel</Button>
        {nameState?.error ? <p role="alert" className="w-full text-warning">{nameState.error}</p> : null}
      </form> : <Button className="self-start" variant="ghost" onClick={() => setEditing("name")}>rename</Button>}
    </header>

    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-15 font-medium">summary</h2>
      {editing === "summary" ? <form action={summaryAction} className="flex min-w-0 flex-col gap-2">
        <textarea name="summary" aria-label="summary" defaultValue={entity.summary ?? ""} maxLength={500} rows={3} className={`${field} w-full p-2`} />
        <div className="flex gap-1"><Button type="submit" disabled={summarizing}>save</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>cancel</Button></div>
        {summaryState?.error ? <p role="alert" className="text-warning">{summaryState.error}</p> : null}
      </form> : <><p className="break-words text-text-muted">{entity.summary ?? "no summary"}</p><Button className="self-start" variant="ghost" onClick={() => setEditing("summary")}>edit summary</Button></>}
    </section>

    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-15 font-medium">aliases</h2>
      {editing === "aliases" ? <form action={aliasAction} className="flex min-w-0 flex-wrap gap-2">
        <input name="aliases" aria-label="aliases, separated by commas" defaultValue={entity.aliases.join(", ")} className={`${field} h-row flex-1`} />
        <Button type="submit" disabled={aliasing}>save</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>cancel</Button>
        {aliasState?.error ? <p role="alert" className="w-full text-warning">{aliasState.error}</p> : null}
      </form> : <><p className="break-words text-text-muted">{entity.aliases.join(", ") || "no aliases"}</p><Button className="self-start" variant="ghost" onClick={() => setEditing("aliases")}>edit aliases</Button></>}
    </section>

    <Questions questions={questions} />

    {entity.type === "person" && addresses.size > 0 ? <section className="flex flex-col gap-2">
      <h2 className="text-15 font-medium">addresses</h2>
      {[...addresses].map(([email, colors]) => <div key={email} className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border py-2 last:border-b-0">
        <span className="break-all text-text-muted">{email}</span><span className="flex gap-1">{colors.filter((color): color is string => color !== null).map((color, index) => <AccountSquare key={`${color}-${index}`} color={color} />)}</span>
      </div>)}
    </section> : null}

    {related.length > 0 ? <section className="flex flex-col gap-2"><h2 className="text-15 font-medium">related</h2>
      {related.map((item) => <Link key={item.id} href={`/settings/people/${item.id}`} className="flex min-w-0 flex-wrap gap-2 border-b border-border py-2 text-text hover:text-accent"><span className="break-words">{item.name}</span><span className="text-text-muted">{item.relation}</span></Link>)}
    </section> : null}

    <section className="flex min-w-0 flex-col gap-2"><h2 className="text-15 font-medium">threads</h2>
      {!threads.length ? <p className="text-text-muted">no threads</p> : <div className="rounded-sm border border-border bg-surface px-3">{threads.map((thread) => <div key={thread.id} className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border py-3 last:border-b-0">
        <Link href={mailHref("inbox", { threadId: thread.id })} className="min-w-0 flex-1 break-words text-text hover:text-accent">{thread.subject || "(no subject)"}</Link>
        <span className="flex gap-1">{thread.copies.map((copy) => <AccountSquare key={copy.id} color={copy.color} />)}</span>
        <Time iso={thread.lastMessageAt} className="text-11 text-text-muted" />
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => unlinkThread(entity.id, thread.id))}>unlink</Button>
      </div>)}</div>}
    </section>

    <section className="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
      <h2 className="text-15 font-medium">actions</h2>
      {mergeTargets.length ? <div className="flex min-w-0 flex-wrap gap-2">
        <select aria-label="merge into" value={mergeTarget} onChange={(event) => { setMergeTarget(event.target.value); setConfirm(null); }} className={`${field} h-row flex-1`}>
          <option value="">merge into…</option>{mergeTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
        <Button disabled={!mergeTarget || pending} variant={confirm === "merge" ? "delete" : "secondary"} onClick={() => {
          if (confirm !== "merge") { setConfirm("merge"); return; }
          start(() => mergeEntities(entity.id, mergeTarget));
        }}>{confirm === "merge" ? "merge? press again" : "merge"}</Button>
      </div> : null}
      <Button className="self-start" disabled={pending} variant="delete" onClick={() => {
        if (confirm !== "delete") { setConfirm("delete"); return; }
        start(() => deleteEntity(entity.id));
      }}>{confirm === "delete" ? "delete? press again" : "delete"}</Button>
    </section>
  </div>;
}
