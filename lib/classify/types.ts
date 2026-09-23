import type {
  Bucket,
  BucketProbabilities,
  BucketSource,
  MessageHeaders,
  ScreenerDecision,
} from "@/lib/db/schema";

// Buckets the model chooses between. Triage and out come from the screener, never the model.
export const MODEL_BUCKETS = ["inbox", "news", "paper_trail"] as const;
export type ModelBucket = (typeof MODEL_BUCKETS)[number];

export type SenderFacts = {
  email: string;
  domain: string;
  displayName: string | null;
  decision: ScreenerDecision;
  defaultBucket: Bucket | null;
  // Threads from this sender across all accounts, including this one.
  threadCount: number;
  accountCount: number;
  userHasWrittenTo: boolean;
  userStartedThread: boolean;
};

export type ThreadInput = {
  accountEmail: string;
  accountLabel?: string;
  subject: string | null;
  fromName: string | null;
  fromEmail: string;
  text: string;
  headers: MessageHeaders;
  messageCount: number;
};

export type Exemplar = {
  id: string;
  senderEmail: string | null;
  domain: string | null;
  subject: string | null;
  fromBucket: Bucket | null;
  toBucket: Bucket;
  createdAt: Date;
};

export type RuleInput = { id?: string; text: string; structured: unknown; updatedAt?: Date };

export type ClassifyContext = {
  thread: ThreadInput;
  sender: SenderFacts;
  rules: RuleInput[];
  exemplars: Exemplar[];
  // Latest user correction for this exact sender; newer than a rule, it wins over the rule.
  senderCorrectedAt?: Date | null;
};

// Parsed model output, before thresholds.
export type ModelResult = {
  bucket: ModelBucket;
  bucketProbabilities: BucketProbabilities;
  urgency: number;
  humanWritten: number;
  // Null when the sender was known and the question was not asked.
  legitNewSender: number | null;
};

export type Decision = {
  bucket: Bucket;
  source: BucketSource;
  confidence: number;
  suggested: boolean;
  promoted: boolean;
  // allow: unknown sender let in by AI. triage: unknown sender held for a decision.
  screener: "allow" | "triage" | null;
};
