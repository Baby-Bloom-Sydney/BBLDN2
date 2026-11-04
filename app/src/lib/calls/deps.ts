/**
 * What every call operation runs against. The defaults are the real ones; tests pass their own. Building the
 * defaults touches nothing: the repository creates its client on first use, after the switch has been checked.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { sendCallNotice, type CallNoticeSender } from "./notify";
import { readPendingPrebookRequests, type PrebookRequestSource } from "./prebook-requests";
import { createCallsRepo, type CallsRepo } from "./repo";

export interface CallsDeps {
  readonly repo: CallsRepo;
  readonly now: () => Date;
  readonly notify: CallNoticeSender;
  readonly prebookRequests: PrebookRequestSource;
}

export function defaultCallsDeps(): CallsDeps {
  return {
    repo: createCallsRepo(),
    now: () => new Date(),
    notify: sendCallNotice,
    prebookRequests: readPendingPrebookRequests,
  };
}

export const CALL_BOOKING_DISABLED = Object.freeze({ ok: false, error: "call_booking_disabled" } as const);
