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
