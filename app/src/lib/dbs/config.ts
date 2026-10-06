/**
 * DBS Update Service configuration — the only place these settings are read (unit 3c).
 *
 * Checker name and the two reference certificates are BAI's to supply (00-RULINGS #16): they have no default, and
 * the adapter refuses to call DBS until the checker name is set (we never send an invented name — the nanny sees it
 * in her Update Service account).
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

function text(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Reads the DBS settings. Throws when an `http://` base URL is configured in production (fail closed). */
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
    timeoutMs: positiveInt(env, "DBS_TIMEOUT_MS", DBS_DEFAULTS.timeoutMs),
    attempts: positiveInt(env, "DBS_ATTEMPTS", DBS_DEFAULTS.attempts),
    retryDelayMs: positiveInt(env, "DBS_RETRY_DELAY_MS", DBS_DEFAULTS.retryDelayMs),
    retryCooldownMs: positiveInt(env, "DBS_RETRY_COOLDOWN_MS", DBS_DEFAULTS.retryCooldownMs),
    referenceEnhancedPath: text(env, "DBS_REFERENCE_ENHANCED_PATH"),
    referenceStandardPath: text(env, "DBS_REFERENCE_STANDARD_PATH"),
  };
}
