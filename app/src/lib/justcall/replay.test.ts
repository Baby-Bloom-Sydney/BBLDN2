/**
 * The replay (plan 05 §5 A10, R9; brief §3 edges, §9 row 12): on BAI's word only, re-apply one ledger row or every
 * `unresolved` row through the same idempotent path (`apply.ts` → `justcall_record_call`), and print counts only.
 * Refused while the logging switch is off (no JustCall request leaves the app), or a setting is missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyDeps } from "./apply";
import type { JustCallRepo, StoredEvent } from "./repo";
import { REPLAY_PAUSE_MS, parseReplayArgs, replayJustCallEvents, runReplayCli, type ReplayDeps } from "./replay";

const ID_1 = "e0500000-0000-4000-8000-000000000001";
const ID_2 = "e0500000-0000-4000-8000-000000000002";
const row = (id: string, sid: string): StoredEvent => ({ id, eventType: "call.completed", callSid: sid, justcallId: null, requestId: null, requestTimestamp: "1801000000", outcome: "unresolved" });

function fakeDeps(over: { outcomes?: Record<string, "applied" | "ignored" | "unresolved">; rows?: StoredEvent[]; finishFails?: boolean; listFails?: boolean } = {}) {
  const rows = over.rows ?? [row(ID_1, "CAone"), row(ID_2, "CAtwo")];
  const finished: Array<[string, string, string | null]> = [];
  const repo = {
    readEvent: vi.fn(async (id: string) => ({ ok: true as const, value: rows.find((r) => r.id === id) ?? null })),
    readUnresolvedEvents: vi.fn(async () => (over.listFails ? { ok: false as const, error: "error" as const } : { ok: true as const, value: rows })),
    finishEvent: vi.fn(async (id: string, outcome: string, code: string | null) => {
      finished.push([id, outcome, code]);
      return over.finishFails ? { ok: false as const, error: "error" as const } : { ok: true as const, value: true as const };
    }),
    insertEvent: vi.fn(),
  } as unknown as JustCallRepo;
  const getCall = vi.fn(async (sid: string) => {
    const outcome = over.outcomes?.[sid] ?? "applied";
    if (outcome === "unresolved") return { ok: false as const, error: "unavailable" as const, code: "api_500" };
    if (outcome === "ignored") return { ok: false as const, error: "not_found" as const };
    return {
      ok: true as const,
      value: { callSid: sid, justcallId: null, contactNumber: "447700900517", justcallNumber: null, agentEmail: null, callDate: "2027-02-09", callTime: "14:03:00", direction: "Outgoing", type: "Answered", disposition: null, notes: null, durationSeconds: 60 },
    };
  });
  const applyDeps: ApplyDeps = {
    getCall,
    repo: {
      parentsByMobile: vi.fn(async () => ({ ok: true as const, value: ["parent-1"] })),
      recordCall: vi.fn(async () => ({ ok: true as const, value: { entryId: "e", entryCreated: true, matched: true } })),
    },
  };
  const sleep = vi.fn(async () => undefined);
  const deps: ReplayDeps = { repo, applyDeps, sleep };
  return { deps, repo, getCall, sleep, finished };
}

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
  vi.stubEnv("JUSTCALL_API_KEY", "test-key-not-real");
  vi.stubEnv("JUSTCALL_API_SECRET", "test-secret-not-real");
  vi.stubEnv("JUSTCALL_WEBHOOK_URL", "https://app.example.test/api/webhooks/justcall");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseReplayArgs", () => {
  it.each([
    [[`--id=${ID_1}`], { kind: "one", id: ID_1 }],
    [["--unresolved"], { kind: "unresolved" }],
  ])("%j", (argv, expected) => {
    expect(parseReplayArgs(argv)).toEqual(expected);
  });

  it.each([[[]], [["--id=nope"]], [["--unresolved", `--id=${ID_1}`]], [["--all"]], [["--unresolved", "--unresolved"]]])("%j → null (usage)", (argv) => {
    expect(parseReplayArgs(argv)).toBeNull();
  });
});

describe("replayJustCallEvents", () => {
  it("one row: re-issued from the ledger, applied, its outcome written", async () => {
    const { deps, getCall, finished, sleep } = fakeDeps();
    expect(await replayJustCallEvents({ kind: "one", id: ID_1 }, deps)).toEqual({ ok: true, counts: { rows: 1, applied: 1, ignored: 0, unresolved: 0, notReplayed: 0 } });
    expect(getCall).toHaveBeenCalledExactlyOnceWith("CAone");
    expect(finished).toEqual([[ID_1, "applied", null]]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("every unresolved row, in order, pausing between API reads (Team plan: 30 a minute)", async () => {
    const { deps, getCall, sleep, finished } = fakeDeps({ outcomes: { CAtwo: "unresolved" } });
    expect(await replayJustCallEvents({ kind: "unresolved" }, deps)).toEqual({ ok: true, counts: { rows: 2, applied: 1, ignored: 0, unresolved: 1, notReplayed: 0 } });
    expect(getCall.mock.calls.map(([sid]) => sid)).toEqual(["CAone", "CAtwo"]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(REPLAY_PAUSE_MS);
    expect(REPLAY_PAUSE_MS).toBeGreaterThanOrEqual(2_000);
    expect(finished).toEqual([[ID_1, "applied", null], [ID_2, "unresolved", "api_500"]]);
  });

  it.each(["applied", "ignored"] as const)("a row already %s is not replayed and keeps its outcome (review TS L10)", async (outcome) => {
    const { deps, getCall, finished } = fakeDeps({ rows: [{ ...row(ID_1, "CAone"), outcome }] });
    expect(await replayJustCallEvents({ kind: "one", id: ID_1 }, deps)).toEqual({ ok: true, counts: { rows: 1, applied: 0, ignored: 0, unresolved: 0, notReplayed: 1 } });
    expect(getCall).not.toHaveBeenCalled();
    expect(finished).toEqual([]);
  });

  it("an id that isn't there, or an outcome that can't be written, is counted as not replayed", async () => {
    const missing = fakeDeps();
    expect(await replayJustCallEvents({ kind: "one", id: "e0500000-0000-4000-8000-000000000009" }, missing.deps)).toEqual({ ok: true, counts: { rows: 1, applied: 0, ignored: 0, unresolved: 0, notReplayed: 1 } });
    const unwritten = fakeDeps({ finishFails: true });
    expect(await replayJustCallEvents({ kind: "one", id: ID_1 }, unwritten.deps)).toEqual({ ok: true, counts: { rows: 1, applied: 0, ignored: 0, unresolved: 0, notReplayed: 1 } });
  });

  it("the list can't be read → error, nothing applied", async () => {
    const { deps, getCall } = fakeDeps({ listFails: true });
    expect(await replayJustCallEvents({ kind: "unresolved" }, deps)).toEqual({ ok: false, error: "read_failed" });
    expect(getCall).not.toHaveBeenCalled();
  });

  it("refused while the logging switch is off — no JustCall request leaves the app", async () => {
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    const { deps, repo, getCall } = fakeDeps();
    expect(await replayJustCallEvents({ kind: "unresolved" }, deps)).toEqual({ ok: false, error: "disabled" });
    expect(repo.readUnresolvedEvents).not.toHaveBeenCalled();
    expect(getCall).not.toHaveBeenCalled();
  });
});

describe("runReplayCli", () => {
  it("prints counts only and exits 0 when everything applied", async () => {
    const { deps } = fakeDeps();
    const lines: string[] = [];
    expect(await runReplayCli(["--unresolved"], (l) => lines.push(l), () => deps)).toBe(0);
    expect(lines).toEqual(["justcall-replay: 2 rows — applied 2, ignored 0, unresolved 0, not replayed 0"]);
  });

  it("exits 1 when a row stays unresolved or wasn't replayed", async () => {
    const { deps } = fakeDeps({ outcomes: { CAone: "unresolved" } });
    expect(await runReplayCli([`--id=${ID_1}`], () => undefined, () => deps)).toBe(1);
  });

  it("usage → exit 2, nothing read", async () => {
    const make = vi.fn();
    const lines: string[] = [];
    expect(await runReplayCli(["--everything"], (l) => lines.push(l), make)).toBe(2);
    expect(make).not.toHaveBeenCalled();
    expect(lines.join(" ")).toContain("--unresolved");
  });

  it("a missing setting → its name only, exit 2, nothing read", async () => {
    vi.stubEnv("JUSTCALL_API_SECRET", "");
    const make = vi.fn();
    const lines: string[] = [];
    expect(await runReplayCli(["--unresolved"], (l) => lines.push(l), make)).toBe(2);
    expect(make).not.toHaveBeenCalled();
    expect(lines.join(" ")).toContain("JUSTCALL_API_SECRET");
    expect(lines.join(" ")).not.toContain("test-key-not-real");
  });

  it("switched off → exit 2, naming the two switches (the script reads exported env only; review code M3)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { deps } = fakeDeps();
    const lines: string[] = [];
    expect(await runReplayCli(["--unresolved"], (l) => lines.push(l), () => deps)).toBe(2);
    expect(lines.join(" ")).toContain("JUSTCALL_WEBHOOK_ENABLED");
    expect(lines.join(" ")).toContain("CALL_BOOKING_ENABLED");
  });

  it("a failed list read → exit 1", async () => {
    const { deps } = fakeDeps({ listFails: true });
    expect(await runReplayCli(["--unresolved"], () => undefined, () => deps)).toBe(1);
  });
});
