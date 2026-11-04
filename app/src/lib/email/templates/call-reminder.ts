/**
 * call_reminder — 24 hours before her Complimentary matchmaker call (brief §0.7; plan B2). Sent by the
 * `call-reminders` cron, only for a call booked (or moved) more than 24 hours ahead.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { bookedLine, CALL_NAME } from "@/lib/calls/copy";
import { slotWords } from "@/lib/calls/slot-words";
import { CALL_PAGE_URL, callEmailShell, oneLine, parentParagraphs, type ParentCallEmailParams } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface CallReminderParams extends ParentCallEmailParams {
  readonly startsAt: string;
}

export function buildCallReminderEmail(params: CallReminderParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  return {
    subject: oneLine(`Reminder: your ${CALL_NAME}, ${words.day}, ${words.time}`),
    html: callEmailShell({
      heading: "A reminder about your call",
      paragraphs: parentParagraphs(params, [`${bookedLine(words)}.`, "If that time no longer suits, you can change or cancel it."]),
      button: { label: "Change or cancel", href: CALL_PAGE_URL },
      audience: "parent",
    }),
  };
}
