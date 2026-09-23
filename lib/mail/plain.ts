// Plain or lightly formatted mail (people writing to people) renders as native text in the
// reading pane; designed mail (own backgrounds, layout tables, responsive CSS) keeps its framed original.

const NEUTRAL = /^(white|transparent|none|inherit|initial|unset|currentcolor)$/i;

/** White or near white (every channel 235 or more): the page, not a design. */
function isLight(value: string) {
  const v = value.trim().replace(/\s*!important$/i, "").toLowerCase();
  if (NEUTRAL.test(v)) return true;
  let channels: number[] = [];
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    channels = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) channels = rgb.slice(1, 4).map(Number);
  return channels.length === 3 && channels.every((c) => c >= 235);
}

function paintsBackground(html: string) {
  for (const m of html.matchAll(/\bbgcolor\s*=\s*["']?\s*([^"'\s>]+)/gi)) if (!isLight(m[1])) return true;
  for (const m of html.matchAll(/background(?:-color)?\s*:\s*([^;"'}]+)/gi)) if (!isLight(m[1])) return true;
  return /background-image\s*:|\bbackground\s*=\s*["']?\s*[^"'\s>]/i.test(html);
}

/** Layout tables: several of them, nested ones, or one pinned to a newsletter width. */
function hasLayoutTables(html: string) {
  const tables = html.match(/<table\b/gi)?.length ?? 0;
  if (tables > 2) return true;
  return /<table\b[^>]*\bwidth\s*=\s*["']?\s*(?:[5-9]\d\d|\d{4,})\b/i.test(html) || /<table\b[^>]*style\s*=\s*["'](?:[^"']*[;\s])?width\s*:\s*(?:[5-9]\d\d|\d{4,})px/i.test(html);
}

// Where quoted history starts: it carries the earlier mail's design, not this message's.
const QUOTE_START = /class\s*=\s*["'][^"']*gmail_quote|<blockquote\b|class\s*=\s*["'][^"']*(yahoo_quoted|moz-cite-prefix)|<hr\b[^>]*>\s*(?:<[^>]+>\s*)*(?:from|de|von|da|van)\s*:/i;

export function isPlainEmail(fullHtml: string) {
  const cut = fullHtml.search(QUOTE_START);
  const html = cut > 0 ? fullHtml.slice(0, cut) : fullHtml;
  if (/@media\b/i.test(html)) return false;
  if ((html.match(/<img\b/gi)?.length ?? 0) > 3) return false;
  return !paintsBackground(html) && !hasLayoutTables(html);
}
