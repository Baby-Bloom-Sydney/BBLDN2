"use client";

/**
 * The call picker's state (04b rework W4; brief §3 parent 2–3; plan B6 + review F1, F2, re-review). Pure React state
 * over the owner's actions — the component (`SlotPicker.tsx`) only draws it.
 *
 * - A day, then a time of day, then a time (W14); each a selector she can unselect, which hides the later steps.
 *   Strictly one step per tap, like a form unhiding (W15): nothing opens pre-chosen, not even while she changes her
 *   booking. Tapping a free time holds it at once (the
 *   separate "Choose this time" step is gone, BAI 2026-11-05). Tapping another time holds that one (amendment 19's
 *   `call_hold_slot` replaces her own live hold, so nothing is released first).
 * - A refusal never sticks: throws settle as `error`; a taken time (or a held time that ran out and was taken) opens
 *   the taken notice and the list refreshes under it; ran-out-but-still-free, invalid and failed keep 04b's inline
 *   alert (it takes focus) and refresh as 04b did; a failed confirm always refreshes (a lost reply may have booked).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { useState } from "react";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { SlotDay, SlotOption } from "@/lib/calls/group-slots-by-day";
import type { MyCallRefusal } from "@/lib/calls/parent-view";
import type { BracketKey } from "@/lib/timezone";

/** A held time: what the server holds, and its line ("We're holding … until 10:05."). */
export interface PickerHold {
  readonly holdId: string;
  readonly startsAt: string;
  readonly line: string;
}

/** A refusal is one of the parent-facing codes (TS review): never a free-form string. */
export type PickerResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MyCallRefusal };

export interface SlotPickerActions<T> {
  /** A tap on a free time. */
  hold(startsAt: string): Promise<PickerResult<PickerHold>>;
  /** "Confirm time": the write. */
  confirm(hold: PickerHold): Promise<PickerResult<T>>;
  /**
   * Refresh the list; the owner passes the new `days`. It may also return them, so a held time that ran out can be
   * told apart from one that was taken. A rejection here shows load-failed with Retry.
   */
  reload(): Promise<readonly SlotDay[] | null | void>;
}

const TAKEN = new Set(["taken", "too_soon", "overlap"]);
const RAN_OUT = new Set(["hold_expired", "not_yours", "not_found"]);
/** Refusals that mean the list is stale (review F2). */
const REFRESHES = new Set([...RAN_OUT, "invalid"]);

/** The inline line for a refusal that isn't "taken". */
export function pickerMessage(error: string): string {
  if (TAKEN.has(error)) return PARENT_COPY.taken;
  if (RAN_OUT.has(error)) return PARENT_COPY.holdExpired;
  if (error === "rate_limited") return PARENT_COPY.rateLimited;
  return PARENT_COPY.notSet;
}

/** A throw or a rejection is a refusal like any other (review F1): the picker never sticks busy or loading. */
async function settled<T>(run: () => Promise<PickerResult<T>>): Promise<PickerResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, error: "error" };
  }
}

export function findSlot(days: readonly SlotDay[] | null | undefined, startsAt: string): SlotOption | null {
  for (const day of days ?? []) {
    const slot = day.slots.find((s) => s.startsAt === startsAt);
    if (slot !== undefined) return slot;
  }
  return null;
}

/**
 * The list's own state: loading, and a reload that failed (shown as load-failed with Retry, review F2). Fresh days
 * handed back by the owner go to `onFresh` (the gone times are reconciled with them, react review HIGH 2).
 */
function useListReload(reloadList: () => Promise<readonly SlotDay[] | null | void>, onFresh: (fresh: readonly SlotDay[]) => void) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reload = async (): Promise<readonly SlotDay[] | null | undefined> => {
    setLoading(true);
    try {
      const fresh = await reloadList();
      setFailed(false);
      if (fresh) onFresh(fresh);
      return fresh ?? undefined;
    } catch {
      setFailed(true);
      return undefined;
    } finally {
      setLoading(false);
    }
  };
  return { loading, failed, reload };
}

export interface UsePickerOptions<T> {
  readonly days: readonly SlotDay[] | null;
  readonly actions: SlotPickerActions<T>;
  readonly onConfirmed: (value: T) => void;
  /** Her booked time while she changes it: marked as hers when she reaches it (W15: nothing opens pre-chosen). */
  readonly current?: string | null;
  /** Open with the taken notice (a time she chose elsewhere has just gone), in words. */
  readonly initialNotice?: string | null;
  /** Open with this inline line. */
  readonly initialMessage?: string | null;
  /** No position yet (W11): a tap only selects; nothing is held. */
  readonly gated?: boolean;
}

type Phase = "idle" | "holding" | "confirming";

