"use client";

/**
 * The call picker's state (04b rework W4; brief §3 parent 2–3; plan B6 + review F1, F2, re-review). Pure React state
 * over the owner's actions — the component (`SlotPicker.tsx`) only draws it.
 *
 * - A cell (a day × time of day) is chosen first; then a time in it. Tapping a free time holds it at once (the
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
import type { BracketKey } from "@/lib/timezone";

/** A held time: what the server holds, and its line ("We're holding … until 10:05."). */
export interface PickerHold {
  readonly holdId: string;
  readonly startsAt: string;
  readonly line: string;
}

export type PickerResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

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

export interface PickerCell {
  readonly londonDate: string;
  readonly bracket: BracketKey;
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

/** The cell a time sits in. */
export function cellOf(days: readonly SlotDay[] | null, startsAt: string | null | undefined): PickerCell | null {
  if (!startsAt) return null;
  const day = (days ?? []).find((d) => d.slots.some((s) => s.startsAt === startsAt));
  const slot = day?.slots.find((s) => s.startsAt === startsAt);
  return day && slot ? { londonDate: day.londonDate, bracket: slot.bracket } : null;
}

/** The list's own state: loading, and a reload that failed (shown as load-failed with Retry, review F2). */
function useListReload(reloadList: () => Promise<readonly SlotDay[] | null | void>) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reload = async (): Promise<readonly SlotDay[] | null | undefined> => {
    setLoading(true);
    try {
      const fresh = await reloadList();
      setFailed(false);
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
  /** Her booked time while she changes it: its cell opens first, and it shows chosen until she picks another. */
  readonly current?: string | null;
  /** Open with the taken notice (a time she chose elsewhere has just gone), in words. */
  readonly initialNotice?: string | null;
  /** No position yet (W11): a tap only selects; nothing is held. */
  readonly gated?: boolean;
}

type Phase = "idle" | "holding" | "confirming";

function usePickerState<T>(o: UsePickerOptions<T>) {
  const [cell, setCell] = useState<PickerCell | null>(() => cellOf(o.days, o.current));
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<PickerHold | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(o.initialNotice ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const markGone = (startsAt: string) => setGone((previous) => new Set([...previous, startsAt]));
  return { cell, setCell, selected, setSelected, hold, setHold, gone, markGone, message, setMessage, notice, setNotice, phase, setPhase };
}

export function useSlotPicker<T>(o: UsePickerOptions<T>) {
  const s = usePickerState(o);
  const list = useListReload(() => o.actions.reload());
  const busy = s.phase !== "idle";

  const takenNotice = async (startsAt: string) => {
    s.markGone(startsAt);
    s.setMessage(null);
    s.setNotice(findSlot(o.days, startsAt)?.when ?? "");
    await list.reload();
  };
  const refuse = async (error: string, startsAt: string, reloadAnyway = false) => {
    s.setHold(null);
    s.setSelected(null);
    if (TAKEN.has(error)) return takenNotice(startsAt);
    if (RAN_OUT.has(error)) {
      const fresh = await list.reload();
      const stillFree = fresh === undefined || fresh === null || findSlot(fresh, startsAt)?.free === true;
      if (!stillFree) return takenNotice(startsAt);
      return s.setMessage(pickerMessage(error));
    }
    s.setMessage(pickerMessage(error));
    if (reloadAnyway || REFRESHES.has(error)) await list.reload();
  };
  const during = async (phase: Phase, step: () => Promise<void>) => {
    s.setPhase(phase);
    try {
      await step();
    } finally {
      s.setPhase("idle");
    }
  };
  const tapTime = async (startsAt: string) => {
    if (busy || s.hold?.startsAt === startsAt) return;
    s.setSelected(startsAt);
    s.setHold(null);
    s.setMessage(null);
    if (o.gated) return; // W11: no position yet — her choice waits for her position; nothing is held.
    await during("holding", async () => {
      const held = await settled(() => o.actions.hold(startsAt));
      if (held.ok) s.setHold(held.value);
      else await refuse(held.error, startsAt);
    });
  };
  const confirm = async () => {
    const hold = s.hold;
    if (hold === null || busy) return;
    await during("confirming", async () => {
      const confirmed = await settled(() => o.actions.confirm(hold));
      if (confirmed.ok) o.onConfirmed(confirmed.value);
      // A confirm that failed may still have been written (a lost reply): the reload shows her booking if so.
      else await refuse(confirmed.error, hold.startsAt, true);
    });
  };
  const pickCell = (next: PickerCell) => {
    const same = s.cell?.londonDate === next.londonDate && s.cell.bracket === next.bracket;
    s.setCell(same ? null : next);
    s.setSelected(null);
    s.setHold(null);
  };
  return {
    ...s,
    busy,
    confirming: s.phase === "confirming",
    loading: list.loading,
    reloadFailed: list.failed,
    reload: list.reload,
    tapTime,
    confirm,
    pickCell,
    closeNotice: () => s.setNotice(null),
  };
}

export type SlotPickerState = ReturnType<typeof useSlotPicker>;
