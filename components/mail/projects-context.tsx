"use client";

import { createContext, useContext } from "react";

import type { ProjectRef } from "./views";

const ProjectsContext = createContext<ProjectRef[]>([]);

// For the undo toast's words, which are made outside any component.
const names = new Map<string, string>();

/** A project's name by id, once the mail views have rendered it. */
export function projectName(id: string) {
  return names.get(id) ?? "project";
}

/** The owner's projects, for the rail, the move menu and the palette. */
export function ProjectsProvider({ projects, children }: { projects: ProjectRef[]; children: React.ReactNode }) {
  for (const p of projects) names.set(p.id, p.name);
  return <ProjectsContext.Provider value={projects}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  return useContext(ProjectsContext);
}
