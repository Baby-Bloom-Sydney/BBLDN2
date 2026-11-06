/**
 * Call settings (plan A5; amendment 19 `call_settings`): the defaults, the bounds BAI's Calendar tab may set (the
 * same as the SQL CHECKs), and the database row → `CallSettings` mapping. Pure.
 *
 * `enabledSince` is not editable here: only "Start call booking" sets it, once (plan §12 R11; `repo.ts`).
 *
 * The call length is a fixed choice (brief §0a.13, BAI 2026-11-06: "the fixed list"): an **update** takes 15, 20, 30, 45
 * or 60 minutes only. The **row** keeps the database's own 5–240 check (amendment 19, unchanged), so a stored value off
 * the list still reads — a read never fails on it.
 *
 * BB-wave1-041126/04a-core, 2026-11-04; BB-wave1-041126/04c2-build, 2026-11-06.
 */

import { z } from "zod";
import { CALL_LENGTH_CHOICES } from "./calendar-limits";
import type { CallSettings, CallsResult } from "./types";
import { instant } from "./zod-parts";

export const CALL_SETTINGS_DEFAULTS: CallSettings = Object.freeze({
  slotMinutes: 30,
  windowDays: 7,
  noticeMinutes: 120,
  holdMinutes: 5,
  parentReminderMinutes: 1440,
  adminReminderMinutes: 15,
  overdueGraceMinutes: 15,
  notBookedDelayMinutes: 30,
  callerNumber: null,
  enabledSince: null,
});

export { CALL_LENGTH_CHOICES };

/** `call_settings_caller_number_check`. */
const CALLER_NUMBER = /^\+44[0-9]{9,10}$/;

const callerNumber = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? "" : value.replace(/\s+/g, "")))
  .refine((value) => value === "" || CALLER_NUMBER.test(value))
  .transform((value) => (value === "" ? null : value));

const BOUNDS = {
  slotMinutes: z.int().min(5).max(240),
  windowDays: z.int().min(1).max(28),
  noticeMinutes: z.int().min(0).max(10080),
  holdMinutes: z.int().min(1).max(60),
  parentReminderMinutes: z.int().min(1),
  adminReminderMinutes: z.int().min(1),
  overdueGraceMinutes: z.int().min(0),
  notBookedDelayMinutes: z.int().min(1),
} as const;

const callLength = BOUNDS.slotMinutes.refine((minutes) => CALL_LENGTH_CHOICES.includes(minutes));

const updateSchema = z.strictObject({
  slotMinutes: callLength.optional(),
  windowDays: BOUNDS.windowDays.optional(),
  noticeMinutes: BOUNDS.noticeMinutes.optional(),
  holdMinutes: BOUNDS.holdMinutes.optional(),
  parentReminderMinutes: BOUNDS.parentReminderMinutes.optional(),
  adminReminderMinutes: BOUNDS.adminReminderMinutes.optional(),
  overdueGraceMinutes: BOUNDS.overdueGraceMinutes.optional(),
  notBookedDelayMinutes: BOUNDS.notBookedDelayMinutes.optional(),
  callerNumber: callerNumber.optional(),
});

export type CallSettingsUpdate = Partial<Omit<CallSettings, "enabledSince">>;

/** A partial settings change from the Calendar tab, checked against the SQL bounds and the fixed call lengths. */
export function parseSettingsUpdate(input: unknown): CallsResult<CallSettingsUpdate, "invalid"> {
  const parsed = updateSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "invalid" };
}

const rowSchema = z.object({
  slot_minutes: BOUNDS.slotMinutes,
  window_days: BOUNDS.windowDays,
  notice_minutes: BOUNDS.noticeMinutes,
  hold_minutes: BOUNDS.holdMinutes,
  parent_reminder_minutes: BOUNDS.parentReminderMinutes,
  admin_reminder_minutes: BOUNDS.adminReminderMinutes,
  overdue_grace_minutes: BOUNDS.overdueGraceMinutes,
  not_booked_delay_minutes: BOUNDS.notBookedDelayMinutes,
  caller_number: z.string().nullable(),
  enabled_since: instant.nullable(),
});

/** The one `call_settings` row as `CallSettings`, or null if it isn't one. */
export function settingsFromRow(row: unknown): CallSettings | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) return null;
  const r = parsed.data;
  return Object.freeze({
    slotMinutes: r.slot_minutes,
    windowDays: r.window_days,
    noticeMinutes: r.notice_minutes,
    holdMinutes: r.hold_minutes,
    parentReminderMinutes: r.parent_reminder_minutes,
    adminReminderMinutes: r.admin_reminder_minutes,
    overdueGraceMinutes: r.overdue_grace_minutes,
    notBookedDelayMinutes: r.not_booked_delay_minutes,
    callerNumber: r.caller_number,
    enabledSince: r.enabled_since,
  });
}
