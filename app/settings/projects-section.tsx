"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";

import { Time } from "@/components/mail/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  addFromSearch,
  createProject,
  deleteProject,
  previewSearch,
  renameProject,
  setProjectSince,
  type ProjectState,
  type SearchPreview,
} from "./project-actions";

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  labelName: string;
  since: string | null;
  live: number;
  archived: number;
  toCheck: number;
};
export type LabelOption = { name: string; threads: number };

const input =
  "rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none transition-colors duration-80 ease-snap placeholder:text-text-dim focus:border-accent";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ProjectsSection({ projects, labels }: { projects: ProjectRow[]; labels: LabelOption[] }) {
  const [adding, setAdding] = useState(projects.length === 0);
  const [made, setMade] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-15 font-medium">projects</h2>
        {adding ? null : (
          <Button
            size="sm"
            onClick={() => {
              setMade(null);
              setAdding(true);
            }}
          >
            + new project
          </Button>
        )}
      </div>
      <p className="text-text-muted">buckets you name. each has a gmail label: a thread with it is in the project, out of inbox</p>

      {adding ? (
        <NewProject
          labels={labels}
          canCancel={projects.length > 0}
          onDone={(message) => {
            setMade(message ?? null);
            setAdding(false);
          }}
        />
      ) : null}
      {made ? (
        <p role="status" className="text-12 text-text-muted">
          {made}
        </p>
      ) : null}

      {projects.length ? (
        <div className="overflow-x-auto rounded-sm border border-border bg-surface">
          <table className="w-full text-left text-13">
            <thead className="text-11 whitespace-nowrap text-text-dim">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-normal">name</th>
                <th className="px-3 py-2 font-normal">label</th>
                <th className="px-3 py-2 text-right font-normal">in project</th>
                <th className="px-3 py-2 text-right font-normal">archived</th>
                <th className="px-3 py-2 text-right font-normal">to check</th>
                <th className="px-3 py-2 font-normal">sorts from</th>
                <th className="w-8 px-3 py-2">
                  <span className="sr-only">edit</span>
                </th>
              </tr>
            </thead>
            {projects.map((p) => (
              <Project key={p.id} project={p} />
            ))}
          </table>
        </div>
      ) : null}
    </section>
  );
}

const sortsFrom = (since: string | null) => (since ? <Time iso={since} format="full" /> : "all history");

