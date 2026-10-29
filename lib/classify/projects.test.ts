import { describe, expect, it } from "vitest";

import { decideProject, orgDomain } from "./projects";

const all = new Set(["gobcan", "ayala"]);

describe("decideProject", () => {
  it("moves mail from a sender nearly always in one project", () => {
    expect(decideProject({ sender: { total: 22, byProject: { gobcan: 22 } } }, all)).toEqual({ projectId: "gobcan", sure: true, why: "sender" });
    expect(decideProject({ sender: { total: 3, byProject: { ayala: 3 } } }, all)?.sure).toBe(true);
  });

  it("asks about a sender seen once or twice there", () => {
    expect(decideProject({ sender: { total: 1, byProject: { gobcan: 1 } } }, all)).toEqual({ projectId: "gobcan", sure: false, why: "sender" });
    expect(decideProject({ sender: { total: 7, byProject: { gobcan: 2 } } }, all)).toBeNull();
  });

  it("is surer of a sender than of a domain shared with other work", () => {
    // gobiernodecanarias.org: 26 of 40 threads in the project.
    expect(decideProject({ domain: { total: 40, byProject: { gobcan: 26 } } }, all)).toEqual({ projectId: "gobcan", sure: false, why: "domain" });
    // inerza.com: 22 of 23.
    expect(decideProject({ domain: { total: 23, byProject: { gobcan: 22 } } }, all)?.sure).toBe(true);
  });

  it("only ever asks on meaning", () => {
    expect(decideProject({ neighbors: { total: 10, byProject: { gobcan: 10 } } }, all)).toEqual({ projectId: "gobcan", sure: false, why: "meaning" });
    expect(decideProject({ neighbors: { total: 4, byProject: { gobcan: 2 } } }, all)).toBeNull();
  });

  it("takes a sure signal over a doubtful one, and skips projects it may not use", () => {
    const evidence = { sender: { total: 2, byProject: { ayala: 1 } }, domain: { total: 10, byProject: { gobcan: 9 } } };
    expect(decideProject(evidence, all)).toEqual({ projectId: "gobcan", sure: true, why: "domain" });
    expect(decideProject(evidence, new Set(["ayala"]))).toEqual({ projectId: "ayala", sure: false, why: "sender" });
    expect(decideProject(evidence, new Set())).toBeNull();
  });
});

describe("orgDomain", () => {
  it("reads an organisation's domain and ignores personal mail providers", () => {
    expect(orgDomain("jdayala@AyalaEHijo.net")).toBe("ayalaehijo.net");
    expect(orgDomain("someone@gmail.com")).toBeNull();
    expect(orgDomain(null)).toBeNull();
  });
});
