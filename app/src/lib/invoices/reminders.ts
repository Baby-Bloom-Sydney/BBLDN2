/**
 * The Friday invoice reminder's run (plan 06 §16.7 b5.5; BAI 2026-11-09, "a cron email to all nanny's that have
 * confirmed hires on a Friday reminding them to create/send an invoice"; the week rule §16.0, BAI 2026-11-23).
 * Server-only, not `"use server"`: the cron route calls it with a cron proof.
 *
 * - **The gates first:** the switch (`invoices_disabled`), then the cron proof (`invalid`); nothing is read before.
 * - **The clock:** it acts only when London's wall clock reads Friday 16:xx (the one clock, `src/lib/timezone.ts`).
 *   The cron fires at 15:00 and 16:00 UTC, so exactly one of the two acts in summer and in winter; any other time is
 *   `{ skipped: "not_time" }`, with nothing read. The week is the London Monday–Sunday holding that Friday.
 * - **Who and what:** `readDueReminders` — each nanny with a running hire and the families she hasn't sent that week's
 *   invoice to. One email each (`invoiceReminderEmail`).
 * - **Claim, then send, then release on failure** (the call reminders' pattern, `src/lib/calls/reminders.ts`): only
 *   the run that wrote her (nanny, week) claim sends, so she gets at most one a week whatever the cron does. A claim
 *   another run holds is `skipped`. A failed send releases this run's own claim and counts as `failed` (no automatic
 *   retry; a hand call with the secret in that Friday's 16:xx hour sends it). No email on file: `failed`, logged by
 *   code, with no claim taken. Nannies one at a time.
 * - A read that failed (or was refused) is `readFailed`: the route answers 500. Logs carry codes and the run's counts
 *   only.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */

import { sendEmail } from "@/lib/email/resend";
import { addLondonDays, londonMondayOf, londonToday, londonWallClockOf } from "@/lib/timezone";
import type { InvoiceCronProof } from "./cron-proof";
import { logFailure } from "./db";
import { INVOICE_REMINDER_EMAIL_TYPE, invoiceReminderEmail } from "./emails/invoice-reminder";
import { cronGate } from "./gate";
import { claimReminder, readDueReminders, releaseReminder, type DueReminder } from "./store-reminders";
import { invoiceOk, type InvoiceResult } from "./types";

/** A run that acted: how many emails went, failed, or were held by another run's claim; and whether a read failed. */
export interface InvoiceReminderCounts {
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
  readonly readFailed: boolean;
}

export type InvoiceReminderRun = InvoiceReminderCounts | { readonly skipped: "not_time" };

/** Friday is the Monday plus four days; the reminder goes in London's 16:00 hour. */
const FRIDAY_AFTER_MONDAY = 4;
const REMINDER_HOUR = 16;
const NOT_TIME: InvoiceReminderRun = Object.freeze({ skipped: "not_time" } as const);
const READ_FAILED: InvoiceReminderCounts = Object.freeze({ sent: 0, failed: 0, skipped: 0, readFailed: true });

type Outcome = "sent" | "failed" | "skipped";

/** The week's Monday when `now` is Friday 16:xx in London; otherwise null. */
function reminderWeekAt(now: Date): string | null {
  const today = londonToday(now);
  const monday = londonMondayOf(today);
  const isFriday = addLondonDays(monday, FRIDAY_AFTER_MONDAY) === today;
  return isFriday && londonWallClockOf(now).hour === REMINDER_HOUR ? monday : null;
}

/** Build and send her email; true when the sender says it went. Never throws (logged by code). */
async function sendTo(to: string, reminder: DueReminder, monday: string): Promise<boolean> {
  try {
    const email = invoiceReminderEmail({ firstName: reminder.firstName, weekStart: monday, families: reminder.families });
    const result = await sendEmail({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      emailType: INVOICE_REMINDER_EMAIL_TYPE,
      recipientUserId: reminder.userId,
    });
    if (!result.success) logFailure("reminders.send", { code: "send_failed" });
    return result.success;
  } catch (thrown) {
    logFailure("reminders.send", thrown);
    return false;
  }
}

/** One nanny: claim her week, send, and release the claim if the send failed. */
async function remind(proof: InvoiceCronProof, reminder: DueReminder, monday: string, stamp: string): Promise<Outcome> {
  if (reminder.email === null) {
    logFailure("reminders.send", { code: "no_email" });
    return "failed";
  }
  const claimed = await claimReminder(proof, reminder.nannyId, monday, stamp);
  if (!claimed.ok) return "failed";
  if (!claimed.value) return "skipped";
  if (await sendTo(reminder.email, reminder, monday)) return "sent";
  await releaseReminder(proof, reminder.nannyId, monday, stamp);
  return "failed";
}

/** One at a time, in order. */
async function eachInTurn<T>(items: readonly T[], step: (item: T) => Promise<Outcome>): Promise<readonly Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const item of items) outcomes.push(await step(item));
  return outcomes;
}

const tally = (outcomes: readonly Outcome[]): InvoiceReminderCounts => ({
  sent: outcomes.filter((o) => o === "sent").length,
  failed: outcomes.filter((o) => o === "failed").length,
  skipped: outcomes.filter((o) => o === "skipped").length,
  readFailed: false,
});

/** One cron run: the gates, the clock, then each nanny's reminder for the week. */
export async function runInvoiceReminders(proof: InvoiceCronProof, now: Date = new Date()): Promise<InvoiceResult<InvoiceReminderRun>> {
  const gate = cronGate(proof);
  if (gate) return gate;
  const monday = reminderWeekAt(now);
  if (monday === null) return invoiceOk(NOT_TIME);
  const due = await readDueReminders(proof, monday);
  const counts = due.ok ? tally(await eachInTurn(due.value, (r) => remind(proof, r, monday, now.toISOString()))) : READ_FAILED;
  console.info("[invoices] reminders run", counts);
  return invoiceOk(counts);
}