function usePickerState<T>(o: UsePickerOptions<T>) {
  // Only the days at first, changing included (W15, BAI 2026-11-05: "appear individually like unhiding a form").
  const [day, setDay] = useState<string | null>(null);
  const [bracket, setBracket] = useState<BracketKey | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<PickerHold | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(o.initialMessage ?? null);
  const [notice, setNotice] = useState<string | null>(o.initialNotice ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const markGone = (startsAt: string) => setGone((previous) => new Set([...previous, startsAt]));
  /** A time seen taken that a fresh list says is free again is free again (react review HIGH 2). */
  const reconcileGone = (fresh: readonly SlotDay[]) =>
    setGone((previous) => new Set([...previous].filter((startsAt) => findSlot(fresh, startsAt)?.free !== true)));
  return { day, setDay, bracket, setBracket, selected, setSelected, hold, setHold, gone, markGone, reconcileGone, message, setMessage, notice, setNotice, phase, setPhase };
}

type PickerState = ReturnType<typeof usePickerState>;
type ListReload = ReturnType<typeof useListReload>;

/**
 * A refusal, as she sees it: taken (or a held time that ran out and was taken) → the notice, with the list refreshed
 * once under it; ran out but still free, invalid, failed → 04b's inline line, refreshing as 04b did.
 *
 * `keep` is the hold that still stands (React re-review HIGH 1): after a refused tap on B, her hold on A (the database
 * keeps it when B is refused); after a confirm that failed for any reason but taken or ran out, the very hold she was
 * confirming — so Confirm stays and a retry reuses its id. Taken or ran out clears what was refused.
 */
function useRefusal<T>(s: PickerState, list: ListReload, o: UsePickerOptions<T>) {
  const notice = (startsAt: string) => {
    s.markGone(startsAt);
    s.setMessage(null);
    s.setNotice(findSlot(o.days, startsAt)?.when ?? PARENT_COPY.thatTime);
  };
  const settle = (hold: PickerHold | null) => {
    s.setHold(hold);
    s.setSelected(hold?.startsAt ?? null);
  };
  return async (error: string, startsAt: string, keep: PickerHold | null, reloadAnyway = false) => {
    const survivor = keep !== null && keep.startsAt !== startsAt ? keep : null;
    if (TAKEN.has(error)) {
      settle(survivor);
      notice(startsAt);
      await list.reload();
      return;
    }
    if (RAN_OUT.has(error)) {
      settle(survivor);
      const fresh = await list.reload();
      if (fresh && findSlot(fresh, startsAt)?.free !== true) return notice(startsAt);
      return s.setMessage(pickerMessage(error));
    }
    settle(keep);
    s.setMessage(pickerMessage(error));
    if (reloadAnyway || REFRESHES.has(error)) await list.reload();
  };
}

/** No time chosen (and no hold shown): Confirm is disabled again. */
function clearTime(s: PickerState) {
  s.setSelected(null);
  s.setHold(null);
}

/** Busy in `phase` while `step` runs, whatever it does. */
async function inPhase(s: PickerState, phase: Phase, step: () => Promise<void>) {
  s.setPhase(phase);
  try {
    await step();
  } finally {
    s.setPhase("idle");
  }
}

export function useSlotPicker<T>(o: UsePickerOptions<T>) {
  const s = usePickerState(o);
  const list = useListReload(() => o.actions.reload(), s.reconcileGone);
  const refuse = useRefusal(s, list, o);
  const busy = s.phase !== "idle";
  const tapTime = async (startsAt: string) => {
    if (busy) return;
    // A tile is a selector she can unselect (W14): a second tap clears it in the page; a hold just runs out.
    if (s.selected === startsAt) return clearTime(s);
    const previous = s.hold;
    s.setSelected(startsAt);
    s.setHold(null);
    s.setMessage(null);
    if (o.gated) return; // W11: no position yet — her choice waits for her position; nothing is held.
    await inPhase(s, "holding", async () => {
      const held = await settled(() => o.actions.hold(startsAt));
      if (held.ok) s.setHold(held.value);
      else await refuse(held.error, startsAt, previous);
    });
  };
  const confirm = async () => {
    const hold = s.hold;
    if (hold === null || busy) return;
    await inPhase(s, "confirming", async () => {
      const confirmed = await settled(() => o.actions.confirm(hold));
      if (confirmed.ok) o.onConfirmed(confirmed.value);
      // A confirm that failed may still have been written (a lost reply): the reload shows her booking if so.
      else await refuse(confirmed.error, hold.startsAt, hold, true);
    });
  };
  /** Day, then time of day (W14): a second tap unselects; any change clears and hides the later steps. */
  const pickDay = (londonDate: string) => {
    if (busy) return;
    s.setDay(s.day === londonDate ? null : londonDate);
    s.setBracket(null);
    clearTime(s);
  };
  const pickBracket = (next: BracketKey) => {
    if (busy) return;
    s.setBracket(s.bracket === next ? null : next);
    clearTime(s);
  };
  return { ...s, busy, confirming: s.phase === "confirming", loading: list.loading, reloadFailed: list.failed, reload: list.reload, tapTime, confirm, pickDay, pickBracket, closeNotice: () => s.setNotice(null) };
}

export type SlotPickerState = ReturnType<typeof useSlotPicker>;
