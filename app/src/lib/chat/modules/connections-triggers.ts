/**
 * Proactive triggers for the connections module.
 *
 * Each trigger is fired from the corresponding server action via
 * `dispatchActionTriggeredInBackground`. The recipient is always the
 * user whose bot should narrate the event (parent for "your request
 * got accepted", nanny for "a family wants to meet you", etc.).
 *
 * Template mode is the default — zero AI cost, instant delivery.
 * Payloads are resolved from the event the server action passes in.
 */

import type { ProactiveTrigger } from "./types";
import { BRAND } from "@/lib/constants";

/**
 * Type-safe payload read — returns the string value only when the
 * incoming payload slot IS a string. Casting `as string` before a
 * `?? fallback` would silently coerce non-string inputs to broken
 * string output (e.g. an object becomes "[object Object]").
 */
function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const connectionsTriggers: ProactiveTrigger[] = [
  {
    id: "connections.request_received",
    description: "A family sent the nanny a new connection request.",
    event: "connection.created",
    mode: "template",
    template:
      "New request from {family_name}. They're in {suburb} and want to meet. You've got 3 days to respond — want me to walk you through accept or decline?",
    resolvePayload: async (event) => ({
      family_name: str(event.payload.family_name, "a family"),
      suburb: str(event.payload.suburb, BRAND.city),
      connection_id: str(event.payload.connection_id, ""),
    }),
  },
  {
    id: "connections.request_accepted",
    description:
      "A nanny accepted the parent's connection request and shared availability.",
    event: "connection.accepted",
    mode: "template",
    template:
      "{nanny_name} accepted! They've shared their availability — pick a time for your meet and greet. You've got 3 days before it expires.",
    resolvePayload: async (event) => ({
      nanny_name: str(event.payload.nanny_name, "The nanny"),
      connection_id: str(event.payload.connection_id, ""),
    }),
  },
  {
    id: "connections.request_declined",
    description:
      "A nanny declined the parent's connection request (neutral framing).",
    event: "connection.declined",
    mode: "template",
    template:
      "{nanny_name} can't take it on — sometimes availability just doesn't line up. Want me to help you find similar candidates?",
    resolvePayload: async (event) => ({
      nanny_name: str(event.payload.nanny_name, "A nanny"),
      connection_id: str(event.payload.connection_id, ""),
    }),
  },
  {
    id: "connections.meet_scheduled",
    description:
      "A meet-and-greet time was booked. Remind both parties of what's next.",
    event: "connection.scheduled",
    mode: "template",
    template:
      "Meet and greet scheduled with {counterparty_name} for {when}. I'll give you a heads-up an hour before.",
    resolvePayload: async (event) => ({
      counterparty_name: str(event.payload.counterparty_name, "them"),
      when: str(event.payload.when, "the booked time"),
      connection_id: str(event.payload.connection_id, ""),
    }),
  },
  {
    id: "connections.placement_confirmed",
    description:
      "A placement was confirmed (Path A parent or Path B nanny). High-stakes — acknowledge warmly.",
    event: "connection.placement_confirmed",
    mode: "template",
    template:
      "That's confirmed — {counterparty_name} is locked in. Hire PDFs are on their way.",
    resolvePayload: async (event) => ({
      counterparty_name: str(event.payload.counterparty_name, "your match"),
      connection_id: str(event.payload.connection_id, ""),
    }),
  },
];
