/**
 * Unit 3c (BB-LDN-3c-061026) — DBS Update Service adapter, A1–A21 (LDN2 06-build-drafts/04-test-plan.md §2.1 + brief).
 * `fetch` is injected: no test touches the network.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkDbsStatus, isApiPass, type DbsCheckResult } from "./update-service";
import { getDbsConfig, type DbsConfig } from "./config";

const fixture = (name: string) => readFileSync(resolve(__dirname, "__fixtures__", name), "utf8");

const CONFIG: DbsConfig = {
  baseUrl: "https://dbs.test/crsc",
  organisationName: "BabyBloom London",
  checkerForename: "ALEX",
  checkerSurname: "CHECKER",
  timeoutMs: 1000,
  attempts: 2,
  retryDelayMs: 0,
  retryCooldownMs: 600000,
  referenceEnhancedPath: null,
  referenceStandardPath: null,
};

const INPUT = { certificateNumber: "001234567890", surname: "DOE", dateOfBirth: "1990-03-05" };

function respond(body: string, status = 200, type = "application/xhtml+xml") {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status, headers: { "Content-Type": type } }));
}

const sleep = vi.fn(async () => {});

function call(fetchFn: unknown, input = INPUT, config: Partial<DbsConfig> = {}) {
  return checkDbsStatus(input, { fetch: fetchFn as typeof fetch, config: { ...CONFIG, ...config }, sleep });
}

function urlOf(fetchFn: ReturnType<typeof vi.fn>, n = 0): URL {
  return new URL(String(fetchFn.mock.calls[n][0]));
}

afterEach(() => {
  vi.restoreAllMocks();
  sleep.mockClear();
});

describe("checkDbsStatus — request", () => {
  it("A1 builds URL …/api/status/<ref> with surname, dateOfBirth, hasAgreedTermsAndConditions=true, organisationName, employeeSurname, employeeForename when called with valid input", async () => {
    const f = respond(fixture("blank.xml"));
    await call(f);
    const u = urlOf(f);
    expect(u.origin + u.pathname).toBe("https://dbs.test/crsc/api/status/001234567890");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      dateOfBirth: "05/03/1990",
      surname: "DOE",
      hasAgreedTermsAndConditions: "true",
      organisationName: "BabyBloom London",
      employeeSurname: "CHECKER",
      employeeForename: "ALEX",
    });
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("A2 formats DOB as DD/MM/YYYY with leading zeros when given 1990-03-05", async () => {
    const f = respond(fixture("blank.xml"));
    await call(f);
    expect(urlOf(f).searchParams.get("dateOfBirth")).toBe("05/03/1990");
    expect(String(f.mock.calls[0][0])).toContain("dateOfBirth=05%2F03%2F1990");
  });

  it("A3 sends the number as a 12-character string, keeping a leading zero, when the number starts with 0", async () => {
    const f = respond(fixture("blank.xml"));
    await call(f);
    expect(urlOf(f).pathname.endsWith("/001234567890")).toBe(true);
  });

  it("A4 URL-encodes surnames with spaces, apostrophes and hyphens when surname is O'Brien-Smith", async () => {
    const f = respond(fixture("blank.xml"));
    await call(f, { ...INPUT, surname: "O'Brien-Smith Jr" });
    expect(String(f.mock.calls[0][0])).toContain("surname=O%27Brien-Smith+Jr");
    expect(urlOf(f).searchParams.get("surname")).toBe("O'Brien-Smith Jr");
  });

  it("A5 reads base URL, organisation name and checker names from config when called", async () => {
    vi.stubEnv("DBS_UPDATE_SERVICE_BASE_URL", "https://other.test/x");
    vi.stubEnv("DBS_CHECK_ORGANISATION_NAME", "Org From Env");
    vi.stubEnv("DBS_CHECKER_FORENAME", "SAM");
    vi.stubEnv("DBS_CHECKER_SURNAME", "SMITH");
    const f = respond(fixture("blank.xml"));
    await checkDbsStatus(INPUT, { fetch: f as unknown as typeof fetch, sleep });
    const u = urlOf(f);
    expect(u.origin + u.pathname).toBe("https://other.test/x/api/status/001234567890");
    expect(u.searchParams.get("organisationName")).toBe("Org From Env");
    expect(u.searchParams.get("employeeForename")).toBe("SAM");
    expect(u.searchParams.get("employeeSurname")).toBe("SMITH");
    vi.unstubAllEnvs();
  });

  it("A6 returns ERROR invalid_input without calling fetch when the number is not ^\\d{12}$", async () => {
    for (const bad of ["12345678901", "1234567890123", "12345678901A", " 001234567890"]) {
      const f = respond(fixture("blank.xml"));
      expect(await call(f, { ...INPUT, certificateNumber: bad })).toEqual({ result: "ERROR", reason: "invalid_input" });
      expect(f).not.toHaveBeenCalled();
    }
    const f = respond(fixture("blank.xml"));
    expect(await call(f, { ...INPUT, dateOfBirth: "05/03/1990" })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(await call(f, { ...INPUT, surname: "  " })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(f).not.toHaveBeenCalled();
  });

  it("A20 returns ERROR not_configured without calling fetch when the checker name is unset", async () => {
    for (const missing of [{ checkerForename: null }, { checkerSurname: null }, { organisationName: null }]) {
      const f = respond(fixture("blank.xml"));
      expect(await call(f, INPUT, missing)).toEqual({ result: "ERROR", reason: "not_configured" });
      expect(f).not.toHaveBeenCalled();
    }
  });
});

describe("checkDbsStatus — results", () => {
  it("A7 returns { result: 'BLANK', forename, surname, printDate: '2024-03-14', raw } when body is blank.xml", async () => {
    const body = fixture("blank.xml");
    expect(await call(respond(body))).toEqual({
      result: "BLANK",
      status: "BLANK_NO_NEW_INFO",
      forename: "JANE",
      surname: "DOE",
      printDate: "2024-03-14",
      raw: body,
    });
  });

  it("A8 returns result NON_BLANK when body is non-blank.xml", async () => {
    const r = await call(respond(fixture("non-blank.xml")));
    expect(r).toMatchObject({ result: "NON_BLANK", status: "NON_BLANK_NO_NEW_INFO" });
  });

  it("A9 returns result NEW_INFO when body is new-info.xml", async () => {
    expect(await call(respond(fixture("new-info.xml")))).toMatchObject({ result: "NEW_INFO", status: "NEW_INFO" });
  });

  it("A10 returns result NO_MATCH as a normal result, not an error, when body is no-match.xml", async () => {
    const f = respond(fixture("no-match.xml"));
    const r = await call(f);
    expect(r).toMatchObject({ result: "NO_MATCH", status: "NO_MATCH_FOUND", forename: null, surname: null, printDate: null });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("A11 returns result ERROR (unknown_status) when body is unknown-status.xml", async () => {
    expect(await call(respond(fixture("unknown-status.xml")))).toMatchObject({ result: "ERROR", reason: "unknown_status" });
  });

  it.each([
    ["missing-status.xml", "unknown_status"],
    ["failure-type.xml", "failure_type"],
    ["malformed.xml", "parse"],
    ["html-error.html", "parse"],
    ["empty.txt", "parse"],
  ])("A12 returns result ERROR when body is %s", async (name, reason) => {
    expect(await call(respond(fixture(name)))).toMatchObject({ result: "ERROR", reason });
  });

  it("A12b returns ERROR parse when the body holds two result blocks", async () => {
    const b = fixture("blank.xml");
    expect(await call(respond(b + b))).toMatchObject({ result: "ERROR", reason: "parse" });
  });

  it("A12c returns ERROR parse when an HTML content type carries an otherwise valid body", async () => {
    expect(await call(respond(fixture("blank.xml"), 200, "text/html"))).toMatchObject({ result: "ERROR", reason: "parse" });
  });

  it.each([400, 401, 403, 404, 500])("A13 returns result ERROR when HTTP status is %i", async (code) => {
    expect(await call(respond(fixture("blank.xml"), code))).toMatchObject({ result: "ERROR", reason: `http_${code}` });
  });

  it("A14 returns ERROR timeout when fetch exceeds the configured timeout", async () => {
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const r = await call(f, INPUT, { timeoutMs: 10 });
    expect(r).toEqual({ result: "ERROR", reason: "timeout" });
  });

  it("A15 returns ERROR tls when fetch rejects with a TLS/cipher error", async () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("handshake failure"), { code: "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE" }) });
    const f = vi.fn(async () => { throw err; });
    expect(await call(f)).toEqual({ result: "ERROR", reason: "tls" });
  });

  it("A15b returns ERROR network for any other fetch rejection", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }); });
    expect(await call(f)).toEqual({ result: "ERROR", reason: "network" });
  });

  it("A16 does not follow a redirect to an http:// URL when the server answers 302", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "http://dbs.test/crsc/x" } }));
    expect(await call(f)).toMatchObject({ result: "ERROR", reason: "redirect" });
    for (const c of f.mock.calls as unknown as [string, RequestInit][]) expect(c[1].redirect).toBe("manual");
  });

  it.each(["application/xhtml+xml", "application/xml", "application/xml; charset=utf-8"])(
    "A17 accepts %s content type when body is valid",
    async (type) => {
      expect(await call(respond(fixture("blank.xml"), 200, type))).toMatchObject({ result: "BLANK" });
    },
  );

  it("A18 never logs the certificate number, DOB or surname when an error occurs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    await call(respond("nope", 500), { certificateNumber: "998877665544", surname: "ZEBEDEE", dateOfBirth: "1981-12-25" });
    const said = spies.flatMap((s) => s.mock.calls.flat()).map(String).join(" ");
    expect(said).not.toContain("998877665544");
    expect(said).not.toContain("ZEBEDEE");
    expect(said).not.toContain("1981");
    expect(said).not.toContain("25/12");
  });
});

describe("checkDbsStatus — retry", () => {
  it("A19 retries once on ERROR and returns the second attempt's result", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 500 }))
      .mockResolvedValueOnce(new Response(fixture("blank.xml"), { status: 200, headers: { "Content-Type": "application/xml" } }));
    const r = await call(f, INPUT, { retryDelayMs: 5000 });
    expect(r).toMatchObject({ result: "BLANK" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("A19b returns the last ERROR after both attempts fail", async () => {
    const f = respond("x", 503);
    expect(await call(f)).toMatchObject({ result: "ERROR", reason: "http_503" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("A21 does not retry NO_MATCH", async () => {
    const f = respond(fixture("no-match.xml"));
    await call(f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("A21b does not retry a real result or invalid input", async () => {
    const f = respond(fixture("new-info.xml"));
    await call(f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("checkDbsStatus — edge branches (100 % branch pins)", () => {
  it("A22 returns invalid_input for a non-string number or surname and for an impossible calendar date", async () => {
    const f = respond(fixture("blank.xml"));
    expect(await call(f, { ...INPUT, certificateNumber: 1234567890 as unknown as string })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(await call(f, { ...INPUT, surname: null as unknown as string })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(await call(f, { ...INPUT, dateOfBirth: undefined as unknown as string })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(await call(f, { ...INPUT, dateOfBirth: "1990-02-30" })).toEqual({ result: "ERROR", reason: "invalid_input" });
    expect(f).not.toHaveBeenCalled();
  });

  it("A23 returns ERROR parse when a field appears twice inside the one result block", async () => {
    const body = fixture("blank.xml").replace("<status>BLANK_NO_NEW_INFO</status>", "<status>BLANK_NO_NEW_INFO</status><status>NEW_INFO</status>");
    expect(await call(respond(body))).toMatchObject({ result: "ERROR", reason: "parse" });
  });

  it("A24 returns ERROR parse when the block has no result type, and nulls for absent names", async () => {
    expect(await call(respond("<statusCheckResult><status>BLANK_NO_NEW_INFO</status></statusCheckResult>"))).toMatchObject({ result: "ERROR", reason: "parse" });
    const bare = "<statusCheckResult><statusCheckResultType>SUCCESS</statusCheckResultType><status>BLANK_NO_NEW_INFO</status><forename></forename></statusCheckResult>";
    expect(await call(respond(bare))).toMatchObject({ result: "BLANK", forename: null, surname: null, printDate: null });
  });

  it("A25 returns an ERROR when the body cannot be read, and treats AbortError as timeout", async () => {
    const broken = vi.fn(async () => ({ status: 200, headers: new Headers(), text: async () => { throw new Error("socket hang up"); } }) as unknown as Response);
    expect(await call(broken)).toMatchObject({ result: "ERROR", reason: "network" });
    const aborted = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    expect(await call(aborted)).toEqual({ result: "ERROR", reason: "timeout" });
  });

  it("A26 uses a real delay between attempts when no sleep is injected", async () => {
    const f = respond("x", 500);
    const r = await checkDbsStatus(INPUT, { fetch: f as unknown as typeof fetch, config: { ...CONFIG, retryDelayMs: 1 } });
    expect(r).toMatchObject({ result: "ERROR", reason: "http_500" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("isApiPass + config", () => {
  it("isApiPass is true only for BLANK and NON_BLANK", () => {
    const base = { status: "x", forename: null, surname: null, printDate: null, raw: "" };
    const results: DbsCheckResult[] = [
      { ...base, result: "BLANK", status: "BLANK_NO_NEW_INFO" },
      { ...base, result: "NON_BLANK", status: "NON_BLANK_NO_NEW_INFO" },
      { ...base, result: "NEW_INFO", status: "NEW_INFO" },
      { ...base, result: "NO_MATCH", status: "NO_MATCH_FOUND" },
      { result: "ERROR", reason: "timeout" },
    ];
    expect(results.map(isApiPass)).toEqual([true, true, false, false, false]);
  });

  it("config defaults: live https base URL, 15 s timeout, 2 attempts, 5 s delay, 10 min cooldown, checker and references unset", () => {
    const c = getDbsConfig({ NODE_ENV: "test" });
    expect(c).toEqual({
      baseUrl: "https://secure.crbonline.gov.uk/crsc",
      organisationName: null,
      checkerForename: null,
      checkerSurname: null,
      timeoutMs: 15000,
      attempts: 2,
      retryDelayMs: 5000,
      retryCooldownMs: 600000,
      referenceEnhancedPath: null,
      referenceStandardPath: null,
    });
  });

  it("config throws when the base URL is http in production", () => {
    expect(() => getDbsConfig({ NODE_ENV: "production", DBS_UPDATE_SERVICE_BASE_URL: "http://127.0.0.1:1/crsc" })).toThrow(/https/);
    expect(getDbsConfig({ NODE_ENV: "development", DBS_UPDATE_SERVICE_BASE_URL: "http://127.0.0.1:1/crsc" }).baseUrl).toBe(
      "http://127.0.0.1:1/crsc",
    );
  });

  it("config ignores non-numeric or non-positive numbers and keeps the defaults", () => {
    const c = getDbsConfig({ NODE_ENV: "test", DBS_TIMEOUT_MS: "abc", DBS_ATTEMPTS: "0", DBS_RETRY_DELAY_MS: "-5" });
    expect([c.timeoutMs, c.attempts, c.retryDelayMs]).toEqual([15000, 2, 5000]);
  });

  it("adapter returns ERROR not_configured when the config itself refuses (http base URL in production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DBS_UPDATE_SERVICE_BASE_URL", "http://127.0.0.1:1/crsc");
    const f = respond(fixture("blank.xml"));
    expect(await checkDbsStatus(INPUT, { fetch: f as unknown as typeof fetch, sleep })).toEqual({ result: "ERROR", reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
