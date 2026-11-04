/**
 * call_not_booked — the one "pick a time" email, 30 minutes after sign-up, to a parent who has never had a real
 * booking (brief §0.4, §9.4; plan B2, §12 R2). Sent once per parent: the cron claims a `call_nudges` row first.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { CALL_NAME } from "@/lib/calls/copy";
import { CALL_PAGE_URL, callEmailShell, oneLine, parentParagraphs, type ParentCallEmailParams } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export function buildCallNotBookedEmail(params: ParentCallEmailParams): EmailTemplate {
  return {
    subject: oneLine(`Pick a time for your ${CALL_NAME} — we'll call you either way`),
    html: callEmailShell({
      heading: `Pick a time for your ${CALL_NAME}`,
      paragraphs: parentParagraphs(params, [
        "Choose a time that suits you and we'll call you then.",
        "If you'd rather not pick one, that's fine — we'll call you either way.",
      ]),
      button: { label: "Pick a time", href: CALL_PAGE_URL },
      audience: "parent",
    }),
  };
}
