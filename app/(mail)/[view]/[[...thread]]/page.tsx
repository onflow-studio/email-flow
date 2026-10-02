import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActionsProvider } from "@/components/mail/actions/actions";
import { ComposeButton, ComposeKeys } from "@/components/mail/compose/compose-keys";
import { DraftList } from "@/components/mail/draft-list";
import { FocusPane } from "@/components/mail/focus-pane";
import { NavKeys } from "@/components/mail/keys/nav-keys";
import { MarkSeen } from "@/components/mail/mark-seen";
import { AccountTogglesProvider } from "@/components/mail/account-toggles";
import { Header } from "@/components/mail/header";
import { PaletteProvider } from "@/components/mail/palette/palette";
import { PaneHandle } from "@/components/mail/pane-handle";
import { Rail } from "@/components/mail/rail";
import { ReadingPane } from "@/components/mail/reading-pane";
import { SelectionProvider } from "@/components/mail/selection";
import { StatusLine } from "@/components/mail/status-line";
import { ThreadList } from "@/components/mail/thread-list";
import { TriageQueue } from "@/components/mail/triage-queue";
import { UnreadDot } from "@/components/mail/unread-dot";
import { findView, mailHref, VIEWS, type ViewSlug } from "@/components/mail/views";
import { accessExpiryFromEnv } from "@/lib/sync/expiry";
import { cn } from "@/lib/utils";

