/**
 * /admin/calls JustCall actions (plan 05 §5 B3; brief §3 admin 6–7): 04's contract (`actions.ts`) — the logging switch
 * first (off → `justcall_disabled`, before the admin check or any read), then `proveAdmin()` (→ `not_authorized`), then
 * zod on the whole input (→ `invalid`), then one operation as the proven admin, then `/admin/calls` revalidated after a
 * write. Refusals are closed codes; only these async functions are exported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  saveJustCallOutcome: vi.fn(),
  attachCall: vi.fn(),
  dismissCall: vi.fn(),
  searchParentsForAttach: vi.fn(),
}));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
// The schemas are the real ones (shared with admin.ts); the operations are fakes.
vi.mock("@/lib/justcall/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/justcall/admin")>()),
  saveJustCallOutcome: h.saveJustCallOutcome,
  attachCall: h.attachCall,
  dismissCall: h.dismissCall,
  searchParentsForAttach: h.searchParentsForAttach,
}));

import * as actions from "./justcall-actions";
import { attachJustCallAction, dismissJustCallAction, saveJustCallOutcomeAction, searchFamiliesForCallAction } from "./justcall-actions";

const ADMIN = "a0500000-0000-4000-8000-000000000060";
const P1 = "b0500000-0000-4000-8000-000000000017";
const BOOKING = "c0500000-0000-4000-8000-000000000001";
const SAVE = { parentUserId: P1, bookingId: BOOKING, callSid: "CAtest0001", result: "answered", outcome: "link_sent", note: "  Sent the link ", callBackDate: null, callBackTime: null };

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
  h.requireAdmin.mockReset().mockResolvedValue({ userId: ADMIN, error: null });
  h.revalidatePath.mockReset();
  h.saveJustCallOutcome.mockReset().mockResolvedValue({ ok: true, value: { entryId: "e-1", completed: true } });
  h.attachCall.mockReset().mockResolvedValue({ ok: true, value: { entryCreated: true } });
  h.dismissCall.mockReset().mockResolvedValue({ ok: true, value: { replay: false } });
  h.searchParentsForAttach.mockReset().mockResolvedValue({ ok: true, value: [{ parentUserId: P1, name: "Ava Smith", mobile: "+44 (0) 7700 900 517" }] });
});
afterEach(() => vi.unstubAllEnvs());

const ops = () => [h.saveJustCallOutcome, h.attachCall, h.dismissCall, h.searchParentsForAttach];
const calls = [
  () => saveJustCallOutcomeAction(SAVE),
  () => attachJustCallAction({ callSid: "CAun0001", parentUserId: P1 }),
  () => dismissJustCallAction({ callSid: "CAun0001" }),
  () => searchFamiliesForCallAction({ query: "ava" }),
];

describe("the contract, for every action", () => {
  it("exports only these four async functions", () => {
    expect(Object.keys(actions).sort()).toEqual(["attachJustCallAction", "dismissJustCallAction", "saveJustCallOutcomeAction", "searchFamiliesForCallAction"]);
    for (const fn of Object.values(actions)) expect(fn.constructor.name).toBe("AsyncFunction");
  });

  it.each([["logging unset", "JUSTCALL_WEBHOOK_ENABLED"], ["call booking unset", "CALL_BOOKING_ENABLED"]])("%s → justcall_disabled before the admin check", async (_label, name) => {
    vi.stubEnv(name, "");
    for (const run of calls) expect(await run()).toEqual({ ok: false, error: "justcall_disabled" });
    expect(h.requireAdmin).not.toHaveBeenCalled();
    expect(ops().every((op) => op.mock.calls.length === 0)).toBe(true);
  });

  it("not an admin → not_authorized, nothing run", async () => {
    h.requireAdmin.mockResolvedValue({ userId: "", error: "Not authorized — admin role required" });
    for (const run of calls) expect(await run()).toEqual({ ok: false, error: "not_authorized" });
    expect(ops().every((op) => op.mock.calls.length === 0)).toBe(true);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["save, an extra field", () => saveJustCallOutcomeAction({ ...SAVE, method: "phone" })],
    ["save, a bad sid", () => saveJustCallOutcomeAction({ ...SAVE, callSid: "../x" })],
    ["save, an outcome without Answered", () => saveJustCallOutcomeAction({ ...SAVE, result: "no_answer" })],
    ["save, a call-back with no Call back later", () => saveJustCallOutcomeAction({ ...SAVE, callBackDate: "2099-02-09", callBackTime: "17:00" })],
    ["save, a note over 2,000", () => saveJustCallOutcomeAction({ ...SAVE, note: "n".repeat(2001) })],
    ["attach, not a user id", () => attachJustCallAction({ callSid: "CAun0001", parentUserId: "nope" })],
    ["attach, an extra field", () => attachJustCallAction({ callSid: "CAun0001", parentUserId: P1, actor: ADMIN })],
    ["dismiss, no sid", () => dismissJustCallAction({})],
    ["search, not a string", () => searchFamiliesForCallAction({ query: 7 })],
    ["search, too long", () => searchFamiliesForCallAction({ query: "x".repeat(101) })],
    ["not an object", () => attachJustCallAction("CAun0001")],
  ])("%s → invalid, nothing run", async (_label, run) => {
    expect(await run()).toEqual({ ok: false, error: "invalid" });
    expect(ops().every((op) => op.mock.calls.length === 0)).toBe(true);
  });
});

describe("saveJustCallOutcomeAction (R5)", () => {
  it("saves through justcall_save_outcome as the proven admin, the note trimmed; then revalidates", async () => {
    expect(await saveJustCallOutcomeAction(SAVE)).toEqual({ ok: true, value: { entryId: "e-1" } });
    const [proof, input] = h.saveJustCallOutcome.mock.calls[0];
    expect(proof).toMatchObject({ kind: "admin_proof", userId: ADMIN });
    expect(input).toEqual({ parentUserId: P1, bookingId: BOOKING, callSid: "CAtest0001", result: "answered", outcome: "link_sent", note: "Sent the link", callBackAt: null });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/calls");
  });

  it("Call back later: the call-back read as London time on the server", async () => {
    await saveJustCallOutcomeAction({ ...SAVE, outcome: "call_back_later", callBackDate: "2099-07-09", callBackTime: "17:00" });
    expect(h.saveJustCallOutcome.mock.calls[0][1]).toMatchObject({ callBackAt: "2099-07-09T16:00:00.000Z" });
  });

  it.each([
    ["in the past", "2020-02-09", "17:00"],
    ["in the hour the clocks skip", "2099-03-29", "01:30"],
  ])("a call-back %s → invalid", async (_label, date, time) => {
    expect(await saveJustCallOutcomeAction({ ...SAVE, outcome: "call_back_later", callBackDate: date, callBackTime: time })).toEqual({ ok: false, error: "invalid" });
    expect(h.saveJustCallOutcome).not.toHaveBeenCalled();
  });

  it("a refusal is passed on, and nothing is revalidated", async () => {
    h.saveJustCallOutcome.mockResolvedValue({ ok: false, error: "not_yours" });
    expect(await saveJustCallOutcomeAction(SAVE)).toEqual({ ok: false, error: "not_yours" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("attach, dismiss and search", () => {
  it("attach → revalidated", async () => {
    expect(await attachJustCallAction({ callSid: "CAun0001", parentUserId: P1 })).toEqual({ ok: true, value: { entryCreated: true } });
    expect(h.attachCall.mock.calls[0][1]).toEqual({ callSid: "CAun0001", parentUserId: P1 });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/calls");
  });

  it("dismiss → revalidated", async () => {
    expect(await dismissJustCallAction({ callSid: "CAun0001" })).toEqual({ ok: true, value: { replay: false } });
    expect(h.dismissCall.mock.calls[0][1]).toEqual({ callSid: "CAun0001" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/calls");
  });

  it("search → the families, and no revalidate (a read)", async () => {
    expect(await searchFamiliesForCallAction({ query: "ava" })).toEqual({ ok: true, value: [{ parentUserId: P1, name: "Ava Smith", mobile: "+44 (0) 7700 900 517" }] });
    expect(h.searchParentsForAttach.mock.calls[0][1]).toBe("ava");
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["attach", () => attachJustCallAction({ callSid: "CAun0001", parentUserId: P1 }), h.attachCall],
    ["dismiss", () => dismissJustCallAction({ callSid: "CAun0001" }), h.dismissCall],
  ])("%s refused → the code, no revalidate", async (_label, run, op) => {
    op.mockResolvedValue({ ok: false, error: "not_unmatched" });
    expect(await run()).toEqual({ ok: false, error: "not_unmatched" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("an operation that throws → error, never a thrown action", async () => {
    h.attachCall.mockRejectedValue(new Error("socket"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attachJustCallAction({ callSid: "CAun0001", parentUserId: P1 })).toEqual({ ok: false, error: "error" });
  });
});
