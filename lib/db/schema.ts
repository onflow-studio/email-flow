import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const bucket = pgEnum("bucket", [
  "inbox",
  "news",
  "paper_trail",
  "receipts",
  "triage",
  "out",
]);
export const bucketSource = pgEnum("bucket_source", ["ai", "user", "rule"]);
export const screenerDecision = pgEnum("screener_decision", [
  "allowed",
  "out_spam",
  "out_not_now",
  "none",
]);
export const decidedBy = pgEnum("decided_by", ["ai", "user"]);
export const jobType = pgEnum("job_type", ["classify", "writeback", "backfill", "entities", "embed"]);
export const entityType = pgEnum("entity_type", ["person", "project", "company"]);
// What a starred thread goes back to when unstarred.
export const starredFrom = pgEnum("starred_from", ["bucket", "archived", "snoozed", "work"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

export type Bucket = (typeof bucket.enumValues)[number];
export type BucketSource = (typeof bucketSource.enumValues)[number];
export type ScreenerDecision = (typeof screenerDecision.enumValues)[number];
export type JobType = (typeof jobType.enumValues)[number];
export type EntityType = (typeof entityType.enumValues)[number];
export type EntityQuestionStatus = "open" | "same" | "different" | "dismissed";
export type StarredFrom = (typeof starredFrom.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];

export type Address = { name: string | null; email: string };
export type BucketProbabilities = Partial<Record<Bucket, number>>;
export type MessageHeaders = {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
  precedence?: string;
  autoSubmitted?: string;
};

// A listing sync still working through its backlog: first sync, or recovery from a stale cursor.
// Epoch seconds; `before` is pinned at start so the listing stays stable across passes.
export type CatchUpState = {
  mode: "initial" | "fallback";
  after: number;
  before: number;
  pageToken: string | null;
  // Threads of that page already stored.
  offset: number;
  seen: number;
};

export const accounts = pgTable("accounts", {
  id: id(),
  email: text().notNull().unique(),
  label: text().notNull(),
  color: text().notNull(),
  // AES-GCM ciphertext, key from TOKEN_ENCRYPTION_KEY. Never store plaintext.
  accessTokenEnc: text(),
  refreshTokenEnc: text(),
  // When Google issued the stored refresh token. Null when unknown (connected before this was kept).
  refreshTokenIssuedAt: timestamp({ withTimezone: true }),
  tokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  historyId: text(),
  lastSyncAt: timestamp({ withTimezone: true }),
  lastSyncError: text(),
  catchUp: jsonb().$type<CatchUpState>(),
  signatureHtml: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const senders = pgTable(
  "senders",
  {
    id: id(),
    // Lowercased.
    email: text().notNull().unique(),
    domain: text().notNull(),
    displayName: text(),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    screenerDecision: screenerDecision().notNull().default("none"),
    // Bucket new threads from an allowed sender land in. Null means let AI decide.
    defaultBucket: bucket(),
    decidedAt: timestamp({ withTimezone: true }),
    decidedBy: decidedBy(),
    imagesAllowed: boolean().notNull().default(false),
    // Whether the sender is a machine (notifications, bulk mail), for grouping its threads. Null until
    // judged: by the rules when obvious, else by Jev. See lib/classify/machine.ts.
    machine: boolean(),
    // Jev's probability the sender is a machine; null when the rules decided.
    machineConfidence: real(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.domain)],
);

export const senderAccounts = pgTable(
  "sender_accounts",
  {
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    seenCount: integer().notNull().default(0),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.senderId, t.accountId] }),
    index().on(t.accountId),
  ],
);

export const threads = pgTable(
  "threads",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    gmailThreadId: text().notNull(),
    // First inbound sender, the one the screener and classifier judge.
    senderId: uuid().references(() => senders.id, { onDelete: "set null" }),
    subject: text(),
    lastMessageAt: timestamp({ withTimezone: true }).notNull(),
    bucket: bucket().notNull().default("inbox"),
    // Null until classified or moved.
    bucketSource: bucketSource(),
    bucketConfidence: real(),
    // Below threshold: bucket applied but shown as an AI suggestion.
    bucketSuggested: boolean().notNull().default(false),
    seenAt: timestamp({ withTimezone: true }),
    snoozedUntil: timestamp({ withTimezone: true }),
    needsReply: boolean().notNull().default(false),
    deadlineAt: timestamp({ withTimezone: true }),
    // When the thread entered Work, null when it is not there. Client-only, never written to Gmail.
    // Stored under its old name, pinned_at.
    workAt: timestamp("pinned_at", { withTimezone: true }),
    // When the thread was starred, null when it is not. Mirrored to Gmail's STARRED label.
    starredAt: timestamp({ withTimezone: true }),
    // Where unstarring puts it back. Set while starred.
    starredFrom: starredFrom(),
    archived: boolean().notNull().default(false),
    trashed: boolean().notNull().default(false),
    spam: boolean().notNull().default(false),
    participantsSummary: text(),
    // One-line AI summary, in the mail's own language. Stale when summaryMessageAt < lastMessageAt.
    summary: text(),
    summaryMessageAt: timestamp({ withTimezone: true }),
    // The last message entity extraction covered. Stale when before lastMessageAt. See lib/sync/entities.ts.
    entitiesMessageAt: timestamp({ withTimezone: true }),
    // Copies of one conversation in different accounts (twins: they share a Message-ID) share a
    // group id and act as one thread. Null for a thread with no twin. See lib/sync/twins.ts.
    groupId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.accountId, t.gmailThreadId),
    index().on(t.groupId),
    index().on(t.bucket, t.lastMessageAt),
    index().on(t.accountId, t.lastMessageAt),
    index().on(t.senderId),
    index().on(t.snoozedUntil),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: uuid()
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    gmailMessageId: text().notNull(),
    senderId: uuid().references(() => senders.id, { onDelete: "set null" }),
    fromEmail: text().notNull(),
    fromName: text(),
    to: jsonb().$type<Address[]>().notNull().default([]),
    cc: jsonb().$type<Address[]>().notNull().default([]),
    bcc: jsonb().$type<Address[]>().notNull().default([]),
    subject: text(),
    date: timestamp({ withTimezone: true }).notNull(),
    snippet: text(),
    htmlSanitized: text(),
    text: text(),
    isInbound: boolean().notNull(),
    gmailLabels: text().array().notNull().default([]),
    headers: jsonb().$type<MessageHeaders>().notNull().default({}),
    // SEARCH_CONFIG: 'simple' plus unaccent; mail is mixed English and Spanish, no stemming either
    // way. Recipients count as Gmail does, and addresses are also split at @ and dots so a
    // typed address or domain matches word by word.
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple_unaccent', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || from_email || ' ' || translate(from_email, '@.', '  ') || ' ' || jsonb_path_query_array("to" || cc || bcc, '$[*].name ? (@ != null)')::text || ' ' || translate(jsonb_path_query_array("to" || cc || bcc, '$[*].email')::text, '@.', '  ') || ' ' || coalesce(text, ''))`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.accountId, t.gmailMessageId),
    index().on(t.threadId, t.date),
    index().on(t.senderId),
    index("messages_message_id_idx").on(sql`(${t.headers}->>'messageId')`),
    index("messages_search_idx").using("gin", t.search),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text().notNull(),
    mimeType: text().notNull(),
    size: integer().notNull(),
    gmailAttachmentId: text().notNull(),
    // Set for inline images referenced as cid: in the HTML.
    contentId: text(),
  },
  (t) => [index().on(t.messageId)],
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: id(),
    messageId: uuid().notNull().references(() => messages.id, { onDelete: "cascade" }),
    threadId: uuid().notNull().references(() => threads.id, { onDelete: "cascade" }),
    accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
    chunk: integer().notNull(),
    text: text().notNull(),
    metadata: jsonb().$type<{ attachments: string[] }>(),
    model: text().notNull(),
    embedding: vector({ dimensions: 512 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.messageId, t.chunk),
    index().on(t.threadId),
    index("embeddings_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// Append-only.
export const classifications = pgTable(
  "classifications",
  {
    id: id(),
    threadId: uuid()
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    model: text().notNull(),
    rawResponse: jsonb().notNull(),
    bucket: bucket().notNull(),
    bucketProbabilities: jsonb().$type<BucketProbabilities>().notNull(),
    urgency: smallint(),
    humanWritten: boolean(),
    // Only asked when the sender is unknown.
    legitNewSender: boolean(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.threadId, t.createdAt)],
);

// Append-only. Feeds classify context.
export const corrections = pgTable(
  "corrections",
  {
    id: id(),
    threadId: uuid().references(() => threads.id, { onDelete: "set null" }),
    senderId: uuid().references(() => senders.id, { onDelete: "set null" }),
    fromBucket: bucket(),
    toBucket: bucket().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.senderId, t.createdAt), index().on(t.createdAt)],
);

export const rules = pgTable("rules", {
  id: id(),
  text: text().notNull(),
  // Parsed by Claude on save.
  structured: jsonb(),
  enabled: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: jobType().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    payload: jsonb().notNull().default({}),
    status: jobStatus().notNull().default("pending"),
    // Higher runs first. Backfill enqueues below live mail.
    priority: integer().notNull().default(0),
    attempts: integer().notNull().default(0),
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    // At most one pending job per key, e.g. `classify:<threadId>`. A running job doesn't count,
    // so a change made while it runs queues a follow-up instead of being dropped.
    dedupeKey: text(),
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.status, t.priority, t.runAfter),
    index().on(t.accountId, t.status),
    uniqueIndex("jobs_dedupe_key_pending_idx")
      .on(t.dedupeKey)
      .where(sql`status = 'pending'`),
  ],
);

