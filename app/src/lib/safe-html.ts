/**
 * Profile text is stored as a little HTML: paragraphs, line breaks and bold (`<p>`, `<br>`, `<strong>`), plus the
 * inline emphasis tags. `safeHtml` keeps exactly those tags, written bare (no attributes), keeps the text of any other
 * tag, drops script and style blocks and comments, and escapes every other angle bracket. Its output can be rendered
 * as HTML: the only tags left are the ones it writes itself. A pure string function, so it behaves the same on the
 * server and in the browser.
 */

const KEPT_TAGS = new Set(["p", "br", "strong", "b", "em", "i"]);

const BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function keptTag(closing: string, name: string): string {
  const tag = name.toLowerCase();
  if (!KEPT_TAGS.has(tag)) return "";
  if (tag === "br") return "<br>";
  return `<${closing}${tag}>`;
}

export function safeHtml(html: string | null | undefined): string {
  if (!html) return "";
  const text = html.replace(BLOCKS, "").replace(COMMENTS, "");
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    out += escapeText(text.slice(last, at)) + keptTag(m[1], m[2]);
    last = at + m[0].length;
  }
  return out + escapeText(text.slice(last));
}

/** `safeHtml` over every string in stored profile content (objects and arrays copied, other values kept). */
export function safeHtmlDeep<T>(value: T): T {
  if (typeof value === "string") return safeHtml(value) as T;
  if (Array.isArray(value)) return value.map((v) => safeHtmlDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeHtmlDeep(v)])) as T;
  }
  return value;
}
