/**
 * The call page's `next` path (plan B3, §12 R20; brief §3 parent 2): "Go to my matches" goes where she would have
 * gone today — `/parent?t=childcare&s=nannies&v=matches` after the advanced sign-up, `/parent` otherwise.
 *
 * `next` arrives in the URL, so it is checked, never trusted: `isSafeInternalPath` (`invite/redirect.ts:36`) first,
 * then the path is resolved the way a browser would (dot segments, encoded dots, stripped tabs) and kept only if it
 * stays on this site, is `/parent` or below it (`=== "/parent"`, `"/parent/…"`, `"/parent?…"`) and isn't the call
 * page itself (a loop). Anything else → `/parent`.
 *
 * The call page is a funnel slide at `/matchmaking/call` (04b rework W1, brief §0a.1), outside the app.
 *
 * Pure; used by the sign-up redirects (B4) and the call page (B6). BB-wave1-041126/04b-build, 2026-11-04;
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { isSafeInternalPath } from "@/lib/invite/redirect";

export const PARENT_HOME = "/parent";
export const CALL_PAGE_PATH = "/matchmaking/call";

/** Longer than any real target; past this it falls back. */
const MAX_NEXT_LENGTH = 512;
const BASE = new URL("https://next-path.invalid");

const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** A checked `/parent…` path to send her on to, or `/parent`. */
export function safeNextPath(raw: string | readonly string[] | null | undefined): string {
  if (typeof raw !== "string" || raw.length > MAX_NEXT_LENGTH || !isSafeInternalPath(raw)) return PARENT_HOME;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return PARENT_HOME;
  }
  if (url.origin !== BASE.origin) return PARENT_HOME;
  if (!isUnder(url.pathname, PARENT_HOME) || isUnder(url.pathname, CALL_PAGE_PATH)) return PARENT_HOME;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/matchmaking/call?next=<target, encoded>` — the call slide, then on to `next`. */
export function callPagePath(next: string): string {
  return `${CALL_PAGE_PATH}?next=${encodeURIComponent(next)}`;
}
