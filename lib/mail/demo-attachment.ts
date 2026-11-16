import { crc32, deflateSync } from "node:zlib";

import { baseType, previewKind } from "./remote";

// Bytes for the demo database's attachments (`pnpm seed`), which have no Gmail message behind them.
// Generated from the filename, so screenshots show real images, PDFs and text without real mail.

export const DEMO_ATTACHMENT_PREFIX = "seed-att-";

export function isDemoAttachment(gmailAttachmentId: string) {
  return gmailAttachmentId.startsWith(DEMO_ATTACHMENT_PREFIX);
}

export function demoAttachmentBytes(filename: string, mimeType: string): Buffer {
  const kind = previewKind(mimeType);
  if (kind === "image") return demoPng(filename);
  if (kind === "pdf") return demoPdf(filename);
  if (kind === "text") return Buffer.from(demoText(filename, baseType(mimeType)), "utf8");
  return Buffer.alloc(2048);
}

function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A 640x480 landscape of soft bands, its colours picked by the filename. */
function demoPng(filename: string) {
  const width = 640;
  const height = 480;
  const h = hash(filename);
  const sky = [(h & 0x3f) + 20, ((h >> 6) & 0x7f) + 80, ((h >> 13) & 0x7f) + 120];
  const ground = [((h >> 20) & 0x3f) + 10, ((h >> 26) & 0x3f) + 40, ((h >> 3) & 0x3f) + 50];
  const horizon = 0.45 + ((h >> 9) & 0x1f) / 160;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const ridge = horizon + Math.sin(x / 60 + (h & 7)) * 0.05;
      const t = y / height;
      const base = t < ridge ? sky : ground;
      const shade = t < ridge ? 1 - t * 0.6 : 0.6 + (t - ridge) * 0.4;
      for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.min(255, Math.round(base[c] * shade + (t < ridge ? 40 * t : 0)));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A one-page PDF naming the file. */
function demoPdf(filename: string) {
  const title = filename.replace(/[()\\]/g, "");
  const content = `BT /F1 18 Tf 72 720 Td (${title}) Tj 0 -28 Td /F1 12 Tf (Sample document from the demo data.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function demoText(filename: string, type: string) {
  if (type === "text/csv") {
    return ["day,session,room,lead", "mon,kickoff,hall a,Lena Park", "tue,ai module,lab 2,Hugo Lind", "wed,mentoring,room 4,Lena Park", "thu,demo prep,hall a,Alex Rivera", "fri,demo day,auditorium,Lena Park"].join("\n");
  }
  if (type === "application/json") {
    return JSON.stringify({ file: filename, cohort: 14, sessions: 5, rooms: ["hall a", "lab 2", "room 4"], published: false }, null, 2);
  }
  if (type === "text/markdown") {
    return `# ${filename}\n\n- check the ai module dates\n- confirm rooms before friday\n\n<b>never rendered as html</b>\n`;
  }
  return `${filename}\n\nNotes from the demo data. Plain text, shown as it is.\n`;
}
