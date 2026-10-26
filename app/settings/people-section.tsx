"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Time } from "@/components/mail/time";
import { Button } from "@/components/ui/button";
import type { EntityType } from "@/lib/db/schema";

import { answerQuestion, dismissQuestion } from "./people-actions";
import type { QuestionRow } from "./people-data";

export type PeopleRow = { id: string; type: EntityType; name: string; aliases: string[]; threadCount: number; lastActivity: string | null };

export function Questions({ questions }: { questions: QuestionRow[] }) {
  if (!questions.length) return null;
  return <section className="flex flex-col gap-2">
    <h2 className="text-15 font-medium">questions</h2>
    <div className="rounded-sm border border-border bg-surface px-3">
      {questions.map((question) => <Question key={question.id} question={question} />)}
    </div>
  </section>;
}

function Question({ question }: { question: QuestionRow }) {
  const [pending, start] = useTransition();
  return <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
    <p className="min-w-0 break-words text-info">{question.question}</p>
    <div className="flex flex-wrap items-center gap-2 text-text-muted">
      <Link className="underline underline-offset-2 hover:text-text" href={`/settings/people/${question.entityId}`}>{question.entityName}</Link>
      <span>·</span>
      <Link className="underline underline-offset-2 hover:text-text" href={`/settings/people/${question.otherId}`}>{question.otherName}</Link>
    </div>
    <div className="flex flex-wrap gap-1">
      <Button size="sm" disabled={pending} onClick={() => start(() => answerQuestion(question.id, true))}>same</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => answerQuestion(question.id, false))}>different</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => dismissQuestion(question.id))}>dismiss</Button>
    </div>
  </div>;
}

export function PeopleSection({ rows, questions, extractorConfigured }: { rows: PeopleRow[]; questions: QuestionRow[]; extractorConfigured: boolean }) {
  const [filter, setFilter] = useState("");
  const matches = rows.filter((row) => [row.name, ...row.aliases].some((value) => value.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())));
  const groups: { type: EntityType; label: string }[] = [
    { type: "person", label: "people" },
    { type: "project", label: "projects" },
    { type: "company", label: "companies" },
  ];

  return <div className="flex min-w-0 flex-col gap-4">
    <h1 className="text-15 font-medium">people</h1>
    {!extractorConfigured ? <p className="text-warning">anthropic key not set, entities will not appear as mail is read. set ANTHROPIC_API_KEY in .env</p> : null}
    <Questions questions={questions} />
    {rows.length ? <input aria-label="filter people" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="filter names and aliases" className="h-row min-w-0 rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none transition-colors duration-80 ease-snap placeholder:text-text-dim focus:border-accent" /> : null}
    {!rows.length ? <p className="text-text-muted">nothing yet. people, projects and companies appear as mail is read</p> : null}
    {groups.map(({ type, label }) => {
      const items = matches.filter((row) => row.type === type).sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.name.localeCompare(b.name));
      if (!items.length) return null;
      return <section key={type} className="flex min-w-0 flex-col gap-2">
        <h2 className="text-15 font-medium">{label}</h2>
        <div className="rounded-sm border border-border bg-surface px-3">
          {items.map((row) => <Link key={row.id} href={`/settings/people/${row.id}`} className="flex min-w-0 flex-col gap-1 border-b border-border py-3 last:border-b-0 hover:text-accent focus-visible:text-accent">
            <span className="break-words text-text">{row.name}</span>
            {row.aliases.length ? <span className="break-words text-11 text-text-muted">{row.aliases.join(", ")}</span> : null}
            <span className="flex flex-wrap gap-2 text-11 text-text-muted"><span>{row.threadCount} {row.threadCount === 1 ? "thread" : "threads"}</span>{row.lastActivity ? <Time iso={row.lastActivity} /> : null}</span>
          </Link>)}
        </div>
      </section>;
    })}
    {rows.length > 0 && !matches.length ? <p className="text-text-muted">no matches</p> : null}
  </div>;
}
