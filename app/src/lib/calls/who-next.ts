/**
 * Who's next to call (plan A8; brief §8 contract 5; plan §12 R22) — the order brief 05's "Call next" walks:
 *
 *   1. overdue      a booked call at least `overdue_grace_minutes` past its start, oldest first
 *   2. due now      a booked call that has started, inside the grace
 *   3. next booked  booked calls still to come, soonest first
 *   4. not booked   the to-call list, by when she's due (call-back time or sign-up), oldest first
 *
 * Every row carries `lastAttemptAt` and `callBackAt`, so 05 can skip a family tried in the last two hours or not
 * yet due a call-back. Test users are included and tagged by `contact.isTestUser`.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { callBookingEnabled } from "@/lib/features/flags";
import { CALL_BOOKING_DISABLED, defaultCallsDeps, type CallsDeps } from "./deps";
import type { PrebookRequest } from "./prebook-requests";
import { latestEntryOf, loadToCall, type ToCallFamily } from "./to-call";
import type { CallBooking, CallLogEntry, CallsResult, ParentContact } from "./types";

export type WhoIsNextGroup = "overdue" | "due_now" | "next_booked" | "not_booked";

export interface WhoIsNextRow {
  readonly group: WhoIsNextGroup;
  readonly parentUserId: string;
  readonly contact: ParentContact | null;
  readonly booking: Pick<CallBooking, "id" | "startsAt" | "endsAt" | "purpose" | "positionId"> | null;
  /** Known for not-booked families; null on a booked row. */
  readonly signedUpAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly callBackAt: string | null;
  readonly prebookRequest: PrebookRequest | null;
}

const MINUTE_MS = 60 * 1000;
const RANK: Readonly<Record<WhoIsNextGroup, number>> = Object.freeze({ overdue: 0, due_now: 1, next_booked: 2, not_booked: 3 });

function groupOf(startsAt: string, now: Date, graceMinutes: number): WhoIsNextGroup {
  const start = Date.parse(startsAt);
  if (now.getTime() >= start + graceMinutes * MINUTE_MS) return "overdue";
  return now.getTime() >= start ? "due_now" : "next_booked";
}

function bookedRow(b: CallBooking, contacts: readonly ParentContact[], entries: readonly CallLogEntry[], group: WhoIsNextGroup): WhoIsNextRow {
  const last = latestEntryOf(entries.filter((e) => e.parentUserId === b.parentUserId));
  return {
    group,
    parentUserId: b.parentUserId,
    contact: contacts.find((c) => c.userId === b.parentUserId) ?? null,
    booking: { id: b.id, startsAt: b.startsAt, endsAt: b.endsAt, purpose: b.purpose, positionId: b.positionId },
    signedUpAt: null,
    lastAttemptAt: last?.occurredAt ?? null,
    callBackAt: last?.callBackAt ?? null,
    prebookRequest: null,
  };
}

const notBookedRow = (f: ToCallFamily): WhoIsNextRow => ({
  group: "not_booked",
  parentUserId: f.parentUserId,
  contact: f.contact,
  booking: null,
  signedUpAt: f.signedUpAt,
  lastAttemptAt: f.lastAttemptAt,
  callBackAt: f.callBackAt,
  prebookRequest: f.prebookRequest,
});

async function bookedRows(deps: CallsDeps, graceMinutes: number): Promise<CallsResult<readonly WhoIsNextRow[]>> {
  const booked = await deps.repo.readBookedCalls();
  if (!booked.ok) return booked;
  const ids = [...new Set(booked.value.map((b) => b.parentUserId))];
  const [contacts, entries] = await Promise.all([deps.repo.readContacts(ids), deps.repo.readLogEntriesForParents(ids)]);
  if (!contacts.ok) return contacts;
  if (!entries.ok) return entries;
  const now = deps.now();
  return { ok: true, value: booked.value.map((b) => bookedRow(b, contacts.value, entries.value, groupOf(b.startsAt, now, graceMinutes))) };
}

/** Booked rows by start time within their group; the to-call list keeps its own (due-time) order. */
function inOrder(booked: readonly WhoIsNextRow[], notBooked: readonly WhoIsNextRow[]): readonly WhoIsNextRow[] {
  const sorted = [...booked].sort((a, b) => RANK[a.group] - RANK[b.group] || (a.booking?.startsAt ?? "").localeCompare(b.booking?.startsAt ?? ""));
  return Object.freeze([...sorted, ...notBooked]);
}

export async function getWhoIsNext(deps: CallsDeps = defaultCallsDeps()): Promise<CallsResult<readonly WhoIsNextRow[]>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const settings = await deps.repo.readSettings();
  if (!settings.ok) return settings;
  const [booked, toCall] = await Promise.all([bookedRows(deps, settings.value.overdueGraceMinutes), loadToCall(deps, settings.value.enabledSince)]);
  if (!booked.ok) return booked;
  if (!toCall.ok) return toCall;
  return { ok: true, value: inOrder(booked.value, toCall.value.map(notBookedRow)) };
}
