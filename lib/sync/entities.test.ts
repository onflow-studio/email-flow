import { describe, expect, it } from "vitest";

import {
  normalizeName,
  planEntityUpdate,
  planLinks,
  questionPair,
  resolveProposal,
  wantsEntities,
  type CatalogEntity,
  type EntityCatalog,
  type EntityThread,
} from "./entities";

const OWN = ["me@personal.example", "me@work1.example", "me@work2.example"];

function entity(overrides: Partial<CatalogEntity> & Pick<CatalogEntity, "id" | "name">): CatalogEntity {
  return {
    type: "person",
    normName: normalizeName(overrides.name),
    aliases: [],
    mergedIntoId: null,
    deletedAt: null,
    ...overrides,
  };
}

const proposal = (overrides: Partial<Parameters<typeof resolveProposal>[0]> = {}) => ({
  ref: "new:1",
  type: "person" as const,
  name: "Someone New",
  aliases: [],
  emails: [],
  ...overrides,
});

const catalog: EntityCatalog = {
  entities: [
    entity({ id: "lena", name: "Lena Park", aliases: ["Lenny"] }),
    entity({ id: "old-lena", name: "L. Park", mergedIntoId: "lena" }),
    entity({ id: "acme", type: "company", name: "Acme IA" }),
    entity({ id: "gone", type: "company", name: "Bluebird Labs", deletedAt: new Date("2026-10-01") }),
  ],
  senderLinks: [{ email: "lena@work2.example", entityId: "lena" }],
};

describe("normalizeName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeName("Acme IA")).toBe(normalizeName("acme ia"));
    expect(normalizeName("  José-María  Núñez ")).toBe("jose maria nunez");
  });

  it("keeps different letters apart", () => {
    expect(normalizeName("acme ai")).not.toBe(normalizeName("Acme IA"));
  });
});

describe("resolveProposal", () => {
  it("takes a known ref", () => {
    expect(resolveProposal(proposal({ ref: "lena", name: "Lena" }), catalog, OWN)).toEqual({ kind: "existing", id: "lena" });
  });

  it("follows a ref to a merged entity to the winner", () => {
    expect(resolveProposal(proposal({ ref: "old-lena", name: "L. Park" }), catalog, OWN)).toEqual({
      kind: "existing",
      id: "lena",
    });
  });

  it("finds the same person from another account and address through the sender link", () => {
    const p = proposal({ name: "L.P.", emails: ["me@work1.example", "Lena@Work2.example"] });
    expect(resolveProposal(p, catalog, OWN)).toEqual({ kind: "existing", id: "lena" });
  });

  it("matches an alias, normalized", () => {
    expect(resolveProposal(proposal({ name: "lenny" }), catalog, OWN)).toEqual({ kind: "existing", id: "lena" });
    expect(resolveProposal(proposal({ type: "company", name: "ACME  ia" }), catalog, OWN)).toEqual({
      kind: "existing",
      id: "acme",
    });
  });

  it("only matches names of the same type", () => {
    expect(resolveProposal(proposal({ type: "project", name: "Acme IA" }), catalog, OWN)).toEqual({ kind: "new" });
  });

  it("suppresses a deleted entity's name", () => {
    expect(resolveProposal(proposal({ type: "company", name: "Bluebird labs" }), catalog, OWN)).toEqual({
      kind: "suppressed",
    });
    expect(resolveProposal(proposal({ ref: "gone", type: "company", name: "Bluebird" }), catalog, OWN)).toEqual({
      kind: "suppressed",
    });
  });

  it("suppresses the user, known by their own addresses", () => {
    const p = proposal({ name: "Alex Rivera", emails: ["ME@personal.example"] });
    expect(resolveProposal(p, catalog, OWN)).toEqual({ kind: "suppressed" });
  });

  it("makes an unknown name new", () => {
    expect(resolveProposal(proposal({ name: "Hugo Lind", emails: ["hugo@agency.example"] }), catalog, OWN)).toEqual({
      kind: "new",
    });
  });
});