export const actionsLog = pgTable(
  "actions_log",
  {
    // Doubles as the undo token.
    id: id(),
    threadId: uuid().references(() => threads.id, { onDelete: "cascade" }),
    // Shared by every row of one bulk action so it undoes as a unit.
    batchId: uuid(),
    action: text().notNull(),
    // Enough prior state to reverse the action.
    payload: jsonb().notNull().default({}),
    createdAt: createdAt(),
    undoneAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.threadId), index().on(t.batchId), index().on(t.createdAt)],
);

// Unsent messages. Each is a Gmail draft in its account; email-flow writes them from compose and
// sync reads the ones written elsewhere. See lib/sync/drafts.ts.
export const drafts = pgTable(
  "drafts",
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    gmailDraftId: text().notNull(),
    // Changes on every save; sync refetches a draft only when it differs.
    gmailMessageId: text().notNull(),
    // The thread a reply or forward belongs to.
    threadId: uuid().references(() => threads.id, { onDelete: "set null" }),
    mode: text().$type<"new" | "reply" | "reply-all" | "forward">().notNull(),
    // As typed, so a half-written address survives.
    to: text().notNull().default(""),
    cc: text().notNull().default(""),
    bcc: text().notNull().default(""),
    subject: text().notNull().default(""),
    html: text().notNull().default(""),
    // True when `html` is only what was typed in compose; signature and quote are added on send.
    // False for drafts written elsewhere, whose body already holds them.
    composed: boolean().notNull().default(true),
    // When it was last edited, here or elsewhere.
    date: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.accountId, t.gmailDraftId), index().on(t.threadId)],
);

