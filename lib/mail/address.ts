import type { Address } from "@/lib/db/schema";

// RFC 2047 encoded words, e.g. =?UTF-8?B?...?= or =?ISO-8859-1?Q?...?=.
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                "latin1",
              );
        return new TextDecoder(charset.split("*")[0]).decode(bytes);
      } catch {
        return whole;
      }
    });
}

// Splits on commas (and semicolons, as people type them) outside quotes, angle brackets and comments.
function splitList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && quoted) {
      current += ch + (value[++i] ?? "");
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    else if (!quoted && ch === "(") paren++;
    else if (!quoted && ch === ")") paren = Math.max(0, paren - 1);
    if ((ch === "," || ch === ";") && !quoted && angle === 0 && paren === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function cleanName(name: string): string | null {
  const unquoted = name
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\\(.)/g, "$1")
    .trim();
  return unquoted ? decodeEncodedWords(unquoted) : null;
}

export function parseAddress(raw: string): Address | null {
  const angle = raw.match(/^([\s\S]*)<([^<>]+)>\s*$/);
  if (angle) {
    const email = angle[2].trim().toLowerCase();
    return email.includes("@") ? { name: cleanName(angle[1]), email } : null;
  }
  const comment = raw.match(/^\s*([^\s()]+@[^\s()]+)\s*(?:\((.*)\))?\s*$/);
  if (comment) return { name: comment[2] ? cleanName(comment[2]) : null, email: comment[1].toLowerCase() };
  return null;
}

export function parseAddressList(raw: string | null | undefined): Address[] {
  if (!raw) return [];
  return splitList(raw).flatMap((part) => {
    const address = parseAddress(part);
    return address ? [address] : [];
  });
}

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL.test(email);
}

/** Typed recipients, e.g. `ana@x.com, "Ana B" <ana@y.com>`. Parts that are not addresses come back as `invalid`. */
export function parseRecipients(value: string): { addresses: Address[]; invalid: string[] } {
  const addresses: Address[] = [];
  const invalid: string[] = [];
  for (const part of splitList(value)) {
    const address = parseAddress(part);
    if (address && isValidEmail(address.email)) addresses.push(address);
    else invalid.push(part);
  }
  return { addresses, invalid };
}

export function formatAddressList(list: Address[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
}
