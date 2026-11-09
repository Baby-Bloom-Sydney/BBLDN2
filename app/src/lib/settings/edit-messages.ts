/**
 * The messages every Settings edit page shares (ledger B06 §9.1 R1; BAI's wording, 2026-11-09): Profile, Contact
 * details and Business, and parent Settings when it gets edit mode. Client-safe, no imports.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

export const EDIT_MESSAGES = Object.freeze({
  /** Above the form when Save found fields to fix (each one's message is under it). */
  checkMarked: "Please check the details marked below.",
  /** A record changed since she pressed Edit: nothing of it was written and the page shows the latest. */
  stale: "These details were changed elsewhere. The latest are now showing.",
  /** No answer within the wait, or the request failed. */
  gaveUp: "We couldn't save that. Please try again.",
  /** The in-app confirm when she leaves with unsaved changes. */
  discardTitle: "Discard your changes?",
} as const);
