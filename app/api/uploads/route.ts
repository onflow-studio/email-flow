import { randomUUID } from "node:crypto";

import { eq, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { composeUploads } from "@/lib/db/schema";
import { MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from "@/lib/mail/attach";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

// One part of a file attached in compose, the raw bytes as the body. Part 0 starts the file and
// returns its id; later parts pass `id`. Send joins the parts, see sendCompose.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const part = Number(params.get("part"));
  const filename = (params.get("name") ?? "").trim().slice(0, 255);
  const mimeType = (params.get("type") || "application/octet-stream").slice(0, 255);
  const given = params.get("id");
  if (!Number.isInteger(part) || part < 0 || part >= MAX_UPLOAD_PARTS || !filename) {
    return NextResponse.json({ error: "bad upload" }, { status: 400 });
  }
  if (part === 0 ? given : !given || !UUID.test(given)) {
    return NextResponse.json({ error: "bad upload" }, { status: 400 });
  }

  const data = Buffer.from(await request.arrayBuffer());
  if (data.length > UPLOAD_PART_BYTES) return NextResponse.json({ error: "part too large" }, { status: 413 });

  const id = given ?? randomUUID();
  if (part === 0) {
    // Files attached and never sent: compose closed, the tab gone.
    await db.delete(composeUploads).where(lt(composeUploads.createdAt, new Date(Date.now() - DAY_MS)));
  }
  await db.insert(composeUploads).values({ id, part, filename, mimeType, data });
  return NextResponse.json({ id });
}

// A file removed from compose before sending.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "bad upload" }, { status: 400 });
  await db.delete(composeUploads).where(eq(composeUploads.id, id));
  return NextResponse.json({ ok: true });
}