// Files attached in compose, held until the message is sent. A file arrives in parts small enough for
// one request on Vercel, which caps a body at 4.5 MB; send joins them. Leftovers expire after a day.
export const composeUploads = pgTable(
  "compose_uploads",
  {
    id: uuid().notNull(),
    part: smallint().notNull(),
    filename: text().notNull(),
    mimeType: text().notNull(),
    data: bytea().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.id, t.part] }), index().on(t.createdAt)],
);

// The semantic layer: people, projects and companies the mail is about, read by lib/sync/entities.ts.
// User corrections stick: userEditedAt freezes name, aliases and summary; a merged-away or deleted
// entity stays as a tombstone so its names keep resolving (to the winner, or to nothing).
export const entities = pgTable(
  "entities",
  {
    id: id(),
    type: entityType().notNull(),
    name: text().notNull(),
    // normalizeName(name), for matching.
    normName: text().notNull(),
    aliases: text().array().notNull().default([]),
    summary: text(),
    userEditedAt: timestamp({ withTimezone: true }),
    mergedIntoId: uuid().references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.type, t.normName), index().on(t.mergedIntoId)],
);

// What an entity appears in or relates to: exactly one target per row. A link the user removed stays,
// rejected, so extraction never adds it back.
export const entityLinks = pgTable(
  "entity_links",
  {
    id: id(),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    threadId: uuid().references(() => threads.id, { onDelete: "cascade" }),
    messageId: uuid().references(() => messages.id, { onDelete: "cascade" }),
    senderId: uuid().references(() => senders.id, { onDelete: "cascade" }),
    otherEntityId: uuid().references(() => entities.id, { onDelete: "cascade" }),
    // Entity to entity only, e.g. "works at", "part of".
    relation: text(),
    source: decidedBy().notNull(),
    rejected: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "entity_links_one_target",
      sql`num_nonnulls(${t.threadId}, ${t.messageId}, ${t.senderId}, ${t.otherEntityId}) = 1`,
    ),
    uniqueIndex().on(t.entityId, t.threadId),
    uniqueIndex().on(t.entityId, t.messageId),
    uniqueIndex().on(t.entityId, t.senderId),
    uniqueIndex().on(t.entityId, t.otherEntityId),
    index().on(t.threadId),
    index().on(t.senderId),
  ],
);

