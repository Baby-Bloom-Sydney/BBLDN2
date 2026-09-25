/**
 * Proactive triggers for the BSR (babysitting) module.
 *
 * Template-mode throughout — babysitting events are time-sensitive,
 * and the nanny already has a visible inbox on the main page; our
 * role is to surface a short narrated nudge in the chat deck so the
 * user doesn't miss it.
 *
 * NEVER include the nanny's phone or parent's address in any
 * template. The main-site UI handles contact reveal at the right
 * stage; chat narration stays high-level.
 *
 * Design note for template copy: earlier versions of these templates
 * used "{family_name} just booked you" + the caller passed
 * family_name: "The", producing "The just booked you". Now the
 * template doesn't prepend/append words around the name — the caller
 * passes the complete phrase to avoid grammar breakage when the
 * real name isn't resolvable. See commit TODO.
 */

import type { ProactiveTrigger } from "./types";
import { BRAND } from "@/lib/constants";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const bsrTriggers: ProactiveTrigger[] = [
  {
    id: "bsr.invitation_received",
    description:
      "A nanny was notified about a new babysitting job matching their profile.",
    event: "bsr.invited",
    mode: "template",
    template:
      "New babysitting invitation — {when} in {suburb}, about {distance}. Worth checking in your inbox before someone else gets it.",
    resolvePayload: async (event) => ({
      when: str(event.payload.when, "soon"),
      suburb: str(event.payload.suburb, BRAND.city),
      distance: str(event.payload.distance, "nearby"),
      bsr_id: str(event.payload.bsr_id, ""),
    }),
  },
  {
    id: "bsr.request_submitted",
    description:
      "A nanny requested a babysitting job; acknowledge it and set expectations.",
    event: "bsr.requested",
    mode: "template",
    template:
      "Request sent. The family will review and let you know. I'll ping you the moment something changes.",
    resolvePayload: async (event) => ({
      bsr_id: str(event.payload.bsr_id, ""),
    }),
  },
  {
    id: "bsr.accepted_by_parent",
    description:
      "A parent booked a nanny from their BSR applicant list. High-positive event — acknowledge the win.",
    event: "bsr.accepted",
    mode: "template",
    // `family_phrase` is the complete subject phrase passed in by the
    // caller — "The Chen family" if we know the name, "A family" as
    // fallback. Avoid hard-wiring "The ..." into the template since
    // callers may pass a generic phrase.
    template:
      "You got it! {family_phrase} just booked you for {when}. Check your inbox — their contact details are there.",
    resolvePayload: async (event) => ({
      family_phrase: str(event.payload.family_phrase, "A family"),
      when: str(event.payload.when, "the booking"),
      bsr_id: str(event.payload.bsr_id, ""),
    }),
  },
  {
    id: "bsr.declined_by_parent",
    description:
      "A parent passed on this nanny (silent on the server; Katie can still let them down softly in chat).",
    event: "bsr.declined_by_parent",
    mode: "template",
    template:
      "{family_phrase} went with another nanny this time. Plenty more coming — your profile is still active for future invitations.",
    resolvePayload: async (event) => ({
      family_phrase: str(event.payload.family_phrase, "That family"),
      bsr_id: str(event.payload.bsr_id, ""),
    }),
  },
];
