export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

export const MODE_LABELS: Record<ComposeMode, string> = {
  new: "new",
  reply: "reply",
  "reply-all": "reply all",
  forward: "forward",
};

export type ComposeAccount = {
  id: string;
  email: string;
  label: string;
  color: string;
  /** Plain text preview of the account signature. */
  signature: string | null;
};

export type ComposeInit = {
  mode: ComposeMode;
  threadId: string | null;
  accounts: ComposeAccount[];
  /** Fixed to the thread's account for replies and forwards. */
  accountId: string | null;
  to: string;
  cc: string;
  subject: string;
  /** `laura, 25 sep` for the quoted or forwarded message line. */
  quoting: string | null;
  attachments: { id: string; filename: string; size: number }[];
};

export type ComposeSend = {
  mode: ComposeMode;
  threadId: string | null;
  accountId: string | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  attachmentIds: string[];
};

export type SendResult = { ok: true; accountId: string; accountLabel: string } | { ok: false; error: string };
