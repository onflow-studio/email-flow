import type { ClassifyContext, ModelResult, SenderFacts } from "./types";

export function sender(overrides: Partial<SenderFacts> = {}): SenderFacts {
  return {
    email: "billing@vercel.com",
    domain: "vercel.com",
    displayName: "Vercel",
    decision: "allowed",
    defaultBucket: null,
    threadCount: 4,
    accountCount: 1,
    userHasWrittenTo: false,
    userStartedThread: false,
    ...overrides,
  };
}

export function result(overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    bucket: "paper_trail",
    bucketProbabilities: { inbox: 0.05, news: 0.05, paper_trail: 0.9 },
    urgency: 1,
    humanWritten: 0.1,
    legitNewSender: null,
    summary: "Invoice for September paid, nothing to do.",
    ...overrides,
  };
}

export function context(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    thread: {
      accountEmail: "me@work1.example",
      subject: "Your invoice for September",
      fromName: "Vercel",
      fromEmail: "billing@vercel.com",
      text: "Thanks for your payment.",
      headers: {},
      messageCount: 1,
    },
    sender: sender(),
    rules: [],
    exemplars: [],
    ...overrides,
  };
}
