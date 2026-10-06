// T-022 — Resume-step floor math for /nanny/onboarding-verification.
//
// The contributions page at /nanny/onboarding/add-child sends users
// to `/nanny/onboarding-verification?startAt=1` to skip the
// AccountSecured interstitial and land directly on Step 1 (Location).
// But returning users with verification progress shouldn't be
// downgraded by a stale URL — hence the `Math.max(resumeStep, startAt)`
// floor semantics.
//
// Steps are integer-valued 0..4:
//   0 — AccountSecured interstitial
//   1 — Location
//   2 — Identity
//   3 — DBS certificate
//   4 — Processing
//
// Malformed `?startAt=` values (non-numeric, negative, out-of-range,
// non-integer) silently fall back to 0 — no floor applied, resume
// logic dictates the step. This is by design: a hostile URL can't
// jump a user forward past their actual progress.

const MIN_STEP = 0;
const MAX_STEP = 4;

export function parseStartAt(raw: string | undefined): number {
  if (typeof raw !== "string") return MIN_STEP;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return MIN_STEP;
  if (!Number.isInteger(parsed)) return MIN_STEP;
  if (parsed < MIN_STEP || parsed > MAX_STEP) return MIN_STEP;
  return parsed;
}

export function applyStartAtFloor(
  resumeStep: number,
  rawStartAt: string | undefined,
): number {
  return Math.max(resumeStep, parseStartAt(rawStartAt));
}