describe("planEntityUpdate", () => {
  const lena = { name: "Lena Park", aliases: ["Lenny"], summary: "Runs the cohorts.", userEditedAt: null };

  it("leaves an entity the user edited alone", () => {
    const edited = { ...lena, userEditedAt: new Date("2026-10-01") };
    expect(planEntityUpdate(edited, { name: "Lena P.", aliases: ["LP"], summary: "Something else." })).toBeNull();
  });

  it("joins aliases and replaces the summary", () => {
    expect(planEntityUpdate(lena, { name: "Lena P.", aliases: ["lenny", "LENA PARK", "LP"], summary: "Runs cohort 14." })).toEqual({
      aliases: ["Lenny", "Lena P.", "LP"],
      summary: "Runs cohort 14.",
    });
  });

  it("keeps the summary when none is proposed, and changes nothing when nothing is new", () => {
    expect(planEntityUpdate(lena, { name: "Lena Park", aliases: ["Lenny"], summary: null })).toBeNull();
  });
});

describe("planLinks", () => {
  it("does not add a rejected link again, nor repeats", () => {
    const existing = [{ entityId: "lena", threadId: "t1", rejected: true }];
    const wanted = [
      { entityId: "lena", threadId: "t1", source: "ai" as const },
      { entityId: "lena", threadId: "t2", source: "ai" as const },
      { entityId: "lena", threadId: "t2", source: "ai" as const },
      { entityId: "lena", senderId: "t1", source: "ai" as const },
    ];
    expect(planLinks(existing, wanted)).toEqual([wanted[1], wanted[3]]);
  });
});

describe("questionPair", () => {
  it("orders the pair as stored", () => {
    expect(questionPair("b", "a")).toEqual(["a", "b"]);
    expect(questionPair("a", "b")).toEqual(["a", "b"]);
    expect(questionPair("a", "a")).toBeNull();
  });

  it("never asks a pair again, whatever the answer was", () => {
    expect(questionPair("b", "a", [{ entityId: "a", otherEntityId: "b", status: "different" } as never])).toBeNull();
  });
});

describe("wantsEntities", () => {
  const thread: EntityThread = {
    bucket: "inbox",
    bucketSource: "ai",
    spam: false,
    trashed: false,
    lastMessageAt: new Date("2026-10-20T10:00:00Z"),
    entitiesMessageAt: null,
    screenerDecision: "allowed",
  };

  it("reads placed Inbox and Receipts mail with unread messages", () => {
    expect(wantsEntities(thread)).toBe(true);
    expect(wantsEntities({ ...thread, bucket: "receipts", bucketSource: "user" })).toBe(true);
    expect(wantsEntities({ ...thread, screenerDecision: null })).toBe(true);
    expect(wantsEntities({ ...thread, entitiesMessageAt: new Date("2026-10-19T10:00:00Z") })).toBe(true);
  });

  it("skips other buckets, unplaced, spam, trash, screened-out senders and up-to-date threads", () => {
    expect(wantsEntities({ ...thread, bucket: "news" })).toBe(false);
    expect(wantsEntities({ ...thread, bucket: "paper_trail" })).toBe(false);
    expect(wantsEntities({ ...thread, bucket: "triage" })).toBe(false);
    expect(wantsEntities({ ...thread, bucketSource: null })).toBe(false);
    expect(wantsEntities({ ...thread, spam: true })).toBe(false);
    expect(wantsEntities({ ...thread, trashed: true })).toBe(false);
    expect(wantsEntities({ ...thread, screenerDecision: "out_spam" })).toBe(false);
    expect(wantsEntities({ ...thread, screenerDecision: "out_not_now" })).toBe(false);
    expect(wantsEntities({ ...thread, entitiesMessageAt: thread.lastMessageAt })).toBe(false);
  });
});
