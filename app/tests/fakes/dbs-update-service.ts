/**
 * Fake DBS Update Service (unit 3c, BB-LDN-3c-061026) — `node:http`, one route `GET /crsc/api/status/:ref`.
 *
 * Mirrors BenjaminEHowe/fake-dbs-update-service: the FIRST DIGIT of the 12-digit number picks the result
 * (LDN2 06-build-drafts/04-test-plan.md §1.2). Digits 1–4 and 9 are upstream's; 5–8 are ours and test-only
 * (00-RULINGS #29). Invented names only (JANE DOE). It records every request so tests assert what we sent.
 *
 * Walk use (local only, never deployed): `node tests/fakes/dbs-update-service.ts [port]` starts it on
 * 127.0.0.1; `POST /__override?digit=2` forces every answer to that digit's result (`digit=` clears it), so a
 * `9…` certificate can be switched to a pass after the cooldown.
 *
 * Unit 3i (BB-LDN-3i-141026, brief change 9): a per-number override so an approved `2…` nanny can be made to fail a
 * re-check without rewriting her row — `PUT /__override/:ref?status=NEW_INFO` (BLANK · NON_BLANK · NEW_INFO ·
 * NO_MATCH · ERROR = HTTP 500) and `DELETE /__override` (clears every per-number and digit override). A per-number
 * override wins over the digit override. Test-only: this file lives under `tests/` and is never bundled into `src/`.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeDbsRequest {
  path: string;
  query: Record<string, string>;
}

export interface FakeDbsServer {
  /** Base URL to put in DBS_UPDATE_SERVICE_BASE_URL, e.g. http://127.0.0.1:5123/crsc */
  baseUrl: string;
  requests: FakeDbsRequest[];
  setOverrideDigit: (digit: string | null) => void;
  /** Per-number override (3i): the status this certificate number answers with, or null to clear it. */
  setRefOverride: (ref: string, status: FakeDbsStatus | null) => void;
  close: () => Promise<void>;
}

const XML_TYPE = "application/xhtml+xml";

/** The per-number override statuses (3i) and the digit each one answers as. ERROR → the default branch (HTTP 500). */
export const FAKE_DBS_STATUS_DIGIT = { BLANK: "2", NON_BLANK: "3", NEW_INFO: "4", NO_MATCH: "1", ERROR: "0" } as const;
export type FakeDbsStatus = keyof typeof FAKE_DBS_STATUS_DIGIT;

function isFakeStatus(s: string | null): s is FakeDbsStatus {
  return s != null && Object.hasOwn(FAKE_DBS_STATUS_DIGIT, s);
}

function successXml(status: string, withPerson = true): string {
  const person = withPerson
    ? '<forename>JANE</forename><surname>DOE</surname><printDate class="sql-date">2024-03-14</printDate>'
    : "";
  return `<statusCheckResult><statusCheckResultType>SUCCESS</statusCheckResultType><status>${status}</status>${person}</statusCheckResult>`;
}

const REQUIRED = ["dateOfBirth", "surname", "hasAgreedTermsAndConditions", "organisationName", "employeeSurname", "employeeForename"];

function validationError(ref: string, q: Record<string, string>): string | null {
  if (!/^\d{12}$/.test(ref)) return "Certificate number must be 12 digits";
  for (const k of REQUIRED) if (!q[k]) return `Missing parameter ${k}`;
  if (q.hasAgreedTermsAndConditions !== "true") return "Terms and conditions must be agreed";
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(q.dateOfBirth)) return "dateOfBirth must be DD/MM/YYYY";
  return null;
}

export function startFakeDbsUpdateService(opts: { port?: number; holdMs?: number } = {}): Promise<FakeDbsServer> {
  const requests: FakeDbsRequest[] = [];
  let override: string | null = null;
  const refOverrides = new Map<string, string>();
  const holdMs = opts.holdMs ?? 20_000;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake.local");
    if (req.method === "POST" && url.pathname === "/__override") {
      override = url.searchParams.get("digit") || null;
      res.writeHead(204).end();
      return;
    }
    const refMatch = url.pathname.match(/^\/__override\/(\d{12})$/);
    if (req.method === "PUT" && refMatch) {
      const status = url.searchParams.get("status");
      if (!isFakeStatus(status)) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("status must be BLANK, NON_BLANK, NEW_INFO, NO_MATCH or ERROR");
        return;
      }
      refOverrides.set(refMatch[1], FAKE_DBS_STATUS_DIGIT[status]);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/__override") {
      refOverrides.clear();
      override = null;
      res.writeHead(204).end();
      return;
    }
    const m = url.pathname.match(/^\/crsc\/api\/status\/([^/]+)$/);
    if (req.method !== "GET" || !m) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const ref = decodeURIComponent(m[1]);
    const query = Object.fromEntries(url.searchParams.entries());
    requests.push({ path: url.pathname, query });

    const invalid = validationError(ref, query);
    if (invalid) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(invalid);
      return;
    }

    const send = (body: string) => res.writeHead(200, { "Content-Type": XML_TYPE }).end(body);
    switch (refOverrides.get(ref) ?? override ?? ref[0]) {
      case "1": return send(successXml("NO_MATCH_FOUND", false));
      case "2": return send(successXml("BLANK_NO_NEW_INFO"));
      case "3": return send(successXml("NON_BLANK_NO_NEW_INFO"));
      case "4": return send(successXml("NEW_INFO"));
      case "5": return send(successXml("SOMETHING_ELSE"));
      case "6": return send("<statusCheckResult><status>BLANK_NO_");
      case "7": {
        const t = setTimeout(() => send(successXml("BLANK_NO_NEW_INFO")), holdMs);
        res.on("close", () => clearTimeout(t));
        return;
      }
      case "8": return send("<statusCheckResult><statusCheckResultType>FAILURE</statusCheckResultType></statusCheckResult>");
      default:
        res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal Server Error");
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/crsc`,
        requests,
        setOverrideDigit: (d) => {
          override = d;
        },
        setRefOverride: (r, status) => {
          if (status) refOverrides.set(r, FAKE_DBS_STATUS_DIGIT[status]);
          else refOverrides.delete(r);
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

// Standalone (walk only): `node tests/fakes/dbs-update-service.ts 5123`
if (typeof process !== "undefined" && process.argv[1]?.endsWith("dbs-update-service.ts")) {
  const port = Number(process.argv[2] ?? 5123);
  startFakeDbsUpdateService({ port }).then((s) => console.log(`fake DBS Update Service on ${s.baseUrl}`));
}
