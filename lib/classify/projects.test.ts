import { describe, expect, it } from "vitest";

import { decideProject, orgDomain } from "./projects";

const all = new Set(["cohort", "studio"]);

describe("decideProject", () => {
  it("moves mail from a sender nearly always in one project", () => {
    expect(decideProject({ sender: { total: 22, byProject: { cohort: 22 } } }, all)).toEqual({ projectId: "cohort", sure: true, why: "sender" });
    expect(decideProject({ sender: { total: 3, byProject: { studio: 3 } } }, all)?.sure).toBe(true);
  });

  it("asks about a sender seen once or twice there", () => {
    expect(decideProject({ sender: { total: 1, byProject: { cohort: 1 } } }, all)).toEqual({ projectId: "cohort", sure: false, why: "sender" });
    expect(decideProject({ sender: { total: 7, byProject: { cohort: 2 } } }, all)).toBeNull();
  });

  it("is surer of a sender than of a domain shared with other work", () => {
    // cityhall.example: 26 of 40 threads in the project.
    expect(decideProject({ domain: { total: 40, byProject: { cohort: 26 } } }, all)).toEqual({ projectId: "cohort", sure: false, why: "domain" });
    // vendor.example: 22 of 23.
    expect(decideProject({ domain: { total: 23, byProject: { cohort: 22 } } }, all)?.sure).toBe(true);
  });

  it("only ever asks on meaning", () => {
    expect(decideProject({ neighbors: { total: 10, byProject: { cohort: 10 } } }, all)).toEqual({ projectId: "cohort", sure: false, why: "meaning" });
    expect(decideProject({ neighbors: { total: 4, byProject: { cohort: 2 } } }, all)).toBeNull();
  });

  it("takes a sure signal over a doubtful one, and skips projects it may not use", () => {
    const evidence = { sender: { total: 2, byProject: { studio: 1 } }, domain: { total: 10, byProject: { cohort: 9 } } };
    expect(decideProject(evidence, all)).toEqual({ projectId: "cohort", sure: true, why: "domain" });
    expect(decideProject(evidence, new Set(["studio"]))).toEqual({ projectId: "studio", sure: false, why: "sender" });
    expect(decideProject(evidence, new Set())).toBeNull();
  });
});

describe("orgDomain", () => {
  it("reads an organisation's domain and ignores personal mail providers", () => {
    expect(orgDomain("ops@Northwind.example")).toBe("northwind.example");
    expect(orgDomain("someone@gmail.com")).toBeNull();
    expect(orgDomain(null)).toBeNull();
  });
});
