"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { findView } from "@/components/mail/views";
import { listProjects } from "./_lib/queries";

export async function loadNextPage(view: string, pages: number) {
  const known = findView(view, await listProjects());
  if (!known || !Number.isInteger(pages) || pages < 1 || pages >= 100) throw new Error("invalid page");
  (await cookies()).set(`mail-pages-${view.replaceAll("/", "-")}`, String(pages + 1), {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24,
  });
  refresh();
}
