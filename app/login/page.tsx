import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { authDisabled, readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

import { safeNext } from "../api/auth/login/state";

export const metadata: Metadata = { title: "superfer / login" };

function signedIn(token: string | undefined): boolean {
  try {
    return readSessionToken(token) !== null;
  } catch {
    return false;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(params.next));
  const error = one(params.error);

  if (authDisabled() || signedIn((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);

  const start = `/api/auth/login/start?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <main className="flex min-h-0 flex-1 justify-center px-2 pt-palette-top md:px-4">
        <div className="flex h-fit w-full max-w-palette flex-col gap-4 rounded-md border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-13 font-medium">
            <span className="text-accent">&gt;_</span>
            <span className="text-text">superfer</span>
          </p>
          <p className="text-13 leading-prose text-text-muted">single user. sign in with an allowed google account.</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={start} className={buttonVariants({ variant: "primary" })}>
              sign in with google
            </a>
            {error ? (
              <p role="alert" className="text-12 text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </main>
      <footer className="status-rule box-content flex h-status shrink-0 items-center justify-between gap-3 bg-status px-3 pb-safe text-11 text-text-muted">
        <span>signed out</span>
        <span className="shrink-0">login</span>
      </footer>
    </div>
  );
}
