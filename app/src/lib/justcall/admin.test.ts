/**
 * admin.ts — 05a-2's admin operations (plan 05 §5 B2; brief §0.5–§0.9, §3 admin 6–7; R5, R7). Each needs the logging
 * switch and an `AdminProof` before any read; inputs are checked; refusals are closed codes; nothing is thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import type { CallLogEntry } from "@/lib/calls/types";
import {
  SEARCH_LIMIT,
  UNMATCHED_LIMIT,
  attachCall,
  detailsForCalls,
  dismissCall,
  justcallAttemptsFor,
  listUnmatched,
  saveJustCallOutcome,
  searchParentsForAttach,
  type AdminDeps,
} from "./admin";
import type { JustCallDetails, UnmatchedCall } from "./types";

const ADMIN = "a0500000-0000-4000-8000-000000000060";
const P1 = "b0500000-0000-4000-8000-000000000017";
const BOOKING = "c0500000-0000-4000-8000-000000000001";
const DETAILS: JustCallDetails = {
  callSid: "CAtest0001", direction: "outgoing", justcallType: "Answered", mappedResult: "answered", durationSeconds: 372,
  startedAt: "2027-02-09T14:03:00.000Z", notes: "wants Tuesdays", disposition: null,
};
const UNMATCHED: UnmatchedCall = { ...DETAILS, callSid: "CAun0001", contactNumber: "447700900599", matchNote: "none", notes: null };

function deps(over: Partial<{ [K in keyof AdminDeps["adminRepo"]]: unknown } & { [K in keyof AdminDeps["repo"]]: unknown }> = {}) {
  const adminRepo = {
    readUnmatched: vi.fn(async () => ({ ok: true, value: { calls: [UNMATCHED], total: 1 } })),
    readDetails: vi.fn(async (sids: readonly string[]) => ({ ok: true, value: new Map(sids.filter((s) => s === DETAILS.callSid).map((s) => [s, DETAILS])) })),
    searchParents: vi.fn(async () => ({ ok: true, value: [
      { userId: P1, firstName: "Ava", lastName: "Smith", mobile: "+447700900517" },
      { userId: "b0500000-0000-4000-8000-000000000018", firstName: "Ann", lastName: "Bell", mobile: null },
    ] })),
    ...over,
  };
  const repo = {
    attachCall: vi.fn(async () => ({ ok: true, value: { entryId: "e-1", entryCreated: true } })),
    dismissCall: vi.fn(async () => ({ ok: true, value: { replay: false } })),
    saveOutcome: vi.fn(async () => ({ ok: true, value: { entryId: "e-1", completed: true } })),
    ...over,
  };
  return { adminRepo, repo, d: { adminRepo, repo } as unknown as AdminDeps };
}

let proof: AdminProof;
beforeEach(async () => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
  requireAdmin.mockResolvedValue({ userId: ADMIN, error: null });
  proof = (await proveAdmin()) as AdminProof;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const lookAlike = { kind: "admin_proof", userId: ADMIN } as unknown as AdminProof;

describe("every operation: the switch, then the proof, before any read", () => {
  const runs = (d: AdminDeps, p: AdminProof) => [
    () => listUnmatched(p, d),
    () => detailsForCalls(p, ["CAtest0001"], d),
    () => attachCall(p, { callSid: "CAun0001", parentUserId: P1 }, d),
    () => dismissCall(p, { callSid: "CAun0001" }, d),
    () => saveJustCallOutcome(p, { parentUserId: P1, bookingId: null, callSid: "CAtest0001", result: "answered", outcome: null, note: null, callBackAt: null }, d),
    () => searchParentsForAttach(p, "ava", d),
  ];

  it.each([["logging unset", "JUSTCALL_WEBHOOK_ENABLED"], ["call booking unset", "CALL_BOOKING_ENABLED"]])("%s → justcall_disabled, nothing read", async (_label, name) => {
    vi.stubEnv(name, "");
    const { d, adminRepo, repo } = deps();
    for (const run of runs(d, proof)) expect(await run()).toEqual({ ok: false, error: "justcall_disabled" });
    expect([...Object.values(adminRepo), ...Object.values(repo)].every((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });

  it("a look-alike proof → not_authorized, nothing read", async () => {
    const { d, adminRepo, repo } = deps();
    for (const run of runs(d, lookAlike)) expect(await run()).toEqual({ ok: false, error: "not_authorized" });
    expect([...Object.values(adminRepo), ...Object.values(repo)].every((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });
});

describe("listUnmatched", () => {
  it("the newest 100, in words, with the full count", async () => {
    const { d, adminRepo } = deps();
    expect(await listUnmatched(proof, d)).toEqual({ ok: true, value: { total: 1, calls: [{
      callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing",
      result: "Answered", duration: "6 min 12 s", reason: "No family with this number",
    }] } });
    expect(adminRepo.readUnmatched).toHaveBeenCalledWith(UNMATCHED_LIMIT);
    expect(UNMATCHED_LIMIT).toBe(100);
  });

  it("a failed read → error", async () => {
    const { d } = deps({ readUnmatched: vi.fn(async () => ({ ok: false, error: "error" })) });
    expect(await listUnmatched(proof, d)).toEqual({ ok: false, error: "error" });
  });
});

describe("detailsForCalls", () => {
  it("details for the sids asked about; sids that can't be a call are dropped before the read", async () => {
    const { d, adminRepo } = deps();
    const result = await detailsForCalls(proof, ["CAtest0001", "CA bad;", "CAtest0001"], d);
    expect(adminRepo.readDetails).toHaveBeenCalledWith(["CAtest0001"]);
    expect(result.ok && result.value.get("CAtest0001")).toEqual(DETAILS);
  });

  it("nothing to read → an empty map, no read", async () => {
    const { d, adminRepo } = deps();
    expect(await detailsForCalls(proof, [], d)).toEqual({ ok: true, value: new Map() });
    expect(adminRepo.readDetails).not.toHaveBeenCalled();
  });
});

describe("attachCall and dismissCall (brief §0.9, §3 admin 7)", () => {
  it("attach: onto that family, as the proven admin", async () => {
    const { d, repo } = deps();
    expect(await attachCall(proof, { callSid: "CAun0001", parentUserId: P1 }, d)).toEqual({ ok: true, value: { entryCreated: true } });
    expect(repo.attachCall).toHaveBeenCalledWith("CAun0001", P1, ADMIN);
  });

  it.each(["not_found", "not_unmatched", "not_a_parent", "not_yours", "invalid", "error"])("attach refused %s → the same code", async (error) => {
    const { d } = deps({ attachCall: vi.fn(async () => ({ ok: false, error })) });
    expect(await attachCall(proof, { callSid: "CAun0001", parentUserId: P1 }, d)).toEqual({ ok: false, error });
  });

  it("dismiss: as the proven admin; a second dismiss is fine", async () => {
    const { d, repo } = deps();
    expect(await dismissCall(proof, { callSid: "CAun0001" }, d)).toEqual({ ok: true, value: { replay: false } });
    expect(repo.dismissCall).toHaveBeenCalledWith("CAun0001", ADMIN);
  });

  it.each([
    [{ callSid: "CA bad;", parentUserId: P1 }],
    [{ callSid: "CAun0001", parentUserId: "not-a-uuid" }],
  ])("attach with bad input %j → invalid, nothing written", async (input) => {
    const { d, repo } = deps();
    expect(await attachCall(proof, input, d)).toEqual({ ok: false, error: "invalid" });
    expect(repo.attachCall).not.toHaveBeenCalled();
  });
});

describe("saveJustCallOutcome (R5: BAI's words win)", () => {
  const input = { parentUserId: P1, bookingId: BOOKING, callSid: "CAtest0001", result: "answered", outcome: "link_sent", note: "Sent the link", callBackAt: null } as const;

  it("through justcall_save_outcome, as the proven admin", async () => {
    const { d, repo } = deps();
    expect(await saveJustCallOutcome(proof, input, d)).toEqual({ ok: true, value: { entryId: "e-1", completed: true } });
    expect(repo.saveOutcome).toHaveBeenCalledWith({ ...input, actorUserId: ADMIN });
  });

  it.each(["not_yours", "not_found", "booked_call_exists", "invalid", "error"])("refused %s → the same code", async (error) => {
    const { d } = deps({ saveOutcome: vi.fn(async () => ({ ok: false, error })) });
    expect(await saveJustCallOutcome(proof, input, d)).toEqual({ ok: false, error });
  });

  it.each([
    [{ ...input, outcome: "link_sent", result: "no_answer" }],
    [{ ...input, result: null, outcome: null }],
    [{ ...input, callSid: "../x" }],
    [{ ...input, note: "n".repeat(2001) }],
  ])("04's outcome rules: %j → invalid, nothing written", async (bad) => {
    const { d, repo } = deps();
    expect(await saveJustCallOutcome(proof, bad as typeof input, d)).toEqual({ ok: false, error: "invalid" });
    expect(repo.saveOutcome).not.toHaveBeenCalled();
  });
});

describe("searchParentsForAttach (parents only, top 10)", () => {
  it.each([
    ["07700 900517", { kind: "mobile", e164: "+447700900517" }],
    ["+44 7700 900517", { kind: "mobile", e164: "+447700900517" }],
    ["Ava", { kind: "name", first: "ava", last: null }],
    ["  ava   SMITH ", { kind: "name", first: "ava", last: "smith" }],
    ["Mary-Jane O'Neil", { kind: "name", first: "mary-jane", last: "o'neil" }],
  ])("%j → %j", async (q, query) => {
    const { d, adminRepo } = deps();
    await searchParentsForAttach(proof, q, d);
    expect(adminRepo.searchParents).toHaveBeenCalledWith(query);
  });

  it("names and mobiles in words, sorted by name, at most 10", async () => {
    const { d } = deps();
    expect(await searchParentsForAttach(proof, "a", d)).toEqual({ ok: false, error: "invalid" });
    expect(await searchParentsForAttach(proof, "ava", d)).toEqual({ ok: true, value: [
      { parentUserId: "b0500000-0000-4000-8000-000000000018", name: "Ann Bell", mobile: null },
      { parentUserId: P1, name: "Ava Smith", mobile: "+44 (0) 7700 900 517" },
    ] });
    const many = Array.from({ length: 30 }, (_, i) => ({ userId: `b0500000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, firstName: "Ava", lastName: `Name${i}`, mobile: null }));
    const big = deps({ searchParents: vi.fn(async () => ({ ok: true, value: many })) });
    const result = await searchParentsForAttach(proof, "ava", big.d);
    expect(result.ok && result.value.length).toBe(SEARCH_LIMIT);
    expect(SEARCH_LIMIT).toBe(10);
  });

  it.each(["", " ", "a", "%", "a,b(", "x".repeat(101), "<script>", "ava*"])("%j → invalid, nothing read (no filter syntax reaches the query)", async (q) => {
    const { d, adminRepo } = deps();
    expect(await searchParentsForAttach(proof, q, d)).toEqual({ ok: false, error: "invalid" });
    expect(adminRepo.searchParents).not.toHaveBeenCalled();
  });
});

describe("justcallAttemptsFor (04's readers, with logging on)", () => {
  const entry = (over: Partial<CallLogEntry>): CallLogEntry => ({
    id: "e-1", parentUserId: P1, bookingId: null, occurredAt: "2027-02-09T14:03:00.000Z", recordedBy: null, method: "justcall", source: "justcall",
    result: "answered", outcome: null, note: null, callBackAt: null, justcallCallId: "CAtest0001", ...over,
  } as CallLogEntry);

  it("05's words for each JustCall entry, by entry id; other entries left to 04", async () => {
    const { d, adminRepo } = deps();
    const map = await justcallAttemptsFor(proof, [entry({}), entry({ id: "e-2", method: "phone", source: "manual", justcallCallId: null })], d);
    expect(adminRepo.readDetails).toHaveBeenCalledWith(["CAtest0001"]);
    expect([...map.keys()]).toEqual(["e-1"]);
    expect(map.get("e-1")).toMatchObject({ callSid: "CAtest0001", needsOutcome: true, what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s", lines: ["JustCall notes: wants Tuesdays"] });
  });

  it("a call whose details weren't found keeps 04's words", async () => {
    const { d } = deps();
    expect((await justcallAttemptsFor(proof, [entry({ justcallCallId: "CAother" })], d)).size).toBe(0);
  });

  it("logging off, no JustCall entries, or a look-alike proof → no read at all", async () => {
    const { d, adminRepo } = deps();
    expect((await justcallAttemptsFor(proof, [entry({ justcallCallId: null })], d)).size).toBe(0);
    expect((await justcallAttemptsFor(lookAlike, [entry({})], d)).size).toBe(0);
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    expect((await justcallAttemptsFor(proof, [entry({})], d)).size).toBe(0);
    expect(adminRepo.readDetails).not.toHaveBeenCalled();
  });

  it("a failed details read → no words (04's stand), logged, never thrown", async () => {
    const failing = deps({ readDetails: vi.fn(async () => ({ ok: false, error: "error" })) });
    expect((await justcallAttemptsFor(proof, [entry({})], failing.d)).size).toBe(0);
    const throwing = deps({ readDetails: vi.fn(async () => { throw new Error("socket"); }) });
    expect((await justcallAttemptsFor(proof, [entry({})], throwing.d)).size).toBe(0);
  });
});