import { accountsOff, accountsOn } from "../../_lib/account-filter";
import { getThread, listAccounts, listDrafts, listThreads, viewCounts } from "../../_lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MailPage({ params }: PageProps<"/[view]/[[...thread]]">) {
  const { view: slug, thread } = await params;

  const view = findView(slug);
  if (!view) notFound();
  if (thread && (thread.length > 1 || !UUID.test(thread[0]) || view.slug === "drafts")) notFound();
  const threadId = thread?.[0] ?? null;

  const [accounts, off] = await Promise.all([listAccounts(), accountsOff()]);
  const on = accountsOn(accounts, off);
  const isOn = (id: string) => !on || on.includes(id);

  const [counts, threads, drafts, detail] = await Promise.all([
    viewCounts(on),
    listThreads(view, on),
    view.slug === "drafts" ? listDrafts(on) : [],
    threadId ? getThread(threadId) : null,
  ]);
  if (threadId && !detail) notFound();
  // A thread opened under a view it no longer belongs to (an old link, a thread snoozed elsewhere) moves to its
  // own view, so the list always holds the open thread. Archived and kept-out threads have no view and stay put.
  // Sent holds any thread written in, whatever its own view.
  const home = detail && !(view.slug === "sent" && detail.wroteIn) ? homeView(detail) : null;
  if (detail && home && home !== view.slug) redirect(mailHref(home, { threadId: detail.id }));
  // The list shows one copy per conversation; open that copy so the row and the pane line up.
  const listed = detail && !threads.some((t) => t.id === detail.id) ? threads.find((t) => detail.copyIds.includes(t.id)) : null;
  if (listed) redirect(mailHref(view.slug, { threadId: listed.id }));

  const targets = threads.map((t) => ({
    id: t.id,
    bucket: t.bucket,
    senderId: t.senderId,
    work: t.work,
    snoozedUntil: t.snoozedUntil,
    needsReply: t.needsReply,
    deadlineAt: t.deadlineAt,
  }));
  // An open thread may have left the list (e.g. opened from a link); it is still a target.
  if (detail && !targets.some((t) => t.id === detail.id)) {
    targets.push({
      id: detail.id,
      bucket: detail.bucket,
      senderId: detail.senderId,
      work: detail.work,
      snoozedUntil: detail.snoozedUntil,
      needsReply: detail.needsReply,
      deadlineAt: detail.deadlineAt,
    });
  }
  const accountColors = Object.fromEntries(accounts.map((a) => [a.id, a.color]));
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, a.label]));
  const unseen = threads.filter((t) => t.unseen).length;

  return (
    <SelectionProvider
      view={view.slug}
      account={on?.length === 1 ? on[0] : null}
      threadIds={threads.map((t) => t.id)}
      clusters={Object.fromEntries(threads.flatMap((t) => (t.cluster ? [[t.id, t.cluster.key]] : [])))}
      openId={threadId}
    >
      <NavKeys />
      <ComposeKeys />
      <ActionsProvider targets={targets}>
        <AccountTogglesProvider
          accounts={accounts.map((a) => ({ id: a.id, label: a.label, email: a.email, color: a.color, on: isOn(a.id) }))}
        >
        <PaletteProvider counts={counts.n}>
          <div className="mail-shell flex h-dvh flex-col bg-bg">
            <Header className={cn(detail && "hidden md:flex")} />
            <div className="flex min-h-0 flex-1">
              <Rail view={view.slug} counts={counts} />
              <PaneHandle pane="rail" label="resize rail" className="hidden rail:block" />

              <FocusPane
                pane="list"
                as="section"
                aria-label={view.label}
                className={cn(
                  "flex min-h-0 w-full flex-col border-r border-border bg-surface",
                  view.slug === "triage" ? "md:w-triage-queue md:shrink-0" : "md:w-list md:min-w-list-min",
                  detail && "hidden md:flex",
                )}
              >
                <nav aria-label="views" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 md:hidden">
                  {VIEWS.map((v) => (
                    <Link
                      key={v.slug}
                      href={mailHref(v.slug)}
                      className={cn(
                        "flex h-touch shrink-0 items-center px-2 whitespace-nowrap",
                        v.slug === view.slug ? "font-medium text-text" : "text-text-muted",
                      )}
                    >
                      {v.label}
                      {counts.n[v.slug] && v.group !== "bottom" ? (
                        <span className="ml-2 flex items-center gap-1 text-11 text-text-muted">
                          {counts.unread[v.slug] ? <UnreadDot /> : null}
                          {counts.n[v.slug]}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </nav>
                {view.slug === "triage" ? (
                  <TriageQueue threads={threads} accountColors={accountColors} />
                ) : (
                  <>
                    <header className="flex h-touch shrink-0 items-center justify-between border-b border-border px-3 md:h-row">
                      <h1 className="font-medium">{view.label}</h1>
                      <span className="flex items-center gap-2">
                        <span className="text-11 text-text-muted">
                          {view.bucket
                            ? `${unseen} unseen`
                            : view.slug === "drafts"
                              ? `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"}`
                              : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
                        </span>
                        <ComposeButton />
                      </span>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {view.slug === "drafts" ? (
                        <DraftList drafts={drafts} accountColors={accountColors} accountNames={accountNames} />
                      ) : (
                        <ThreadList
                          threads={threads}
                          accountColors={accountColors}
                          accountNames={accountNames}
                          emptyLabel={view.bucket || view.slug === "work" ? `${view.label} clear` : view.slug === "trash" ? "trash empty" : `nothing ${view.label}`}
                        />
                      )}
                    </div>
                  </>
                )}
              </FocusPane>
              {view.slug === "triage" ? null : <PaneHandle pane="list" label="resize thread list" className="hidden md:block" />}

              <FocusPane
                pane="reading"
                as="main"
                className={cn("pane-depth min-w-0 flex-1 md:min-w-reading overflow-y-auto", !detail && "hidden md:block")}
              >
                {detail ? (
                  <>
                    <MarkSeen key={`seen-${detail.id}`} threadId={detail.id} />
                    <ReadingPane key={detail.id} thread={detail} />
                  </>
                ) : (
                  <p className="p-3 text-text-dim">
                    {view.slug === "triage"
                      ? threads.length ? "choose a sender to review" : "triage clear. new senders will appear here."
                      : view.slug === "drafts"
                        ? drafts.length ? "pick a draft to keep writing" : "no drafts"
                        : "no thread open"}
                  </p>
                )}
              </FocusPane>
            </div>

            <StatusLine
              accounts={accounts.map((a) => {
                const expiry = accessExpiryFromEnv(a);
                return {
                  id: a.id,
                  email: a.email,
                  label: a.label,
                  color: a.color,
                  lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
                  lastSyncError: a.lastSyncError,
                  accessExpiry: expiry ? { state: expiry.state, expiresAt: expiry.expiresAt.toISOString() } : null,
                  catchingUp: a.catchingUp,
                  on: isOn(a.id),
                };
              })}
            />
          </div>
        </PaletteProvider>
        </AccountTogglesProvider>
      </ActionsProvider>
    </SelectionProvider>
  );
}

function homeView(t: {
  bucket: string;
  trashed: boolean;
  archived: boolean;
  spam: boolean;
  work: boolean;
  snoozedUntil: string | null;
}): ViewSlug | null {
  if (t.trashed) return "trash";
  if (t.archived || t.spam) return null;
  if (t.snoozedUntil && Date.parse(t.snoozedUntil) > Date.now()) return "snoozed";
  if (t.work) return "work";
  // A past-due snooze has resurfaced at the top of Inbox.
  if (t.snoozedUntil) return "inbox";
  return VIEWS.find((v) => v.bucket === t.bucket)?.slug ?? null;
}
