/**
 * The JustCall dialer hook (plan 05 §5 PR 05b C3; §9 row 2; brief §0.1, §3.1–3.3), with the SDK mocked: one instance
 * at a time, `ready()` awaited, the sign-in state (bounded), the call events (checked), `dial()` only when signed in and
 * no call is live, torn down on unmount, StrictMode-safe, and the page's messages guarded by origin.
 * BB-wave2-231126/05-build.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (data: unknown) => void;
interface Props {
  readonly dialerId: string;
  readonly onLogin?: (d: unknown) => void;
  readonly onLogout?: () => void;
}

const sdk = vi.hoisted(() => {
  const instances: FakeDialer[] = [];
  class FakeDialer {
    readonly props: Props;
    readonly handlers = new Map<string, Handler>();
    readonly dialed: string[] = [];
    destroyed = false;
    unsubscribedAll = 0;
    answerLogin: ((loggedIn: boolean) => void) | null = null;
    private openReady: () => void = () => {};
    private readonly readyAt: Promise<void>;
    constructor(props: Props) {
      this.props = props;
      this.readyAt = new Promise((resolve) => (this.openReady = resolve));
      instances.push(this);
    }
    ready() {
      return this.readyAt;
    }
    loaded() {
      this.openReady();
    }
    isLoggedIn() {
      return new Promise<boolean>((resolve) => (this.answerLogin = resolve));
    }
    on(event: string, cb: Handler) {
      this.handlers.set(event, cb);
    }
    unsubscribeAll() {
      this.unsubscribedAll += 1;
      this.handlers.clear();
    }
    dialNumber(n: string) {
      this.dialed.push(n);
    }
    destroy() {
      this.destroyed = true;
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(data);
    }
  }
  return { instances, FakeDialer };
});
vi.mock("@justcall/justcall-dialer-sdk", () => ({ JustCallDialer: sdk.FakeDialer }));

import { callIsLive, DIALER_MOUNT_ID, guardDialerMessages, JUSTCALL_ORIGIN, loadDialerSdk, useJustCallDialer } from "./use-justcall-dialer";

const live = () => sdk.instances.filter((d) => !d.destroyed);
const last = () => sdk.instances[sdk.instances.length - 1];

/** Mount, let the frame load and answer the sign-in check. */
async function signIn(loggedIn: boolean) {
  await waitFor(() => expect(sdk.instances.length).toBeGreaterThan(0));
  await act(async () => last().loaded());
  await waitFor(() => expect(last().answerLogin).not.toBeNull());
  await act(async () => last().answerLogin?.(loggedIn));
}