function Project({ project: p }: { project: ProjectRow }) {
  const [open, setOpen] = useState(false);
  return (
    <tbody className="border-b border-border last:border-b-0">
      <tr className="h-row">
        <td className="px-3">
          <Link href={`/p/${p.slug}`} className="text-text hover:underline">
            {p.name}
          </Link>
        </td>
        <td className="px-3 text-text-muted">{p.labelName}</td>
        <td className="px-3 text-right tabular-nums">{p.live}</td>
        <td className="px-3 text-right text-text-muted tabular-nums">{p.archived}</td>
        <td className={cn("px-3 text-right tabular-nums", p.toCheck ? "text-info" : "text-text-muted")}>{p.toCheck}</td>
        <td className="px-3 whitespace-nowrap text-text-muted">{sortsFrom(p.since)}</td>
        <td className="px-1">
          <Button variant="ghost" size="sm" aria-expanded={open} aria-label={`edit ${p.name}`} onClick={() => setOpen(!open)}>
            <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.5} />
          </Button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <ProjectEdit project={p} />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function ProjectEdit({ project: p }: { project: ProjectRow }) {
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  const [search, setSearch] = useState("");
  const [added, add, adding] = useActionState(async (prev: ProjectState, data: FormData) => {
    const result = await addFromSearch(prev, data);
    if (result?.ok) setSearch("");
    return result;
  }, null);
  const [moved, move, moving] = useActionState(setProjectSince, null);
  return (
    <div className={cn("flex flex-col gap-3 rounded-sm border border-border bg-bg p-3", pending && "opacity-60")}>
      <Field label="name">
        <input
          defaultValue={p.name}
          aria-label={`rename ${p.name}`}
          maxLength={60}
          onBlur={(e) => e.target.value.trim() !== p.name && start(() => renameProject(p.id, e.target.value))}
          className={cn(input, "h-row w-full")}
        />
      </Field>
      <form action={add}>
        <input type="hidden" name="project" value={p.id} />
        <Field label="add threads">
          <SearchField value={search} onChange={setSearch} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={adding || !search.trim()}>
              {adding ? "adding" : "add them"}
            </Button>
            <Status state={added} />
          </div>
        </Field>
      </form>
      <form action={move}>
        <input type="hidden" name="project" value={p.id} />
        <Field label="sorts from">
          <FromPicker initial={p.since ? "since" : "all"} since={p.since} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={moving}>
              {moving ? "saving" : "save"}
            </Button>
            <Status state={moved} />
          </div>
        </Field>
      </form>
      <Field label="">
        <div className="flex items-center gap-3">
          <Button
            variant="delete"
            size="sm"
            disabled={pending}
            onClick={() => (sure ? start(() => deleteProject(p.id)) : setSure(true))}
            onBlur={() => setSure(false)}
          >
            {sure ? "delete, sure?" : "delete project"}
          </Button>
          <span className="text-11 text-text-dim">its threads go back to their buckets; the gmail label stays on them</span>
        </div>
      </Field>
    </div>
  );
}

function NewProject({
  labels,
  onDone,
  canCancel,
}: {
  labels: LabelOption[];
  onDone: (message?: string) => void;
  canCancel: boolean;
}) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [state, action, making] = useActionState(async (prev: ProjectState, data: FormData) => {
    const result = await createProject(prev, data);
    if (result?.ok) onDone(result.message);
    return result;
  }, null);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-sm border border-border bg-surface p-3">
      <h3 className="text-13 font-medium">new project</h3>
      <Field label="name">
        <input
          name="name"
          required
          maxLength={60}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="project name"
          className={cn(input, "h-row w-full")}
        />
      </Field>
      <Field label="gmail label">
        <select name="label" aria-label="gmail label" defaultValue="" className={cn(input, "h-row w-full")}>
          <option value="">new label: {name.trim() || "the name"}</option>
          {labels.length ? (
            <optgroup label="or use one you have">
              {labels.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name} · {plural(l.threads, "thread")}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <p className="text-11 text-text-dim">a label you have brings its threads in</p>
      </Field>
      <Field label="start with">
        <SearchField value={search} onChange={setSearch} name="search" optional />
      </Field>
      <Field label="sorts from">
        <FromPicker initial="all" since={null} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={making}>
          {making ? "making" : "make project"}
        </Button>
        {canCancel ? (
          <Button type="button" variant="ghost" onClick={() => onDone()}>
            cancel
          </Button>
        ) : null}
        <Status state={state} />
      </div>
    </form>
  );
}

/** A label on the left, its controls on the right; stacked on a phone. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
      <span className="shrink-0 pt-1.5 text-12 text-text-muted sm:w-24">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

/** A search in the palette's syntax, with what it would put in the project. */
function SearchField({
  value,
  onChange,
  name = "search",
  optional = false,
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  optional?: boolean;
}) {
  const [preview, setPreview] = useState<{ query: string; result: SearchPreview } | null>(null);
  const query = value.trim();
  useEffect(() => {
    if (!query) return;
    let live = true;
    const timer = setTimeout(() => {
      previewSearch(query).then((result) => live && setPreview({ query, result }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const shown = query && preview?.query === query ? preview.result : null;
  return (
    <>
      <input
        name={name}
        maxLength={500}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={optional ? "optional, e.g. from:northwind.example" : "e.g. from:northwind.example"}
        aria-label="search"
        className={cn(input, "h-row w-full")}
      />
      <p className="text-11 text-text-dim">
        words, &quot;a phrase&quot;, from:person or domain, after:2025-03, before:2026
      </p>
      {query ? (
        <p aria-live="polite" className="text-12 text-text-muted">
          {!shown ? (
            "searching"
          ) : shown.count === 0 ? (
            "finds no threads outside a project"
          ) : (
            <>
              <span className="text-text">finds {plural(shown.count, "thread")}</span>
              {": "}
              {shown.subjects.map((s) => `“${s}”`).join(", ")}
              {shown.count > shown.subjects.length ? `, +${shown.count - shown.subjects.length}` : ""}
            </>
          )}
        </p>
      ) : null}
    </>
  );
}

function FromPicker({ initial, since }: { initial: string; since: string | null }) {
  const [from, setFrom] = useState(initial);
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-text-muted">
      <legend className="sr-only">sort mail from</legend>
      {[
        ["all", "all history"],
        ["since", "a date"],
        ["new", "new mail only"],
      ].map(([value, label]) => (
        <label key={value} className="flex h-touch cursor-pointer items-center gap-2 md:h-6">
          <input type="radio" name="from" value={value} checked={from === value} onChange={() => setFrom(value)} className="accent-accent" />
          {label}
        </label>
      ))}
      {from === "since" ? (
        <input type="date" name="since" required defaultValue={since?.slice(0, 10)} aria-label="sort from date" className={cn(input, "h-6")} />
      ) : null}
    </fieldset>
  );
}

function Status({ state }: { state: ProjectState }) {
  return state ? (
    <p role="status" className={cn("text-11", state.ok ? "text-text-muted" : "text-warning")}>
      {state.message}
    </p>
  ) : null;
}