// "Same as?", asked when extraction was unsure two entities are one. One question per pair, ever,
// stored ordered (entityId < otherEntityId).
export const entityQuestions = pgTable(
  "entity_questions",
  {
    id: id(),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    otherEntityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // As the model wrote it, in the mail's language.
    question: text().notNull(),
    // Where it came up.
    threadId: uuid().references(() => threads.id, { onDelete: "set null" }),
    status: text().$type<EntityQuestionStatus>().notNull().default("open"),
    answeredAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("entity_questions_ordered", sql`${t.entityId} < ${t.otherEntityId}`),
    uniqueIndex().on(t.entityId, t.otherEntityId),
  ],
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  threads: many(threads),
  senderAccounts: many(senderAccounts),
  jobs: many(jobs),
}));

export const sendersRelations = relations(senders, ({ many }) => ({
  senderAccounts: many(senderAccounts),
  threads: many(threads),
  messages: many(messages),
  corrections: many(corrections),
}));

export const senderAccountsRelations = relations(senderAccounts, ({ one }) => ({
  sender: one(senders, {
    fields: [senderAccounts.senderId],
    references: [senders.id],
  }),
  account: one(accounts, {
    fields: [senderAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  account: one(accounts, {
    fields: [threads.accountId],
    references: [accounts.id],
  }),
  sender: one(senders, { fields: [threads.senderId], references: [senders.id] }),
  messages: many(messages),
  classifications: many(classifications),
  corrections: many(corrections),
  actions: many(actionsLog),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
  account: one(accounts, {
    fields: [messages.accountId],
    references: [accounts.id],
  }),
  sender: one(senders, { fields: [messages.senderId], references: [senders.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id],
  }),
}));

export const classificationsRelations = relations(classifications, ({ one }) => ({
  thread: one(threads, {
    fields: [classifications.threadId],
    references: [threads.id],
  }),
}));

export const correctionsRelations = relations(corrections, ({ one }) => ({
  thread: one(threads, {
    fields: [corrections.threadId],
    references: [threads.id],
  }),
  sender: one(senders, {
    fields: [corrections.senderId],
    references: [senders.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  account: one(accounts, { fields: [jobs.accountId], references: [accounts.id] }),
}));

export const actionsLogRelations = relations(actionsLog, ({ one }) => ({
  thread: one(threads, {
    fields: [actionsLog.threadId],
    references: [threads.id],
  }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  mergedInto: one(entities, { fields: [entities.mergedIntoId], references: [entities.id], relationName: "merged" }),
  links: many(entityLinks, { relationName: "entity" }),
}));

export const entityLinksRelations = relations(entityLinks, ({ one }) => ({
  entity: one(entities, { fields: [entityLinks.entityId], references: [entities.id], relationName: "entity" }),
  thread: one(threads, { fields: [entityLinks.threadId], references: [threads.id] }),
  message: one(messages, { fields: [entityLinks.messageId], references: [messages.id] }),
  sender: one(senders, { fields: [entityLinks.senderId], references: [senders.id] }),
  otherEntity: one(entities, { fields: [entityLinks.otherEntityId], references: [entities.id] }),
}));

export const entityQuestionsRelations = relations(entityQuestions, ({ one }) => ({
  entity: one(entities, { fields: [entityQuestions.entityId], references: [entities.id] }),
  otherEntity: one(entities, { fields: [entityQuestions.otherEntityId], references: [entities.id] }),
  thread: one(threads, { fields: [entityQuestions.threadId], references: [threads.id] }),
}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
export type SenderAccount = typeof senderAccounts.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type Classification = typeof classifications.$inferSelect;
export type NewClassification = typeof classifications.$inferInsert;
export type Correction = typeof corrections.$inferSelect;
export type NewCorrection = typeof corrections.$inferInsert;
export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type ActionLog = typeof actionsLog.$inferSelect;
export type NewActionLog = typeof actionsLog.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntityLink = typeof entityLinks.$inferSelect;
export type NewEntityLink = typeof entityLinks.$inferInsert;
export type EntityQuestion = typeof entityQuestions.$inferSelect;
export type NewEntityQuestion = typeof entityQuestions.$inferInsert;

// Keyboard shortcut overrides, only where they differ from the defaults in
// components/mail/keys/commands.ts. An empty list unbinds the command.
export const keybindings = pgTable("keybindings", {
  commandId: text().primaryKey(),
  keys: text().array().notNull(),
  updatedAt: updatedAt(),
});

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: updatedAt(),
});

export type Keybinding = typeof keybindings.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
