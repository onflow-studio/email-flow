"use client";

import { createContext, useContext } from "react";

import { VIEWS } from "./views";

const WorkContext = createContext(true);

/** Whether the owner keeps a Work list; off, Work is hidden everywhere. */
export function WorkProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <WorkContext.Provider value={on}>{children}</WorkContext.Provider>;
}

export function useWorkOn() {
  return useContext(WorkContext);
}

/** The fixed views, without Work when it is off. */
export function useViews() {
  const on = useWorkOn();
  return on ? VIEWS : VIEWS.filter((v) => v.slug !== "work");
}
