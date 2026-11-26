/**
 * JustCall settings (plan 05 §5 A3, §7): read at call time; a missing or malformed value is reported by its NAME only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUSTCALL_ENV_NAMES, readJustCallConfig } from "./config";

const KEY = "test-key-not-real";
const SECRET = "test-secret-not-real";
const URL_OK = "https://app.example.test/api/webhooks/justcall";

function setAll(overrides: Partial<Record<(typeof JUSTCALL_ENV_NAMES)[number], string | undefined>> = {}) {
  const values = { JUSTCALL_API_KEY: KEY, JUSTCALL_API_SECRET: SECRET, JUSTCALL_WEBHOOK_URL: URL_OK, ...overrides };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value as string);
}

afterEach(() => vi.unstubAllEnvs());

describe("readJustCallConfig", () => {
  it("returns the three values, trimmed", () => {
    setAll({ JUSTCALL_API_KEY: `  ${KEY}\n`, JUSTCALL_WEBHOOK_URL: ` ${URL_OK} ` });
    expect(readJustCallConfig()).toEqual({ ok: true, value: { apiKey: KEY, apiSecret: SECRET, webhookUrl: URL_OK } });
  });

  it.each(JUSTCALL_ENV_NAMES)("reports %s by name when it is unset, and never a value", (name) => {
    setAll({ [name]: undefined });
    const result = readJustCallConfig();
    expect(result).toEqual({ ok: false, missing: [name] });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${KEY}|${SECRET}|example\\.test`));
  });

  it.each(["", "   ", "\n"])("treats a blank value (%j) as missing", (blank) => {
    setAll({ JUSTCALL_API_SECRET: blank });
    expect(readJustCallConfig()).toEqual({ ok: false, missing: ["JUSTCALL_API_SECRET"] });
  });

  it("lists every missing name, in a fixed order", () => {
    setAll({ JUSTCALL_WEBHOOK_URL: undefined, JUSTCALL_API_KEY: "" });
    expect(readJustCallConfig()).toEqual({ ok: false, missing: ["JUSTCALL_API_KEY", "JUSTCALL_WEBHOOK_URL"] });
  });

  it.each([
    ["a plain http URL", "http://app.example.test/api/webhooks/justcall"],
    ["not a URL", "app.example.test/api/webhooks/justcall"],
    ["a relative path", "/api/webhooks/justcall"],
  ])("reports the webhook URL by name when it is %s", (_label, value) => {
    setAll({ JUSTCALL_WEBHOOK_URL: value });
    expect(readJustCallConfig()).toEqual({ ok: false, missing: ["JUSTCALL_WEBHOOK_URL"] });
  });

  it("keeps a query on the webhook URL (the preview's protection bypass, plan D11)", () => {
    setAll({ JUSTCALL_WEBHOOK_URL: `${URL_OK}?x-vercel-protection-bypass=placeholder` });
    const result = readJustCallConfig();
    expect(result.ok && result.value.webhookUrl).toBe(`${URL_OK}?x-vercel-protection-bypass=placeholder`);
  });

  it("is read at call time", () => {
    setAll({ JUSTCALL_API_KEY: undefined });
    expect(readJustCallConfig().ok).toBe(false);
    vi.stubEnv("JUSTCALL_API_KEY", KEY);
    expect(readJustCallConfig().ok).toBe(true);
  });
});
