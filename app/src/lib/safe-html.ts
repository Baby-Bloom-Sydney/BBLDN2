/**
 * Profile text is stored as a little HTML: paragraphs, line breaks and bold (`<p>`, `<br>`, `<strong>`), plus the
 * inline emphasis tags. Those tags are kept, written bare (no attributes); any other tag is dropped and its text kept;
 * script and style blocks and comments go.
 *
 * - `cleanHtml` (on write): only that — every other character stays as typed, including a `<` or `>` that starts no
 *   tag, so screens that show the text as plain text read what was typed.
 * - `safeHtml` (at every raw-HTML render): the same, and every other angle bracket escaped, so the only tags left are
 *   the ones it writes itself.
 * A tag name is read as a browser reads it (a letter, then anything up to a space, "/" or ">"). Every tag, block and
 * comment ends at a ">", so the text after the last ">" is read as plain text: one pass, linear in the length.
 * Pure string functions, so they behave the same on the server and in the browser.
 */

const KEPT_TAGS = new Set(["p", "br", "strong", "b", "em", "i"]);

const BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;
const TAG = /<(\/?)([a-zA-Z][^\s/>]*)[^>]*>/g;

function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function keptTag(closing: string, name: string): string {
  const tag = name.toLowerCase();
  if (!KEPT_TAGS.has(tag)) return "";
  if (tag === "br") return "<br>";
  return `<${closing}${tag}>`;
}

function rebuild(html: string, text: (s: string) => string): string {
  const end = html.lastIndexOf(">") + 1;
  const source = html.slice(0, end).replace(BLOCKS, "").replace(COMMENTS, "");
  let out = "";
  let last = 0;
  for (const m of source.matchAll(TAG)) {
    const at = m.index ?? 0;
    out += text(source.slice(last, at)) + keptTag(m[1], m[2]);
    last = at + m[0].length;
  }
  return out + text(source.slice(last)) + text(html.slice(end));
}

/** At render: the kept tags, bare; everything else as text. A value that isn't text renders as nothing. */
export function safeHtml(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  return rebuild(html, escapeText);
}

/** On write: the kept tags, bare; other tags, blocks and comments removed; every other character as typed. */
export function cleanHtml(html: string): string {
  return rebuild(html, (s) => s);
}

/** `cleanHtml` over every string in stored profile content (objects and arrays copied, other values kept). */
export function cleanHtmlDeep<T>(value: T): T {
  if (typeof value === "string") return cleanHtml(value) as T;
  if (Array.isArray(value)) return value.map((v) => cleanHtmlDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanHtmlDeep(v)])) as T;
  }
  return value;
}
