/**
 * The call-reminders cron's work (plan B2 + §12 R2, R3, R11; brief §0.4, §0.7, §9.4, §9.7). Every 5 minutes, three
 * passes, in this order, each on its own (one failing to read doesn't stop the others):
 *
 *   parent      `call_reminder` once now is in [start − 24 h, start), for a call booked — or moved — more than
 *               24 h ahead (`booked_at`, or `moved_at` after a move; the move itself clears both stamps in SQL)
 *   admin       `admin_call_reminder` once now is in [start − 15 min, start), every booked call
 *   not booked  `call_not_booked`, once, to a parent in scope (signed up at or after `enabled_since` — nothing while
 *               it's unset, R11) who signed up 30 min to 7 days ago, is on the to-call list, has never had a real
 *               booking (a hold that never confirmed isn't one, R2), has no answered call, and isn't holding a time
 *               right now (she's picking; the next run tries again)
 *
 * The windows and the delay are the `call_settings` values. A family BAI has taken out (Deposit taken, Not going
 * ahead, …) gets no reminder: both reminder passes go through `bookedCallsToMake`, the one shared rule.
 *
 * **Claim, then send** (R3): the reminder stamp, or the `call_nudges` row, is written first and only the run that
 * wrote it sends; a failed send releases its own claim so the next run tries again. Nothing here throws.
 *
 * Server-only, not `"use server"`. BB-wave1-041126/04b-build, 2026-11-04.
 */

import { sendEmail } from "@/lib/email/resend";
import { buildCallAdminReminderEmail } from "@/lib/email/templates/call-admin-reminder";
import { CALL_EMAIL_TYPES } from "@/lib/email/templates/call-email-parts";
import { buildCallNotBookedEmail } from "@/lib/email/templates/call-not-booked";
import { buildCallReminderEmail } from "@/lib/email/templates/call-reminder";
import { callBookingEnabled } from "@/lib/features/flags";
import { CALL_BOOKING_DISABLED, defaultCallsDeps, type CallsDeps } from "./deps";
import { firstNameOf, mailAdmin, mailParent, parentNameOf, type CallEmailSend } from "./mailer";
import { createReminderRepo, type ReminderKind, type ReminderRepo, type ReminderWindow } from "./repo";
import { everBooked, occupiesSlot } from "./status";
import { bookedCallsToMake, loadFamilyFacts, selectToCall, type FamilyFacts, type ToCallFamily } from "./to-call";
import type { CallBooking, CallSettings, CallsResult, ParentContact } from "./types";

export interface ReminderDeps extends CallsDeps {
  readonly reminders: ReminderRepo;
  readonly send: CallEmailSend;
}

export interface PassCount {
  readonly sent: number;
  readonly failed: number;
  readonly readFailed: boolean;
}

export interface ReminderRun {
  readonly parent: PassCount;
  readonly admin: PassCount;
  readonly notBooked: PassCount;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** A sign-up older than this gets no "pick a time" email (plan B2: "signed up 30 min to 7 days ago"). */
const NOT_BOOKED_LOOKBACK_DAYS = 7;

const NONE: PassCount = Object.freeze({ sent: 0, failed: 0, readFailed: false });
const READ_FAILED: PassCount = Object.freeze({ sent: 0, failed: 0, readFailed: true });

type Outcome = "sent" | "failed" | "skipped";
type SendThunk = () => Promise<boolean>;

export function defaultReminderDeps(): ReminderDeps {
  return { ...defaultCallsDeps(), reminders: createReminderRepo(), send: sendEmail };
}

const tally = (outcomes: readonly Outcome[]): PassCount => ({
  sent: outcomes.filter((o) => o === "sent").length,
  failed: outcomes.filter((o) => o === "failed").length,
  readFailed: false,
});

/** One send at a time, in order. */
async function eachInTurn<T>(items: readonly T[], step: (item: T) => Promise<Outcome>): Promise<readonly Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const item of items) outcomes.push(await step(item));
  return outcomes;
}

/** Claim, send, and release the claim if the send failed. A claim another run holds is skipped. */
async function claimThenSend(claim: () => Promise<CallsResult<boolean>>, send: SendThunk, release: () => Promise<unknown>): Promise<Outcome> {
  const claimedIt = await claim();
  if (!claimedIt.ok) return "failed";
  if (!claimedIt.value) return "skipped";
  if (await send()) return "sent";
  await release();
  return "failed";
}

const windowFrom = (now: Date, minutes: number): ReminderWindow => ({
  after: now.toISOString(),
  until: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
});

/** How far ahead it was booked: from `booked_at`, or from `moved_at` after a move. */
const bookedAheadMs = (b: CallBooking): number => Date.parse(b.startsAt) - Date.parse(b.movedAt ?? b.bookedAt ?? b.createdAt);

const contactOf = (facts: FamilyFacts, parentUserId: string): ParentContact | null =>
  facts.contacts.find((c) => c.userId === parentUserId) ?? null;

/** The reminder for one call, or null when it can't be sent (no contact row for a parent email). */
type ReminderMail = (booking: CallBooking, contact: ParentContact | null) => SendThunk | null;

