/**
 * Error-code sentinels emitted by the connection actions for the client
 * to dispatch on. Lives in its own (non-`'use server'`) module so the
 * const can be imported by both the server action and the client modal
 * — Next.js forbids non-async exports from `'use server'` files, and
 * silently duplicating the literals between server + client invites
 * typo-driven drift.
 *
 * Each entry is a flow-control signal the client surfaces as a dedicated
 * UI branch. Keep this list small + intentional.
 */
export const CONNECTION_ERRORS = {
  POSITION_REQUIRED: "POSITION_REQUIRED",
} as const;

export type ConnectionErrorCode =
  (typeof CONNECTION_ERRORS)[keyof typeof CONNECTION_ERRORS];
