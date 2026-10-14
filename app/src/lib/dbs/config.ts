/**
 * DBS Update Service configuration — the only place these settings are read (unit 3c).
 *
 * Checker name and the two reference certificates are BAI's to supply (00-RULINGS #16): they have no default, and
 * the adapter refuses to call DBS until the checker name is set (we never send an invented name — the nanny sees it
 * in her Update Service account).
 *
 * Contract
 * - Rulings: #16 (checker name + reference certificates are BAI's; no defaults), #30 (retry cooldown), P-1 (no level-4 path here).
 * - Input: environment variables only (DBS_UPDATE_SERVICE_BASE_URL, DBS_CHECK_ORGANISATION_NAME, DBS_CHECKER_FORENAME,
 *   DBS_CHECKER_SURNAME, DBS_TIMEOUT_MS, DBS_ATTEMPTS, DBS_RETRY_DELAY_MS, DBS_RETRY_COOLDOWN_MS, DBS_REFERENCE_*_PATH).
 * - Output: a plain `DbsConfig`; numbers are clamped so a poll-triggered retry fits the 60 s route budget.
 * - Never: invents a checker name, accepts an http:// base URL in production (throws), or reads env anywhere else.
 *
 * Unit 3i (BB-LDN-3i-141026, brief change 3): `getDbsRecheckConfig` — the daily re-check's throttle. DBS_RECHECK_INTERVAL_MS
 * (pause between nannies, default 1000), DBS_RECHECK_BATCH_LIMIT (nannies per run, default 500), DBS_RECHECK_TIME_BUDGET_MS
 * (no new check starts after this, default and cap 240000 — so the last call (≤ 2 × 20 s + delay) still ends inside the
 * route's 300 s maxDuration). Rulings: #12 (daily re-check), #32 (unchecked nannies simply go first tomorrow).
 * README P-15 (BAI 2026-10-14) safety cut-off: DBS_RECHECK_PAUSE_RATIO (default 0.2 — a run whose NEW_INFO + NO_MATCH
 * share among answered checks is ABOVE it applies none of them) and DBS_RECHECK_PAUSE_MIN_FAILURES (default 3 — the
 * small-number floor). A ratio outside (0, 1) or a non-number falls back to the default.
 * Two phases share the route's 300 s (P-15 code review MEDIUM 1): DBS_RECHECK_TIME_BUDGET_MS (default 180000, cap
 * 240000) stops phase 1 starting new checks; DBS_RECHECK_APPLY_DEADLINE_MS (default 270000, cap 280000) stops phase 2
 * applying held failures — both measured from the start of the run. Failures not reached stay at 40 and go first
 * tomorrow.
 */
export interface DbsConfig {
  baseUrl: string;
  organisationName: string | null;
  checkerForename: string | null;
  checkerSurname: string | null;
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
  /** How long a poll waits before retrying a cross-check left `pending` by an API error (#30). */
  retryCooldownMs: number;
  referenceEnhancedPath: string | null;
  referenceStandardPath: string | null;
}

export const DBS_DEFAULTS = {
  baseUrl: "https://secure.crbonline.gov.uk/crsc",
  timeoutMs: 15_000,
  attempts: 2,
  retryDelayMs: 5_000,
  retryCooldownMs: 600_000,
} as const;

type Env = Record<string, string | undefined>;

