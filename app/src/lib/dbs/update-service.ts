/**
 * DBS Update Service status check — the ONE adapter (unit 3c). A DBS URL, TLS or payload change is a fix here only.
 *
 * GET {base}/api/status/{certificateNumber}?dateOfBirth=DD/MM/YYYY&surname=…&hasAgreedTermsAndConditions=true
 *     &organisationName=…&employeeSurname=…&employeeForename=…
 * → `<statusCheckResult>` with statusCheckResultType, status, forename, surname, printDate.
 *
 * Fail closed: anything that is not a well-formed SUCCESS with one of the four known statuses is `ERROR`, and an
 * `ERROR` is never written as a result (the caller writes nothing to the result columns on it). `NO_MATCH` is a
 * result, not an error. Two attempts (the pipeline's existing pattern); a real result is never retried.
 *
 * Old-TLS note: the DBS host is a 2013 Oracle server; NI-Jam's Python client needed `SECLEVEL=1`. Node's default
 * `fetch` is used until live test T9 says otherwise. If it fails there, swap the transport INSIDE THIS FILE for a
 * `node:https` request with `ciphers: 'DEFAULT:@SECLEVEL=1'` — callers and tests are unaffected (transport injected).
 *
 * Never logs the certificate number, date of birth or surname — only the error reason and the attempt.
 */
import { DBS_API_RESULT, DBS_CERTIFICATE_NUMBER_PATTERN, type DbsApiResult } from "@/lib/verification";
import { getDbsConfig, type DbsConfig } from "./config";

export interface DbsCheckInput {
  certificateNumber: string;
  /** The surname printed on the certificate. */
  surname: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
}

export type DbsResultKind = "BLANK" | "NON_BLANK" | "NEW_INFO" | "NO_MATCH";

export type DbsErrorReason =
  | "invalid_input"
  | "not_configured"
  | "redirect"
  | `http_${number}`
  | "timeout"
  | "tls"
  | "network"
  | "failure_type"
  | "unknown_status"
  | "parse"
  /** Set by a caller when the adapter itself threw (never returned by `checkDbsStatus`). */
  | "exception";

export type DbsCheckResult =
  | {
      result: DbsResultKind;
      /** The raw DBS enum, stored verbatim as the row's Update Service result. */
      status: DbsApiResult;
      forename: string | null;
      surname: string | null;
      printDate: string | null;
      /** The exact response body, stored beside the result. */
      raw: string;
    }
  | { result: "ERROR"; reason: DbsErrorReason; raw?: string };

export interface DbsDeps {
  fetch?: typeof fetch;
  config?: DbsConfig;
  sleep?: (ms: number) => Promise<void>;
}

const KIND_BY_STATUS: Record<DbsApiResult, DbsResultKind> = {
  [DBS_API_RESULT.BLANK]: "BLANK",
  [DBS_API_RESULT.NON_BLANK]: "NON_BLANK",
  [DBS_API_RESULT.NEW_INFO]: "NEW_INFO",
  [DBS_API_RESULT.NO_MATCH]: "NO_MATCH",
};

const NO_RETRY: ReadonlySet<DbsErrorReason> = new Set(["invalid_input", "not_configured"]);

export function isApiPass(r: DbsCheckResult): boolean {
  return r.result === "BLANK" || r.result === "NON_BLANK";
}

/** YYYY-MM-DD → DD/MM/YYYY, or null when it is not a real calendar date. */
function toDbsDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${d}/${mo}/${y}`;
}

function errorReason(err: unknown): DbsErrorReason {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const code = `${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
  if (/SSL|TLS|CERT|EPROTO|handshake|cipher/i.test(code)) return "tls";
  return "network";
}

/** The one `<tag>` value inside the result block; null when absent; "dup" when it appears twice. */
function field(block: string, tag: string): string | null | "dup" {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  const all = [...block.matchAll(re)];
  if (all.length > 1) return "dup";
  return all.length === 1 ? all[0][1].trim() : null;
}

export function parseStatusCheck(body: string): DbsCheckResult {
  const blocks = body.match(/<statusCheckResult(?:\s[^>]*)?>[\s\S]*?<\/statusCheckResult>/g);
  if (!blocks || blocks.length !== 1) return { result: "ERROR", reason: "parse", raw: body };
  const block = blocks[0];
  const fields = ["statusCheckResultType", "status", "forename", "surname", "printDate"].map((t) => field(block, t));
  if (fields.includes("dup")) return { result: "ERROR", reason: "parse", raw: body };
  const [type, status, forename, surname, printDate] = fields as (string | null)[];
  if (type !== "SUCCESS") return { result: "ERROR", reason: type ? "failure_type" : "parse", raw: body };
  if (!status || !(status in KIND_BY_STATUS)) return { result: "ERROR", reason: "unknown_status", raw: body };
  return {
    result: KIND_BY_STATUS[status as DbsApiResult],
    status: status as DbsApiResult,
    forename: forename || null,
    surname: surname || null,
    printDate: printDate || null,
    raw: body,
  };
}

async function attempt(url: string, config: DbsConfig, doFetch: typeof fetch): Promise<DbsCheckResult> {
  let res: Response;
  try {
    res = await doFetch(url, { redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (err) {
    return { result: "ERROR", reason: errorReason(err) };
  }
  if (res.status >= 300 && res.status < 400) return { result: "ERROR", reason: "redirect" };
  if (res.status !== 200) return { result: "ERROR", reason: `http_${res.status}` };
  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return { result: "ERROR", reason: errorReason(err) };
  }
  const type = res.headers.get("content-type");
  if (type && !/xml/i.test(type)) return { result: "ERROR", reason: "parse", raw: body };
  return parseStatusCheck(body);
}

export async function checkDbsStatus(input: DbsCheckInput, deps: DbsDeps = {}): Promise<DbsCheckResult> {
  const number = typeof input.certificateNumber === "string" ? input.certificateNumber : "";
  const surname = typeof input.surname === "string" ? input.surname.trim() : "";
  const dob = typeof input.dateOfBirth === "string" ? toDbsDate(input.dateOfBirth) : null;
  if (!DBS_CERTIFICATE_NUMBER_PATTERN.test(number) || !surname || !dob) return { result: "ERROR", reason: "invalid_input" };

  let config: DbsConfig;
  try {
    config = deps.config ?? getDbsConfig();
  } catch {
    console.error("[dbs] refused: configuration invalid");
    return { result: "ERROR", reason: "not_configured" };
  }
  if (!config.organisationName || !config.checkerForename || !config.checkerSurname) {
    return { result: "ERROR", reason: "not_configured" };
  }

  const params = new URLSearchParams({
    dateOfBirth: dob,
    surname,
    hasAgreedTermsAndConditions: "true",
    organisationName: config.organisationName,
    employeeSurname: config.checkerSurname,
    employeeForename: config.checkerForename,
  });
  const url = `${config.baseUrl}/api/status/${number}?${params.toString()}`;
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last: DbsCheckResult = { result: "ERROR", reason: "network" };
  for (let n = 1; n <= config.attempts; n++) {
    last = await attempt(url, config, doFetch);
    if (last.result !== "ERROR" || NO_RETRY.has(last.reason)) return last;
    console.warn(`[dbs] status check attempt ${n} failed: ${last.reason}`);
    if (n < config.attempts) await sleep(config.retryDelayMs);
  }
  return last;
}