async function remindPass(kind: ReminderKind, calls: readonly CallBooking[], now: Date, deps: ReminderDeps, mailFor: ReminderMail): Promise<PassCount> {
  if (calls.length === 0) return NONE;
  const toMake = await bookedCallsToMake(calls, deps);
  if (!toMake.ok) return READ_FAILED;
  const stamp = now.toISOString();
  const outcomes = await eachInTurn(toMake.value.calls, async (b): Promise<Outcome> => {
    const send = mailFor(b, contactOf(toMake.value.facts, b.parentUserId));
    if (send === null) return "failed";
    return claimThenSend(
      () => deps.reminders.claimReminder(kind, b, stamp),
      send,
      () => deps.reminders.releaseReminder(kind, b.id, stamp),
    );
  });
  return tally(outcomes);
}

async function parentPass(settings: CallSettings, now: Date, deps: ReminderDeps): Promise<PassCount> {
  const due = await deps.reminders.readUnremindedCalls("parent", windowFrom(now, settings.parentReminderMinutes));
  if (!due.ok) return READ_FAILED;
  const lead = settings.parentReminderMinutes * MINUTE_MS;
  return remindPass("parent", due.value.filter((b) => bookedAheadMs(b) > lead), now, deps, (b, contact) => {
    if (contact === null) {
      console.error("[calls/reminders] parent reminder: no contact", { bookingId: b.id });
      return null;
    }
    const template = buildCallReminderEmail({ firstName: firstNameOf(contact), callerNumber: settings.callerNumber, startsAt: b.startsAt });
    return () => mailParent(deps.send, contact, template, CALL_EMAIL_TYPES.reminder);
  });
}

async function adminPass(settings: CallSettings, now: Date, deps: ReminderDeps): Promise<PassCount> {
  const due = await deps.reminders.readUnremindedCalls("admin", windowFrom(now, settings.adminReminderMinutes));
  if (!due.ok) return READ_FAILED;
  return remindPass("admin", due.value, now, deps, (b, contact) => {
    const parentName = parentNameOf(contact ?? { firstName: "", lastName: "" });
    const template = buildCallAdminReminderEmail({ parentName, startsAt: b.startsAt });
    return () => mailAdmin(deps.send, template, CALL_EMAIL_TYPES.adminReminder);
  });
}

/** R2 and the rest of the not-booked rule, for one family already on the to-call list. */
function isNudgeable(parentUserId: string, facts: FamilyFacts, now: Date): boolean {
  const bookings = facts.bookings.filter((b) => b.parentUserId === parentUserId);
  if (bookings.some(everBooked)) return false;
  if (bookings.some((b) => b.status === "held" && occupiesSlot(b, now))) return false;
  return !facts.entries.some((e) => e.parentUserId === parentUserId && e.result === "answered");
}

/** The families due their "pick a time" email now; null when a read failed. */
async function notBookedDue(settings: CallSettings, now: Date, deps: ReminderDeps): Promise<readonly ToCallFamily[] | null> {
  if (settings.enabledSince === null) return [];
  const latest = new Date(now.getTime() - settings.notBookedDelayMinutes * MINUTE_MS).toISOString();
  const lookback = new Date(now.getTime() - NOT_BOOKED_LOOKBACK_DAYS * DAY_MS).toISOString();
  const earliest = settings.enabledSince > lookback ? settings.enabledSince : lookback;
  if (earliest > latest) return [];
  const scope = await deps.repo.readScopeParents(earliest);
  if (!scope.ok) return null;
  const signedUp = scope.value.filter((p) => p.signedUpAt <= latest);
  if (signedUp.length === 0) return [];
  const facts = await loadFamilyFacts(signedUp.map((p) => p.userId), deps);
  if (!facts.ok) return null;
  return selectToCall(signedUp, facts.value).filter((f) => isNudgeable(f.parentUserId, facts.value, now));
}

function nudge(family: ToCallFamily, settings: CallSettings, stamp: string, deps: ReminderDeps): Promise<Outcome> {
  const contact = family.contact;
  if (contact === null) {
    console.error("[calls/reminders] not-booked email: no contact", { parentUserId: family.parentUserId });
    return Promise.resolve("failed");
  }
  const template = buildCallNotBookedEmail({ firstName: firstNameOf(contact), callerNumber: settings.callerNumber });
  return claimThenSend(
    () => deps.reminders.claimNudge(family.parentUserId, stamp),
    () => mailParent(deps.send, contact, template, CALL_EMAIL_TYPES.notBooked),
    () => deps.reminders.releaseNudge(family.parentUserId, stamp),
  );
}

async function notBookedPass(settings: CallSettings, now: Date, deps: ReminderDeps): Promise<PassCount> {
  const due = await notBookedDue(settings, now, deps);
  if (due === null) return READ_FAILED;
  if (due.length === 0) return NONE;
  const nudged = await deps.reminders.readNudgedParents(due.map((f) => f.parentUserId));
  if (!nudged.ok) return READ_FAILED;
  const stamp = now.toISOString();
  return tally(await eachInTurn(due.filter((f) => !nudged.value.has(f.parentUserId)), (f) => nudge(f, settings, stamp, deps)));
}

/** One cron run: the switch, the settings, then the three passes. */
export async function runCallReminders(deps: ReminderDeps = defaultReminderDeps()): Promise<CallsResult<ReminderRun>> {
  if (!callBookingEnabled()) return CALL_BOOKING_DISABLED;
  const settings = await deps.repo.readSettings();
  if (!settings.ok) return settings;
  const now = deps.now();
  const parent = await parentPass(settings.value, now, deps);
  const admin = await adminPass(settings.value, now, deps);
  const notBooked = await notBookedPass(settings.value, now, deps);
  return { ok: true, value: { parent, admin, notBooked } };
}
