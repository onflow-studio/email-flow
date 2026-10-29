"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";

import { Time } from "@/components/mail/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { createProject, deleteProject, renameProject } from "./project-actions";

export type ProjectRow = { id: string; name: string; slug: string; labelName: string; since: string | null; threads: number };

const input =
  "rounded-sm border border-border bg-surface px-2 text-13 text-text outline-none transition-colors duration-80 ease-snap placeholder:text-text-dim focus:border-accent";

export function ProjectsSection({ projects, labels }: { projects: ProjectRow[]; labels: string[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState("all");
  const [state, action, adding] = useActionState(async (prev: Awaited<ReturnType<typeof createProject>>, data: FormData) => {
    const result = await createProject(prev, data);
    if (result?.ok) {
      form.current?.reset();
      setFrom("all");
    }
    return result;
  }, null);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-15 font-medium">projects</h2>
      <p className="text-text-muted">buckets you name. each is a gmail label: a thread with the label is in the project, out of inbox</p>

      <form ref={form} action={action} className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="name" required maxLength={60} autoComplete="off" placeholder="name" aria-label="project name" className={cn(input, "h-row min-w-0 flex-1")} />
          <input
            name="label"
            list="project-labels"
            maxLength={225}
            autoComplete="off"
            placeholder="gmail label, the name when empty"
            aria-label="gmail label"
            className={cn(input, "h-row min-w-0 flex-1")}
          />
          <input
            name="search"
            maxLength={500}
            autoComplete="off"
            placeholder="start with a search, e.g. from:northwind.example"
            aria-label="start with the threads a search finds"
            className={cn(input, "h-row min-w-0 flex-1")}
          />
          <datalist id="project-labels">
            {labels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-text-muted">
          <legend className="sr-only">sort mail from</legend>
          <span>sort from</span>
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
          {from === "since" ? <input type="date" name="since" required aria-label="sort from date" className={cn(input, "h-6")} /> : null}
        </fieldset>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={adding}>
            {adding ? "making" : "make project"}
          </Button>
          {state ? (
            <p role="status" className={cn("text-11", state.ok ? "text-text-muted" : "text-warning")}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>

      <div className="rounded-sm border border-border bg-surface px-3">
        {projects.length === 0 ? <p className="py-4 text-text-muted">no projects</p> : projects.map((p) => <Project key={p.id} project={p} />)}
      </div>
    </section>
  );
}

function Project({ project }: { project: ProjectRow }) {
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0", pending && "opacity-60")}>
      <input
        defaultValue={project.name}
        aria-label={`rename ${project.name}`}
        maxLength={60}
        onBlur={(e) => e.target.value.trim() !== project.name && start(() => renameProject(project.id, e.target.value))}
        className="min-w-0 flex-1 bg-transparent text-text outline-none focus:underline"
      />
      <span className="text-12 text-text-muted">label {project.labelName}</span>
      <span className="text-12 text-text-muted tabular-nums">
        {project.threads} {project.threads === 1 ? "thread" : "threads"}
      </span>
      <span className="text-12 text-text-muted">{project.since ? <>from <Time iso={project.since} format="full" /></> : "all history"}</span>
      <Link href={`/p/${project.slug}`} className="text-12 text-text-muted underline hover:text-text">
        open
      </Link>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => (sure ? start(() => deleteProject(project.id)) : setSure(true))}
        onBlur={() => setSure(false)}
        title="its threads go back to their buckets; the gmail label stays on them"
      >
        {sure ? "delete, sure?" : "delete"}
      </Button>
    </div>
  );
}