beforeEach(() => {
  sdk.instances.length = 0;
  vi.stubEnv("JUSTCALL_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useJustCallDialer — mounting (§9 row 2)", () => {
  it("off: no SDK, no instance", () => {
    const { result } = renderHook(() => useJustCallDialer(false));
    expect(result.current.state.status).toBe("off");
    expect(sdk.instances).toHaveLength(0);
  });

  it("on: one instance in the dialer's mount, loading until the frame is ready, then 'Sign in' when signed out", async () => {
    const { result } = renderHook(() => useJustCallDialer(true));
    await waitFor(() => expect(sdk.instances).toHaveLength(1));
    expect(last().props.dialerId).toBe(DIALER_MOUNT_ID);
    expect(result.current.state.status).toBe("loading");
    await signIn(false);
    expect(result.current.state).toMatchObject({ status: "signed_out", agent: null });
  });

  it("signed in already: 'signed_in'; onLogin names who; onLogout goes back to signed out", async () => {
    const { result } = renderHook(() => useJustCallDialer(true));
    await signIn(true);
    expect(result.current.state.status).toBe("signed_in");
    act(() => last().props.onLogin?.({ logged_in: true, login_numbers: [], user_info: { email: "agent@example.test", name: "Agent" } }));
    expect(result.current.state).toMatchObject({ status: "signed_in", agent: "agent@example.test" });
    act(() => last().props.onLogout?.());
    expect(result.current.state).toMatchObject({ status: "signed_out", agent: null });
  });

  it("a sign-in that lands while the check is out is kept when the check says no", async () => {
    const { result } = renderHook(() => useJustCallDialer(true));
    await waitFor(() => expect(sdk.instances).toHaveLength(1));
    await act(async () => last().loaded());
    act(() => last().props.onLogin?.({ logged_in: true, login_numbers: [], user_info: { email: "", name: "Agent" } }));
    await act(async () => last().answerLogin?.(false));
    expect(result.current.state).toMatchObject({ status: "signed_in", agent: "Agent" });
  });

  it("the frame never answers the sign-in check → 'Sign in' after the limit, never stuck", async () => {
    const { result } = renderHook(() => useJustCallDialer(true, { loginCheckMs: 20 }));
    await waitFor(() => expect(sdk.instances).toHaveLength(1));
    await act(async () => last().loaded());
    await waitFor(() => expect(result.current.state.status).toBe("signed_out"));
  });

  it("the frame never loads → failed after the limit", async () => {
    const { result } = renderHook(() => useJustCallDialer(true, { readyMs: 20 }));
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
  });

  it("the SDK can't be loaded → failed, nothing thrown", async () => {
    const { result } = renderHook(() => useJustCallDialer(true, { load: () => Promise.reject(new Error("chunk")) }));
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
  });

  it("unmount: unsubscribeAll and destroy, once", async () => {
    const { unmount } = renderHook(() => useJustCallDialer(true));
    await signIn(false);
    unmount();
    expect(last()).toMatchObject({ destroyed: true, unsubscribedAll: 1 });
  });

  it("StrictMode: mounted twice, loaded twice, one instance", async () => {
    // The loader is handed in here: under StrictMode the two `import()`s run at once, and vitest's mocker then hands
    // the second one the real package (seen while building; webpack has no such step). The lifecycle is what's tested.
    const load = vi.fn(async () => ({ JustCallDialer: sdk.FakeDialer }) as never);
    const wrapper = ({ children }: { readonly children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(() => useJustCallDialer(true, { load }), { wrapper });
    await waitFor(() => expect(sdk.instances).toHaveLength(1));
    expect(load).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
  });

  it("away and back: the old frame is destroyed, one new one, one live", async () => {
    const { rerender } = renderHook(({ on }) => useJustCallDialer(on), { initialProps: { on: true } });
    await signIn(true);
    rerender({ on: false });
    expect(sdk.instances[0].destroyed).toBe(true);
    rerender({ on: true });
    await waitFor(() => expect(sdk.instances).toHaveLength(2));
    expect(live()).toEqual([sdk.instances[1]]);
  });

  it("a destroyed instance's late sign-in (the SDK keeps its listener) changes nothing", async () => {
    const { result, rerender } = renderHook(({ on }) => useJustCallDialer(on), { initialProps: { on: true } });
    await signIn(false);
    const old = last();
    rerender({ on: false });
    act(() => old.props.onLogin?.({ logged_in: true, login_numbers: [], user_info: { email: "x@example.test", name: "X" } }));
    expect(result.current.state).toMatchObject({ status: "off", agent: null });
  });

  it("a build without the dialer switch has no SDK to load: off", async () => {
    vi.stubEnv("JUSTCALL_ENABLED", "");
    expect(await loadDialerSdk()).toBeNull();
    const { result } = renderHook(() => useJustCallDialer(true));
    await waitFor(() => expect(result.current.state.status).toBe("off"));
    expect(sdk.instances).toHaveLength(0);
  });
});

describe("useJustCallDialer — the call (§9 rows 3, 5)", () => {
  async function signedIn() {
    const hook = renderHook(() => useJustCallDialer(true));
    await signIn(true);
    return hook;
  }

  it("ringing → on call → ended, with the sid, the direction, her number and the seconds", async () => {
    const { result } = await signedIn();
    act(() => last().emit("call-ringing", { direction: "outbound", from: "+442000000000", to: "+447700900123", call_sid: "CAab12" }));
    expect(result.current.state.call).toEqual({ kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900123" });
    expect(callIsLive(result.current.state.call)).toBe(true);
    act(() => last().emit("call-answered", { call_sid: "CAab12", direction: "outbound", answered_status: "answered" }));
    expect(result.current.state.call).toMatchObject({ kind: "on_call", callSid: "CAab12", number: "+447700900123" });
    act(() => last().emit("call-ended", { call_sid: "CAab12", direction: "outbound", duration: 372 }));
    expect(result.current.state.call).toEqual({ kind: "ended", callSid: "CAab12", outbound: true, number: "+447700900123", seconds: 372 });
    expect(callIsLive(result.current.state.call)).toBe(false);
  });

  it("an incoming call is not outbound and carries the caller's number", async () => {
    const { result } = await signedIn();
    act(() => last().emit("call-ringing", { direction: "inbound", from: "+447700900599", to: "+442000000000", call_sid: "CAin1" }));
    expect(result.current.state.call).toMatchObject({ outbound: false, number: "+447700900599" });
  });

  it("an end for a call it never saw ringing has no number", async () => {
    const { result } = await signedIn();
    act(() => last().emit("call-ended", { call_sid: "CAother", direction: "outbound", duration: 5 }));
    expect(result.current.state.call).toEqual({ kind: "ended", callSid: "CAother", outbound: true, number: null, seconds: 5 });
  });

  it.each([
    ["a sid that isn't one", "call-ringing", { direction: "outbound", from: "a", to: "b", call_sid: "CA bad;" }],
    ["no sid", "call-answered", { direction: "outbound" }],
    ["a negative length", "call-ended", { call_sid: "CAab12", direction: "outbound", duration: -1 }],
    ["a length that isn't a number", "call-ended", { call_sid: "CAab12", direction: "outbound", duration: "372" }],
    ["a direction that isn't one", "call-ringing", { direction: "sideways", from: "a", to: "b", call_sid: "CAab12" }],
    ["no data", "call-ended", null],
  ])("an event with %s is ignored", async (_label, event, data) => {
    const { result } = await signedIn();
    act(() => last().emit(event, data));
    expect(result.current.state.call).toEqual({ kind: "idle" });
  });

  it("dial: signed in and no call live → the SDK dials, the last call is cleared", async () => {
    const { result } = await signedIn();
    act(() => last().emit("call-ended", { call_sid: "CAold", direction: "outbound", duration: 3 }));
    let dialled = false;
    act(() => {
      dialled = result.current.dial("+447700900123");
    });
    expect(dialled).toBe(true);
    expect(last().dialed).toEqual(["+447700900123"]);
    expect(result.current.state.call).toEqual({ kind: "idle" });
  });

  it("dial: refused while signed out, and while a call is live", async () => {
    const { result } = renderHook(() => useJustCallDialer(true));
    await signIn(false);
    expect(result.current.dial("+447700900123")).toBe(false);
    act(() => last().props.onLogin?.({ logged_in: true, login_numbers: [], user_info: { email: "a@example.test", name: "A" } }));
    act(() => last().emit("call-ringing", { direction: "outbound", from: "x", to: "+447700900111", call_sid: "CAlive" }));
    expect(result.current.dial("+447700900123")).toBe(false);
    expect(last().dialed).toEqual([]);
  });

  it("dial: the SDK refusing (not ready) is a false, never a throw", async () => {
    const { result } = await signedIn();
    vi.spyOn(last(), "dialNumber").mockImplementation(() => {
      throw new Error("dialer_not_ready");
    });
    expect(result.current.dial("+447700900123")).toBe(false);
  });
});

describe("guardDialerMessages — JustCall's frame only", () => {
  function listen() {
    const later = vi.fn();
    window.addEventListener("message", later);
    return { later, done: () => window.removeEventListener("message", later) };
  }
  const post = (data: unknown, origin: string) => window.dispatchEvent(new MessageEvent("message", { data, origin }));

  it("a dialer-shaped message from another origin stops before the SDK's listener; JustCall's own passes", () => {
    const unguard = guardDialerMessages(window);
    const { later, done } = listen();
    post({ name: "call-ended", data: { call_sid: "CAfake", duration: 1 } }, "https://other.example");
    expect(later).not.toHaveBeenCalled();
    post({ name: "call-ended", data: { call_sid: "CAab12", duration: 1 } }, JUSTCALL_ORIGIN);
    expect(later).toHaveBeenCalledTimes(1);
    unguard();
    done();
  });

  it("every other message passes, from anywhere", () => {
    const unguard = guardDialerMessages(window);
    const { later, done } = listen();
    post("hello", "https://other.example");
    post({ type: "something-else" }, "https://other.example");
    expect(later).toHaveBeenCalledTimes(2);
    unguard();
    done();
  });

  it("the hook guards while it is on, and stops guarding once off", async () => {
    const { rerender } = renderHook(({ on }) => useJustCallDialer(on), { initialProps: { on: true } });
    await signIn(false);
    const { later, done } = listen();
    post({ name: "logged-in-status", data: { logged_in: true } }, "https://other.example");
    expect(later).not.toHaveBeenCalled();
    rerender({ on: false });
    post({ name: "logged-in-status", data: { logged_in: true } }, "https://other.example");
    expect(later).toHaveBeenCalledTimes(1);
    done();
  });
});
