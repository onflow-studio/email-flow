import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionsProvider } from "@/components/mail/actions/actions";
import { ComposeButton, ComposeKeys } from "@/components/mail/compose/compose-keys";
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
import { findView, mailHref, VIEWS } from "@/components/mail/views";
import { cn } from "@/lib/utils";

import { accountsOff, accountsOn } from "../../_lib/account-filter";
import { getThread, listAccounts, listThreads, viewCounts } from "../../_lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MailPage({ params }: PageProps<"/[view]/[[...thread]]">) {
  const { view: slug, thread } = await params;

  const view = findView(slug);
  if (!view) notFound();
  if (thread && (thread.length > 1 || !UUID.test(thread[0]))) notFound();
  const threadId = thread?.[0] ?? null;

  const [accounts, off] = await Promise.all([listAccounts(), accountsOff()]);
  const on = accountsOn(accounts, off);
  const isOn = (id: string) => !on || on.includes(id);

  const [counts, threads, detail] = await Promise.all([
    viewCounts(on),
    listThreads(view, on),
    threadId ? getThread(threadId) : null,
  ]);
  if (threadId && !detail) notFound();

  const targets = threads.map((t) => ({
    id: t.id,
    bucket: t.bucket,
    senderId: t.senderId,
    pinned: t.pinned,
    snoozedUntil: t.snoozedUntil,
  }));
  // An open thread may have left the list (e.g. opened from a link); it is still a target.
  if (detail && !targets.some((t) => t.id === detail.id)) {
    targets.push({
      id: detail.id,
      bucket: detail.bucket,
      senderId: detail.senderId,
      pinned: detail.pinned,
      snoozedUntil: detail.snoozedUntil,
    });
  }
  const accountColors = Object.fromEntries(accounts.map((a) => [a.id, a.color]));
  const unseen = threads.filter((t) => t.unseen).length;

  return (
    <SelectionProvider view={view.slug} account={on?.length === 1 ? on[0] : null} threadIds={threads.map((t) => t.id)} openId={threadId}>
      <NavKeys />
      <ComposeKeys />
      <ActionsProvider targets={targets}>
        <AccountTogglesProvider
          accounts={accounts.map((a) => ({ id: a.id, label: a.label, email: a.email, color: a.color, on: isOn(a.id) }))}
        >
        <PaletteProvider>
          <div className="flex h-dvh flex-col bg-bg">
            <Header className={cn(detail && "hidden md:flex")} />
            <div className="flex min-h-0 flex-1">
              <Rail view={view.slug} counts={counts} />
              <PaneHandle pane="rail" label="resize rail" className="hidden rail:block" />

              <FocusPane
                pane="list"
                as="section"
                aria-label={view.label}
                className={cn(
                  "flex min-h-0 w-full flex-col border-r border-border bg-surface md:w-list md:min-w-list-min",
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
                      {counts[v.slug] && v.group !== "bottom" ? <span className="ml-2 text-11 text-text-muted">{counts[v.slug]}</span> : null}
                    </Link>
                  ))}
                </nav>
                <header className="flex h-touch shrink-0 items-center justify-between border-b border-border px-3 md:h-row">
                  <h1 className="font-medium">{view.label}</h1>
                  <span className="flex items-center gap-2">
                    <span className="text-11 text-text-muted">
                      {view.bucket ? `${unseen} unseen` : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
                    </span>
                    <ComposeButton />
                  </span>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ThreadList
                    threads={threads}
                    accountColors={accountColors}
                    emptyLabel={view.bucket ? `${view.label} clear` : view.slug === "trash" ? "trash empty" : `nothing ${view.label}`}
                  />
                </div>
              </FocusPane>
              <PaneHandle pane="list" label="resize thread list" className="hidden md:block" />

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
                  <p className="p-3 text-text-dim">no thread open</p>
                )}
              </FocusPane>
            </div>

            <StatusLine
              accounts={accounts.map((a) => ({
                id: a.id,
                label: a.label,
                color: a.color,
                lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
                lastSyncError: a.lastSyncError,
                catchingUp: a.catchingUp,
                on: isOn(a.id),
              }))}
            />
          </div>
        </PaletteProvider>
        </AccountTogglesProvider>
      </ActionsProvider>
    </SelectionProvider>
  );
}
