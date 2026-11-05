/**
 * call_booking_changed — her Complimentary matchmaker call has moved (brief §3 parent 4, §0.11; plan B1). The same
 * booking, a new time; sent after the move has committed, whether she moved it or BAI did.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { bookedLine, CALL_NAME } from "@/lib/calls/copy";
import { slotWords } from "@/lib/calls/slot-words";
import { CALL_PAGE_URL, callEmailShell, oneLine, parentParagraphs, type ParentCallEmailParams } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface CallBookingChangedParams extends ParentCallEmailParams {
  readonly startsAt: string;
  readonly fromStartsAt: string;
}

export function buildCallBookingChangedEmail(params: CallBookingChangedParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  const from = slotWords(params.fromStartsAt);
  return {
    subject: oneLine(`Your ${CALL_NAME} has moved: ${words.day}, ${words.time}`),
    html: callEmailShell({
      heading: "Your call has moved",
      paragraphs: parentParagraphs(params, [`${bookedLine(words)}.`, `It was ${from.day} at ${from.time}.`]),
      button: { label: "Change or cancel", href: CALL_PAGE_URL },
      audience: "parent",
    }),
  };
}