/** Trimmed env value, or null when unset/blank (so "unset" and "" mean the same thing). */
function text(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

/**
 * Positive integer from env, capped at `max`; anything else (blank, non-numeric, ≤ 0, fractional) falls back to the
 * default rather than failing — a typo in an ops setting must not stop checks.
 */
function positiveInt(env: Env, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export const DBS_RECHECK_DEFAULTS = {
  intervalMs: 1_000,
  batchLimit: 500,
  timeBudgetMs: 180_000,
  /** Phase 2 (applying held failures) stops at this many ms from the run's start. */
  applyDeadlineMs: 270_000,
  /** P-15: pause when failures / answered checks is above this … */
  pauseRatio: 0.2,
  /** … and there are at least this many failures. */
  pauseMinFailures: 3,
} as const;

/** The re-check throttle (see the header). Separate from `getDbsConfig`: it never touches the base URL rule. */
export interface DbsRecheckConfig {
  intervalMs: number;
  batchLimit: number;
  timeBudgetMs: number;
  applyDeadlineMs: number;
  pauseRatio: number;
  pauseMinFailures: number;
}

/** A ratio strictly between 0 and 1, else the fallback (P-15). */
function ratio(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

/** Caps so a poll-triggered retry always fits the route's 60 s maxDuration. */
const MAX_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

/**
 * Reads the DBS settings. Pass `env` in tests; production reads `process.env`.
 * @throws when an `http://` base URL is configured with NODE_ENV=production (fail closed — callers map this to
 *         `not_configured`, so no request leaves the server).
 */
export function getDbsConfig(env: Env = process.env): DbsConfig {
  const baseUrl = (text(env, "DBS_UPDATE_SERVICE_BASE_URL") ?? DBS_DEFAULTS.baseUrl).replace(/\/+$/, "");
  if (env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
    throw new Error("DBS_UPDATE_SERVICE_BASE_URL must be https in production");
  }
  return {
    baseUrl,
    organisationName: text(env, "DBS_CHECK_ORGANISATION_NAME"),
    checkerForename: text(env, "DBS_CHECKER_FORENAME"),
    checkerSurname: text(env, "DBS_CHECKER_SURNAME"),
    timeoutMs: positiveInt(env, "DBS_TIMEOUT_MS", DBS_DEFAULTS.timeoutMs, MAX_TIMEOUT_MS),
    attempts: positiveInt(env, "DBS_ATTEMPTS", DBS_DEFAULTS.attempts, MAX_ATTEMPTS),
    retryDelayMs: positiveInt(env, "DBS_RETRY_DELAY_MS", DBS_DEFAULTS.retryDelayMs),
    retryCooldownMs: positiveInt(env, "DBS_RETRY_COOLDOWN_MS", DBS_DEFAULTS.retryCooldownMs),
    referenceEnhancedPath: text(env, "DBS_REFERENCE_ENHANCED_PATH"),
    referenceStandardPath: text(env, "DBS_REFERENCE_STANDARD_PATH"),
  };
}

/** Caps for the re-check: a pause over a minute or a batch over 5000 is a typo, not a setting. */
const MAX_RECHECK_INTERVAL_MS = 60_000;
const MAX_RECHECK_BATCH = 5_000;
const MAX_RECHECK_BUDGET_MS = 240_000;
const MAX_APPLY_DEADLINE_MS = 280_000;

/** Reads the daily re-check throttle. Pass `env` in tests; production reads `process.env`. Never throws. */
export function getDbsRecheckConfig(env: Env = process.env): DbsRecheckConfig {
  return {
    intervalMs: positiveInt(env, "DBS_RECHECK_INTERVAL_MS", DBS_RECHECK_DEFAULTS.intervalMs, MAX_RECHECK_INTERVAL_MS),
    batchLimit: positiveInt(env, "DBS_RECHECK_BATCH_LIMIT", DBS_RECHECK_DEFAULTS.batchLimit, MAX_RECHECK_BATCH),
    timeBudgetMs: positiveInt(env, "DBS_RECHECK_TIME_BUDGET_MS", DBS_RECHECK_DEFAULTS.timeBudgetMs, MAX_RECHECK_BUDGET_MS),
    applyDeadlineMs: positiveInt(env, "DBS_RECHECK_APPLY_DEADLINE_MS", DBS_RECHECK_DEFAULTS.applyDeadlineMs, MAX_APPLY_DEADLINE_MS),
    pauseRatio: ratio(env, "DBS_RECHECK_PAUSE_RATIO", DBS_RECHECK_DEFAULTS.pauseRatio),
    pauseMinFailures: positiveInt(env, "DBS_RECHECK_PAUSE_MIN_FAILURES", DBS_RECHECK_DEFAULTS.pauseMinFailures, MAX_RECHECK_BATCH),
  };
}
