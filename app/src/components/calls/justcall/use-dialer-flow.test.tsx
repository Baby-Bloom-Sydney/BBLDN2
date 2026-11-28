/**
 * The dialer flow behind /admin/calls' JustCall controls (plan 05 §5 PR 05b; §9 rows 3–5; brief §0.2–0.4, §3.2–3.5):
 * Call dials and opens her drawer; Call next asks the server and does the same (or says why not); when the call it
 * dialled ends — outgoing, to her number — her drawer's form carries the JustCall line, saves with the call's sid, and
 * "Save and call next" goes on. The dialer hook, the router and the actions are mocked. BB-wave2-231126/05-build.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallPhase, DialerState } from "./use-justcall-dialer";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  nextFamilyToCallAction: vi.fn(),
  saveJustCallOutcomeAction: vi.fn(),
  dial: vi.fn(),
  state: { status: "signed_in", agent: null, call: { kind: "idle" } } as DialerState,
  enabledWith: [] as boolean[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("@/app/admin/calls/justcall-actions", () => ({ nextFamilyToCallAction: h.nextFamilyToCallAction, saveJustCallOutcomeAction: h.saveJustCallOutcomeAction }));
vi.mock("./use-justcall-dialer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-justcall-dialer")>()),
  useJustCallDialer: (enabled: boolean) => {
    h.enabledWith.push(enabled);
    return { state: h.state, dial: h.dial };
  },
}));

import { sameNumber, useDialerFlow } from "./use-dialer-flow";

const P1 = "b0500000-0000-4000-8000-000000000017";
const P2 = "b0500000-0000-4000-8000-000000000018";
const FAMILY = { parentUserId: P1, bookingId: null };
const ended = (over: Partial<Extract<CallPhase, { kind: "ended" }>> = {}): CallPhase => ({ kind: "ended", callSid: "CAab12", outbound: true, number: "+447700900517", seconds: 372, ...over });

function flow(opts: { logging?: boolean; wide?: boolean } = {}) {
  return renderHook(() => useDialerFlow({ enabled: true, wide: opts.wide ?? true, logging: opts.logging ?? true }));
}

beforeEach(() => {
  h.push.mockReset();
  h.dial.mockReset().mockReturnValue(true);
  h.nextFamilyToCallAction.mockReset().mockResolvedValue({ ok: true, value: { parentUserId: P2, mobile: "+447700900518" } });
  h.saveJustCallOutcomeAction.mockReset().mockResolvedValue({ ok: true, value: { entryId: "e-1" } });
  h.state = { status: "signed_in", agent: null, call: { kind: "idle" } };
  h.enabledWith.length = 0;
});

describe("useDialerFlow — Call (§9 row 3)", () => {
  it("the dialer runs only on a wide screen", () => {
    flow({ wide: false });
    expect(h.enabledWith.at(-1)).toBe(false);
    flow();
    expect(h.enabledWith.at(-1)).toBe(true);
  });

  it("Call: dials her E.164 and opens her drawer", () => {
    const { result } = flow();
    act(() => result.current.call({ parentUserId: P1, mobile: "+447700900517" }));
    expect(h.dial).toHaveBeenCalledWith("+447700900517");
    expect(h.push).toHaveBeenCalledWith(`/admin/calls?openCall=${P1}`, { scroll: false });
  });

  it("the dialer can't dial: her drawer still opens", () => {
    h.dial.mockReturnValue(false);
    const { result } = flow();
    act(() => result.current.call({ parentUserId: P1, mobile: "+447700900517" }));
    expect(h.push).toHaveBeenCalledWith(`/admin/calls?openCall=${P1}`, { scroll: false });
  });

  it("live: true while ringing or on a call", () => {
    const { result, rerender } = flow();
    expect(result.current.live).toBe(false);
    h.state = { ...h.state, call: { kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900517" } };
    rerender();
    expect(result.current.live).toBe(true);
  });
});

describe("useDialerFlow — after the call (§9 row 5)", () => {
  function calledThenEnded(call: CallPhase = ended(), opts: { logging?: boolean } = {}) {
    const hook = flow(opts);
    act(() => hook.result.current.call({ parentUserId: P1, mobile: "+447700900517" }));
    h.state = { ...h.state, call };
    hook.rerender();
    return hook;
  }

  it("her drawer once it ends: 'JustCall · Outgoing · 6 min 12 s · Ref CAab12', Save and call next", () => {
    const { result } = calledThenEnded();
    const form = result.current.afterCall(FAMILY);
    expect(form).toMatchObject({ saveNext: { label: "Save and call next" } });
    expect(JSON.stringify(form?.extraReadOnly)).toContain("JustCall · Outgoing · 6 min 12 s · Ref CAab12");
  });

  it("one key for the whole call — dialled, ringing, ended — so nothing typed meanwhile is lost (React H1); a new call, a new key", () => {
    const hook = flow();
    act(() => hook.result.current.call({ parentUserId: P1, mobile: "+447700900517" }));
    const dialled = hook.result.current.afterCall(FAMILY);
    expect(dialled).toMatchObject({ key: expect.any(String) });
    expect(dialled?.save).toBeUndefined();
    h.state = { ...h.state, call: { kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900517" } };
    hook.rerender();
    const ringing = hook.result.current.afterCall(FAMILY);
    expect(ringing?.key).toBe(dialled?.key);
    expect(JSON.stringify(ringing?.extraReadOnly)).toContain("JustCall · Outgoing · Ref CAab12");
    expect(ringing?.save).toBeTypeOf("function");
    h.state = { ...h.state, call: ended() };
    hook.rerender();
    expect(hook.result.current.afterCall(FAMILY)?.key).toBe(dialled?.key);
    act(() => hook.result.current.call({ parentUserId: P1, mobile: "+447700900517" }));
    expect(hook.result.current.afterCall(FAMILY)?.key).not.toBe(dialled?.key);
  });

  it("its save goes through the JustCall action with the call's sid (method JustCall, R5)", async () => {
    const { result } = calledThenEnded();
    const saved = await result.current.afterCall(FAMILY)!.save!({ parentUserId: P1, bookingId: null, result: "answered", outcome: "link_sent", note: null, callBackDate: null, callBackTime: null });
    expect(saved).toEqual({ ok: true, entryId: "e-1" });
    expect(h.saveJustCallOutcomeAction).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: P1, callSid: "CAab12", result: "answered" }));
  });

  it("Save and call next: the next family is asked for, dialled and opened", async () => {
    const { result } = calledThenEnded();
    act(() => result.current.afterCall(FAMILY)!.saveNext!.onSavedNext("e-1"));
    await waitFor(() => expect(h.push).toHaveBeenLastCalledWith(`/admin/calls?openCall=${P2}`, { scroll: false }));
    expect(h.dial).toHaveBeenLastCalledWith("+447700900518");
  });

  it("another family's drawer: nothing", () => {
    const { result } = calledThenEnded();
    expect(result.current.afterCall({ parentUserId: P2, bookingId: null })).toBeNull();
  });

  it.each([
    ["an incoming call", ended({ outbound: false })],
    ["a call to another number", ended({ number: "+447700900999" })],
    ["a call never seen ringing", ended({ number: null })],
  ])("her drawer, %s: the key only — no JustCall line, 04's save", (_label, call) => {
    const { result } = calledThenEnded(call);
    const form = result.current.afterCall(FAMILY);
    expect(form?.save).toBeUndefined();
    expect(form?.extraReadOnly).toBeUndefined();
  });

  it("no after-call form with logging off (its save is logging's)", () => {
    const { result } = calledThenEnded(ended(), { logging: false });
    expect(result.current.afterCall(FAMILY)).toBeNull();
  });

  it("nothing dialled here (BAI dialled in the frame): no after-call form", () => {
    const { result, rerender } = flow();
    h.state = { ...h.state, call: ended() };
    rerender();
    expect(result.current.afterCall(FAMILY)).toBeNull();
  });

  it("a dial that failed doesn't count as dialled, and says so (React M4)", () => {
    h.dial.mockReturnValue(false);
    const { result } = calledThenEnded();
    expect(result.current.afterCall(FAMILY)).toBeNull();
    expect(result.current.nextLine).toBe("Her details are open; the number isn't in the dialer — use the phone link.");
  });
});

describe("useDialerFlow — Call next (§9 row 4)", () => {
  it("asks the server, then dials and opens that family", async () => {
    const { result } = flow();
    await act(() => result.current.callNext());
    expect(h.nextFamilyToCallAction).toHaveBeenCalledWith({});
    expect(h.dial).toHaveBeenCalledWith("+447700900518");
    expect(h.push).toHaveBeenCalledWith(`/admin/calls?openCall=${P2}`, { scroll: false });
    expect(result.current.nextLine).toBe("");
  });

  it("none left → 'No one left to call right now.', nothing dialled", async () => {
    h.nextFamilyToCallAction.mockResolvedValue({ ok: true, value: null });
    const { result } = flow();
    await act(() => result.current.callNext());
    expect(result.current.nextLine).toBe("No one left to call right now.");
    expect(h.dial).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("a refusal or a throw → one line, nothing dialled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.nextFamilyToCallAction.mockResolvedValueOnce({ ok: false, error: "error" }).mockRejectedValueOnce(new Error("x"));
    const { result } = flow();
    await act(() => result.current.callNext());
    expect(result.current.nextLine).toBe("The next family couldn't be found — try again.");
    await act(() => result.current.callNext());
    expect(result.current.nextLine).toBe("The next family couldn't be found — try again.");
    expect(h.dial).not.toHaveBeenCalled();
  });

  it("one at a time: a second press while the first is out does nothing; busy meanwhile", async () => {
    let answer: (v: unknown) => void = () => {};
    h.nextFamilyToCallAction.mockImplementation(() => new Promise((r) => (answer = r)));
    const { result } = flow();
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.callNext();
    });
    expect(result.current.nextBusy).toBe(true);
    await act(() => result.current.callNext());
    expect(h.nextFamilyToCallAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ ok: true, value: null });
      await first;
    });
    expect(result.current.nextBusy).toBe(false);
  });
});

describe("useDialerFlow — after the reviews", () => {
  it("a call that goes live while Call next asks: nothing moves, it says so (TS M1, code L3)", async () => {
    let answer: (v: unknown) => void = () => {};
    h.nextFamilyToCallAction.mockImplementation(() => new Promise((r) => (answer = r)));
    const { result, rerender } = flow();
    let asked: Promise<void> = Promise.resolve();
    act(() => {
      asked = result.current.callNext();
    });
    h.state = { ...h.state, call: { kind: "ringing", callSid: "CAin1", outbound: false, number: "+447700900599" } };
    rerender();
    await act(async () => {
      answer({ ok: true, value: { parentUserId: P2, mobile: "+447700900518" } });
      await asked;
    });
    expect(h.push).not.toHaveBeenCalled();
    expect(h.dial).not.toHaveBeenCalled();
    expect(result.current.nextLine).toBe("On a call");
  });

  it("Call next says whom it opened (React H2)", async () => {
    const { result } = flow();
    await act(() => result.current.callNext());
    expect(result.current.nextLine).toBe("");
    expect(result.current.announce).toMatch(/opened/i);
  });

  it("the screen narrowing during a call keeps the dialer until it ends (code L4)", () => {
    const { result, rerender } = renderHook(({ wide }) => useDialerFlow({ enabled: true, wide, logging: true }), { initialProps: { wide: true } });
    h.state = { ...h.state, call: { kind: "on_call", callSid: "CAab12", outbound: true, number: "+447700900517" } };
    rerender({ wide: true });
    rerender({ wide: false });
    expect(h.enabledWith.at(-1)).toBe(true);
    expect(result.current.wide).toBe(true);
    h.state = { ...h.state, call: ended() };
    rerender({ wide: false });
    rerender({ wide: false });
    expect(h.enabledWith.at(-1)).toBe(false);
    expect(result.current.wide).toBe(false);
  });
});

describe("sameNumber", () => {
  it.each([
    ["+447700900517", "7700900517", true],
    ["+447700900517", "+447700900517", true],
    ["+447700900517", "447700900517", true],
    ["+447700900517", "07700 900517", true],
    ["+447700900517", "0044 7700 900517", true],
    ["+447700900517", "+447700900518", false],
    ["+447700900517", "", false],
  ])("%s vs %s → %s", (a, b, same) => {
    expect(sameNumber(a, b)).toBe(same);
  });
});
