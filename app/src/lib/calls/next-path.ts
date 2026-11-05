/**
 * The call page's `next` path (plan B3, §12 R20; brief §3 parent 2): "Go to my matches" goes where she would have
 * gone today — `/parent?t=childcare&s=nannies&v=matches` after the advanced sign-up, `/parent` otherwise.
 *
 * `next` arrives in the URL, so it is checked, never trusted: `isSafeInternalPath` (`invite/redirect.ts:36`) first,
 * then the path is resolved the way a browser would (dot segments, encoded dots, stripped tabs) and kept only if it
 * stays on this site and is `/parent` or below it (`=== "/parent"`, `"/parent/…"`, `"/parent?…"`) — so never the call
 * page itself, which lives at `/matchmaking/call`. Anything else → `/parent`.
 *
 * The call page is a funnel slide at `/matchmaking/call` (04b rework W1, brief §0a.1), outside the app.
 *
 * Pure; used by the sign-up redirects (B4) and the call page (B6). BB-wave1-041126/04b-build, 2026-11-04;
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { z } from "zod";
import { isSafeInternalPath } from "@/lib/invite/redirect";
import { PARENT_COPY } from "./copy";

export const PARENT_HOME = "/parent";
/** Her matches (where the advanced sign-up went before the call; brief §3 parent 2). */
export const MATCHES_VIEW = "/parent?t=childcare&s=nannies&v=matches";
/** Her Childcare tab (where the quick-match sign-up and the in-app flow go after the call; brief §0a.3, §0a.6). */
export const CHILDCARE_TAB = "/parent?t=childcare";
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
  if (!isUnder(url.pathname, PARENT_HOME)) return PARENT_HOME;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/matchmaking/call?next=<target, encoded>` — the call slide, then on to `next`; `change` opens it changing her time. */
export function callPagePath(next: string, options: { readonly change?: boolean } = {}): string {
  return `${CALL_PAGE_PATH}?${options.change ? "change=1&" : ""}next=${encodeURIComponent(next)}`;
}

export interface Onward {
  readonly href: string;
  readonly label: string;
}

/**
 * The one button onward from the call slide (04b rework W5), labelled by where it goes: her matches → "Go to my
 * matches"; her Childcare tab → "Go to my childcare"; anywhere else → "Go to my dashboard". `next` is already checked.
 */
export function onwardFor(next: string): Onward {
  const params = new URL(next, BASE).searchParams;
  if (params.get("v") === "matches") return { href: next, label: PARENT_COPY.goToMatches };
  if (params.get("t") === "childcare") return { href: next, label: PARENT_COPY.goToChildcare };
  return { href: next, label: PARENT_COPY.goToDashboard };
}

/** What the in-app call popup opens with (04b rework W12): picking, "You're booked", or "that time has just gone". */
export const CALL_POPUP_MODES = ["open", "booked", "gone"] as const;
export type CallPopupMode = (typeof CALL_POPUP_MODES)[number];
const popupMode = z.enum(CALL_POPUP_MODES);

/**
 * `/parent?t=childcare&call=<mode>` — her Childcare tab with the call popup open over it. `at`: the time that went (the
 * taken notice names it); `failed`: a booking that failed for any reason but taken (the picker shows 04b's line).
 */
export function callPopupPath(mode: CallPopupMode, options: { readonly at?: string; readonly failed?: boolean } = {}): string {
  const at = options.at === undefined ? "" : `&at=${encodeURIComponent(options.at)}`;
  return `${CHILDCARE_TAB}&call=${mode}${at}${options.failed ? "&failed=1" : ""}`;
}

/** The hub's `call` param, checked: one of the modes, else null (ignored; a repeated param too). */
export function parseCallPopup(raw: string | readonly string[] | null | undefined): CallPopupMode | null {
  const parsed = popupMode.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Her position form carrying the call time she picked (W11): `/parent/request?callAt=<the slot, encoded>`. */
export function positionWithCallPath(startsAt: string): string {
  return `/parent/request?callAt=${encodeURIComponent(startsAt)}`;
}

const callAtInput = z.iso.datetime({ offset: true });

/** A `callAt` / `at` from a URL, checked: an instant with an offset, else null (ignored). */
export function parseCallAt(raw: string | readonly string[] | null | undefined): string | null {
  return typeof raw === "string" && callAtInput.safeParse(raw).success ? raw : null;
}
