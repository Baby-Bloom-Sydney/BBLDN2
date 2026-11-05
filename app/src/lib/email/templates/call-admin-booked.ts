/**
 * admin_call_booked — to `ADMIN_EMAIL`, when a parent books her own call (or brief 03's flow books it for her);
 * never for BAI's own on-behalf bookings (plan B1). Admin wording: "matchmaker call".
 *
 * Only the parent's name, the London time and an `/admin/calls` link (plan §12 R18): `email_logs` stores the full
 * HTML, so no phone number or email address goes in.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { slotWords } from "@/lib/calls/slot-words";
import { ADMIN_CALLS_URL, callEmailShell, oneLine } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export interface CallAdminEmailParams {
  readonly parentName: string;
  readonly startsAt: string;
}

export function buildCallAdminBookedEmail(params: CallAdminEmailParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  return {
    subject: oneLine(`New matchmaker call booked: ${params.parentName}, ${words.short}`),
    html: callEmailShell({
      heading: "New matchmaker call booked",
      paragraphs: [`${params.parentName} — ${words.full}`],
      button: { label: "Open calls", href: ADMIN_CALLS_URL },
      audience: "admin",
    }),
  };
}
