/**
 * Keep deposit codes out of Sentry (03c security review M1; plan 03 §10). The root layout's browser `Sentry.init`
 * would send the page URL — `/deposit/<code>`, and the done page's `?session=cs_…` — in events (`request.url`,
 * `tags.url`, messages, exceptions), transactions (the page load, the server actions' POSTs to the page URL) and
 * breadcrumbs (`data.url`, `data.from`, `data.to`, console messages).
 *
 * - `scrubDepositForSentry`: a copy of what it is given with every string rewritten — `/deposit/<code>` becomes
 *   `/deposit/[code]` (the code is anything up to `/ ? #` or a space) and any `session` query value is dropped.
 *   Plain objects and arrays are walked (depth-capped); anything else is kept as it is. Pure.
 * - `SENTRY_SCRUB_OPTIONS`: the text the root layout puts inside its `Sentry.init({ … })` — `beforeSend`,
 *   `beforeSendTransaction` and `beforeBreadcrumb`, each that same function, from its own source text. So the
 *   function is written and tested once; it must therefore use no import or outer name, and take ONE argument
 *   (Sentry passes a hint second, which it ignores).
 *
 * Server-safe and client-safe; not `"use server"`. BB-wave2-231126/03-build, 2026-11-25.
 */

/** Every string in `value`, scrubbed of deposit codes and session ids. Self-contained: inlined by its source text. */
export function scrubDepositForSentry<T>(value: T): T {
  const CODE_PATH = /\/deposit\/[^/?#\s]+/g;
  const CODE_PATH_ENCODED = /%2Fdeposit%2F[^%/?#&\s]+/gi;
  const SESSION_VALUE = /([?&]session=)[^&#\s]*/g;
  const MAX_DEPTH = 32;
  const text = (s: string): string =>
    s.replace(CODE_PATH, "/deposit/[code]").replace(CODE_PATH_ENCODED, "%2Fdeposit%2F[code]").replace(SESSION_VALUE, "$1");
  // A plain record by its tag, not its prototype, so an object from another realm (a frame) is still walked.
  const isPlain = (v: object): boolean => Object.prototype.toString.call(v) === "[object Object]";
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return text(v);
    if (v === null || typeof v !== "object" || depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    if (!isPlain(v)) return v;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(v)) copy[key] = walk((v as Record<string, unknown>)[key], depth + 1);
    return copy;
  };
  return walk(value, 0) as T;
}

/** Inside the root layout's `Sentry.init({ … })`: the three hooks, each the function above from its source text. */
export const SENTRY_SCRUB_OPTIONS = ["beforeSend", "beforeSendTransaction", "beforeBreadcrumb"]
  .map((hook) => `${hook}: ${scrubDepositForSentry.toString()}`)
  .join(",\n");
