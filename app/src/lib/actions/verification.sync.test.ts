/**
 * Unit 3a (BB-LDN-3a-061026) — regression G3, G4, G5, G13 (04-test-plan §6), written before the first edit.
 *
 * 3a re-means the codes but does NOT touch `syncNannyVerificationState` (brief change 11): it already turns
 * `wwcc_verified=true` into level 4 + active (+ `promotePendingConnections`), and `wwcc_status='barred'` into level 0
 * + suspended. These pins prove that stays true before and after the unit, and G5 pins the body byte-for-byte.
 *
 * `visible_in_match_making` is a generated column (`status = 'active' AND wwcc_verified AND identity_verified`,
 * LDN2/schema/02_tables.sql), so "visible" is asserted through exactly those three written fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Call = { table: string; op: string; args: unknown[] };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  nanny: null as { id: string; verification_level: number } | null,
  verification: null as Record<string, unknown> | null,
}));

function builder(table: string) {
  const record = (op: string, args: unknown[]) => state.calls.push({ table, op, args });
  const result = () => {
    if (table === "nannies") return { data: state.nanny, error: null };
    if (table === "verifications") return { data: state.verification, error: null };
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order", "limit", "update", "delete", "insert", "neq", "not"]) {
    b[op] = (...args: unknown[]) => {
      record(op, args);
      return b;
    };
  }
  b.single = async () => result();
  b.maybeSingle = async () => result();
  b.then = (resolveFn: (v: unknown) => unknown) => Promise.resolve(result()).then(resolveFn);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({})) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import { syncNannyVerificationState } from "./verification";
import { STATUS_META, deriveOverallStatus } from "@/lib/verification";

const nannyUpdate = () =>
  state.calls.find((c) => c.table === "nannies" && c.op === "update")?.args[0] as Record<string, unknown>;
const queriedConnections = () => state.calls.some((c) => c.table === "connection_requests" && c.op === "select");

beforeEach(() => {
  state.calls = [];
  state.nanny = { id: "nanny-1", verification_level: 3 };
  state.verification = null;
});

describe("syncNannyVerificationState — pinned by 3a (unchanged)", () => {
  it("G3 returns level 4, active, visible and calls promotePendingConnections when wwcc_verified=true", async () => {
    state.verification = {
      identity_status: "verified",
      identity_verified: true,
      wwcc_status: "doc_verified",
      wwcc_verified: true,
      cross_check_status: "passed",
    };
    await syncNannyVerificationState("user-1");
    const u = nannyUpdate();
    expect(u.verification_level).toBe(4);
    expect(u.status).toBe("active");
    expect(u.identity_verified).toBe(true);
    expect(u.wwcc_verified).toBe(true);
    expect(queriedConnections()).toBe(true);
  });

  it("G4 returns level ≤ 2 and hides her when wwcc_verified=false", async () => {
    state.verification = {
      identity_status: "verified",
      identity_verified: true,
      wwcc_status: "expired",
      wwcc_verified: false,
      cross_check_status: "not_started",
    };
    await syncNannyVerificationState("user-1");
    const u = nannyUpdate();
    expect(u.verification_level).toBeLessThanOrEqual(2);
    expect(u.wwcc_verified).toBe(false);
    expect(u.status).toBeUndefined();
    expect(queriedConnections()).toBe(false);
  });

  it("G5 sync function source hash matches the pre-3a snapshot", () => {
    const source = readFileSync(resolve(__dirname, "verification.ts"), "utf8");
    const start = source.indexOf("export async function syncNannyVerificationState");
    const end = source.indexOf("\n}\n", start) + 3;
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    // Measured on origin/main @ 8c4de49 before 3a's first edit (94 lines).
    expect(createHash("sha256").update(body).digest("hex")).toBe(
      "c3da1d4a38c399cf50dc750d6454b2d760ca4860f3f26189d7dd9abd1d6461e0",
    );
  });

  it("G13 sync sets level 0 and suspended when the DBS section is barred, now shown as 27", async () => {
    state.verification = {
      identity_status: "verified",
      identity_verified: true,
      wwcc_status: "barred",
      wwcc_verified: false,
      cross_check_status: "passed",
    };
    await syncNannyVerificationState("user-1");
    const u = nannyUpdate();
    expect(u.verification_level).toBe(0);
    expect(u.status).toBe("suspended");
    const code = deriveOverallStatus("verified", "barred", "passed");
    expect(code).toBe(27);
    expect(STATUS_META[code].label).toBe("DBS Barred (27)");
  });
});
