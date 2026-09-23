import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
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
export const jobType = pgEnum("job_type", ["classify", "writeback", "backfill"]);
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
    // Pinned threads stay at the top of Inbox. Client-only, never written to Gmail.
    pinnedAt: timestamp({ withTimezone: true }),
    archived: boolean().notNull().default(false),
    trashed: boolean().notNull().default(false),
    spam: boolean().notNull().default(false),
    participantsSummary: text(),
    // One-line AI summary, in the mail's own language. Stale when summaryMessageAt < lastMessageAt.
    summary: text(),
    summaryMessageAt: timestamp({ withTimezone: true }),
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
    // 'simple' config: mail is mixed English and Spanish, no stemming either way.
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || from_email || ' ' || coalesce(text, ''))`,
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

// Keyboard shortcut overrides, only where they differ from the defaults in
// components/mail/keys/commands.ts. An empty list unbinds the command.
export const keybindings = pgTable("keybindings", {
  commandId: text().primaryKey(),
  keys: text().array().notNull(),
  updatedAt: updatedAt(),
});

export type Keybinding = typeof keybindings.$inferSelect;
