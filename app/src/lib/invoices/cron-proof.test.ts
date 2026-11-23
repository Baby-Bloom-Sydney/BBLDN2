/**
 * The cron proof (plan 06 §16.7 b5.2; §16.4 "Cron auth"): the Friday reminder's runner takes one, and only
 * `proveInvoiceCron(authorization)` makes one — from the request's `Authorization: Bearer $CRON_SECRET`, failing
 * closed when the secret is unset or blank. The `nanny-proof.ts` shape: a run-time brand and a 120-second life.
 * `cronGate`: the switch first (`invoices_disabled`), then the proof (`invalid`).
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, getNannyId } = vi.hoisted(() => ({ createAdminClient: vi.fn(), getNannyId: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));

import { isInvoiceCronProof, proveInvoiceCron } from "./cron-proof";
import { cronGate } from "./gate";
import { proveNanny } from "./nanny-proof";

const SECRET = "cron-test-value-7f3a";
const RIGHT = `Bearer ${SECRET}`;

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  createAdminClient.mockReset();
});

describe("proveInvoiceCron", () => {
  it("the right bearer → a frozen proof that carries nothing else", () => {
    const proof = proveInvoiceCron(RIGHT);
    expect(proof).toEqual({ kind: "invoice_cron_proof" });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(isInvoiceCronProof(proof)).toBe(true);
  });

  it("no header, a wrong bearer, the secret without 'Bearer', another case or padding → null", () => {
    for (const header of [null, undefined, "", "Bearer", "Bearer ", "Bearer wrong", SECRET, `bearer ${SECRET}`, ` ${RIGHT}`, `${RIGHT} `, `Bearer  ${SECRET}`, `${RIGHT}x`]) {
      expect(proveInvoiceCron(header)).toBeNull();
    }
  });

  it("fails closed with CRON_SECRET unset, empty or blank, whatever the header", () => {
    for (const secret of [undefined, "", "   "]) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else vi.stubEnv("CRON_SECRET", secret);
      for (const header of [null, "", "Bearer ", "Bearer undefined", "Bearer    ", RIGHT]) {
        expect(proveInvoiceCron(header)).toBeNull();
      }
    }
  });

  it("switch off → null even with the right bearer", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(proveInvoiceCron(RIGHT)).toBeNull();
  });

  it("reads no database", () => {
    proveInvoiceCron(RIGHT);
    proveInvoiceCron("Bearer wrong");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("isInvoiceCronProof", () => {
  it("lasts one run: refused 120 seconds after it was made (longer than the route's maxDuration of 60)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-02-12T16:00:00Z"));
    const proof = proveInvoiceCron(RIGHT);
    vi.setSystemTime(new Date("2027-02-12T16:01:59Z"));
    expect(isInvoiceCronProof(proof)).toBe(true);
    vi.setSystemTime(new Date("2027-02-12T16:02:00Z"));
    expect(isInvoiceCronProof(proof)).toBe(false);
  });

  it("refuses a look-alike, a copy, a cast and other values", () => {
    const real = proveInvoiceCron(RIGHT);
    expect(isInvoiceCronProof({ kind: "invoice_cron_proof" })).toBe(false);
    expect(isInvoiceCronProof({ ...real })).toBe(false);
    expect(isInvoiceCronProof(null)).toBe(false);
    expect(isInvoiceCronProof(undefined)).toBe(false);
    expect(isInvoiceCronProof("invoice_cron_proof")).toBe(false);
  });
});

describe("cronGate", () => {
  it("a cron proof → null (go on)", () => {
    expect(cronGate(proveInvoiceCron(RIGHT))).toBeNull();
  });

  it("the switch first: off → invoices_disabled, even for a real proof", () => {
    const proof = proveInvoiceCron(RIGHT);
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(cronGate(proof)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(cronGate({ kind: "invoice_cron_proof" })).toEqual({ ok: false, error: "invoices_disabled" });
  });

  it("then the proof: anything else → invalid, a nanny proof included", async () => {
    getNannyId.mockResolvedValueOnce({ nannyId: "b0600000-0000-4000-8000-000000000101", userId: "b0600000-0000-4000-8000-000000000001" });
    const nanny = await proveNanny();
    expect(nanny).not.toBeNull();
    expect(cronGate(nanny)).toEqual({ ok: false, error: "invalid" });
    expect(cronGate({ kind: "invoice_cron_proof" })).toEqual({ ok: false, error: "invalid" });
    expect(cronGate(null)).toEqual({ ok: false, error: "invalid" });
  });
});
