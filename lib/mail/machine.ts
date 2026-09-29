import type { MessageHeaders } from "@/lib/db/schema";

// Addresses that are machines: notifications, bots, no-reply and transactional senders.
const MACHINE = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|notices?|alerts?|bot|builds?|ci|mailer|updates?|transaction(al)?|orders?|shipping|delivery)([._+-]|@)/i;

/** Machine mail by its headers or address alone, no model needed. */
export function obviousMachine(m: { fromEmail: string; fromName: string | null; headers: MessageHeaders }): boolean {
  const h = m.headers;
  return (
    !!h.listUnsubscribe ||
    /^(bulk|list|junk)$/i.test(h.precedence ?? "") ||
    (!!h.autoSubmitted && !/^no$/i.test(h.autoSubmitted)) ||
    MACHINE.test(m.fromEmail) ||
    /\[bot\]/i.test(m.fromName ?? "")
  );
}
