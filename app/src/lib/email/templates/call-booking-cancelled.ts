/**
 * call_booking_cancelled — her Complimentary matchmaker call is cancelled (brief §3 parent 4, §0.11; plan B1). She
 * is back under Not booked, so we still call her; the link lets her pick a new time.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { CALL_NAME, LONDON_TIME_SUFFIX } from "@/lib/calls/copy";
import { slotWords } from "@/lib/calls/slot-words";
import { CALL_PAGE_URL, callEmailShell, oneLine, parentParagraphs, type ParentCallEmailParams } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface CallBookingCancelledParams extends ParentCallEmailParams {
  readonly startsAt: string;
}

export function buildCallBookingCancelledEmail(params: CallBookingCancelledParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  return {
    subject: oneLine(`Your ${CALL_NAME} on ${words.day}, ${words.time} is cancelled`),
    html: callEmailShell({
      heading: "Your call is cancelled",
      paragraphs: parentParagraphs(params, [
        `Your ${CALL_NAME} on ${words.day} at ${words.time} ${LONDON_TIME_SUFFIX} is cancelled.`,
        "We'll still call you — or pick a new time whenever it suits you.",
      ]),
      button: { label: "Pick a new time", href: CALL_PAGE_URL },
      audience: "parent",
    }),
  };
}
