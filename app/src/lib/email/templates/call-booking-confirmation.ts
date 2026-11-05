/**
 * call_booking_confirmation — her Complimentary matchmaker call is booked (brief §0.3, §9.3; plan B1). Sent by
 * `src/lib/calls/notify.ts` after the booking has committed, for her own booking and for one BAI makes for her.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { bookedLine, CALL_NAME } from "@/lib/calls/copy";
import { slotWords } from "@/lib/calls/slot-words";
import { CALL_PAGE_URL, callEmailShell, oneLine, parentParagraphs, type ParentCallEmailParams } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface CallBookingConfirmationParams extends ParentCallEmailParams {
  readonly startsAt: string;
}

export function buildCallBookingConfirmationEmail(params: CallBookingConfirmationParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  return {
    subject: oneLine(`Your ${CALL_NAME}: ${words.day}, ${words.time}`),
    html: callEmailShell({
      heading: "Your call is booked",
      paragraphs: parentParagraphs(params, [`${bookedLine(words)}.`, "Need a different time? You can change or cancel it until the call starts."]),
      button: { label: "Change or cancel", href: CALL_PAGE_URL },
      audience: "parent",
    }),
  };
}
