/**
 * admin_call_reminder — to `ADMIN_EMAIL`, 15 minutes before every booked call (brief §0.7; plan B2). The cron runs
 * every 5 minutes, so it arrives 10–15 minutes before (plan R8). Name, London time and the calls link only (R18).
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { slotWords } from "@/lib/calls/slot-words";
import type { CallAdminEmailParams } from "./call-admin-booked";
import { ADMIN_CALLS_URL, callEmailShell, oneLine } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export function buildCallAdminReminderEmail(params: CallAdminEmailParams): EmailTemplate {
  const words = slotWords(params.startsAt);
  return {
    subject: oneLine(`Matchmaker call soon: ${params.parentName}, ${words.short}`),
    html: callEmailShell({
      heading: "Matchmaker call soon",
      paragraphs: [`${params.parentName} — ${words.full}`],
      button: { label: "Open calls", href: ADMIN_CALLS_URL },
      audience: "admin",
    }),
  };
}
