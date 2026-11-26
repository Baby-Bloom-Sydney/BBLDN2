/**
 * JustCall settings (brief 05 §5 "Env"; plan 05 §5 A3, §7). Server only: none is ever `NEXT_PUBLIC_`.
 *
 * - `JUSTCALL_API_KEY`, `JUSTCALL_API_SECRET`: the API's `Authorization: <key>:<secret>`; the secret also keys the
 *   webhook signature.
 * - `JUSTCALL_WEBHOOK_URL`: the exact URL registered in JustCall, compared with the signed `webhook_url`. On a
 *   preview it carries the protection-bypass query (plan D11); on production it is the plain URL.
 *
 * Read at call time (tests flip them). A missing, blank or malformed value is reported by its **name** only, so a
 * caller can log what to set without ever logging a value.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

export const JUSTCALL_ENV_NAMES = ["JUSTCALL_API_KEY", "JUSTCALL_API_SECRET", "JUSTCALL_WEBHOOK_URL"] as const;
export type JustCallEnvName = (typeof JUSTCALL_ENV_NAMES)[number];

export interface JustCallConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly webhookUrl: string;
}

export type JustCallConfigResult =
  | { readonly ok: true; readonly value: JustCallConfig }
  | { readonly ok: false; readonly missing: readonly JustCallEnvName[] };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function usable(name: JustCallEnvName, value: string): boolean {
  if (value === "") return false;
  return name === "JUSTCALL_WEBHOOK_URL" ? isHttpsUrl(value) : true;
}

const read = (name: JustCallEnvName): string => process.env[name]?.trim() ?? "";

export function readJustCallConfig(): JustCallConfigResult {
  const values: Readonly<Record<JustCallEnvName, string>> = {
    JUSTCALL_API_KEY: read("JUSTCALL_API_KEY"),
    JUSTCALL_API_SECRET: read("JUSTCALL_API_SECRET"),
    JUSTCALL_WEBHOOK_URL: read("JUSTCALL_WEBHOOK_URL"),
  };
  const missing = JUSTCALL_ENV_NAMES.filter((name) => !usable(name, values[name]));
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    value: { apiKey: values.JUSTCALL_API_KEY, apiSecret: values.JUSTCALL_API_SECRET, webhookUrl: values.JUSTCALL_WEBHOOK_URL },
  };
}
