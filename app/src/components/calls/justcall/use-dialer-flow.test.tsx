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

  it("her drawer: keyed by the call, with 'JustCall · Outgoing · 6 min 12 s · Ref CAab12'", () => {
    const { result } = calledThenEnded();
    const form = result.current.afterCall(FAMILY);
    expect(form).toMatchObject({ key: "CAab12", saveNext: { label: "Save and call next" } });
    expect(form?.extraReadOnly).toBeTruthy();
    expect(JSON.stringify(form?.extraReadOnly)).toContain("JustCall · Outgoing · 6 min 12 s · Ref CAab12");
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

  it.each([
    ["another family's drawer", { parentUserId: P2, bookingId: null }, ended()],
    ["a call still ringing", FAMILY, { kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900517" } as CallPhase],
    ["an incoming call", FAMILY, ended({ outbound: false })],
    ["a call to another number", FAMILY, ended({ number: "+447700900999" })],
    ["a call never seen ringing", FAMILY, ended({ number: null })],
  ])("no after-call form for %s", (_label, family, call) => {
    const { result } = calledThenEnded(call);
    expect(result.current.afterCall(family)).toBeNull();
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

  it("a dial that failed doesn't count as dialled", () => {
    h.dial.mockReturnValue(false);
    const { result } = calledThenEnded();
    expect(result.current.afterCall(FAMILY)).toBeNull();
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

describe("sameNumber", () => {
  it.each([
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
