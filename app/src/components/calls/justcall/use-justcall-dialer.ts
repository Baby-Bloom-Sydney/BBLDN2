/**
 * The JustCall dialer (plan 05 §5 PR 05b C3; brief §0.1, §3.1–3.3). BB-wave2-231126/05-build.
 *
 * Client only. While `enabled` (the dialer switch on and a wide screen): the SDK is loaded with a dynamic `import()`,
 * one instance is made in the element `DIALER_MOUNT_ID` (its frame comes from `https://app.justcall.io`), `ready()` is
 * awaited and JustCall is asked whether someone is signed in. Its sign-in and call events become one state:
 *   status  off · loading · signed_out ("Sign in to JustCall") · signed_in (with who, once JustCall says) · failed
 *   call    idle · ringing · on_call · ended {seconds} — each with the call's sid, whether it is outgoing, her number
 * `dial(number)` puts a number into the dialer, only when signed in and no call is live. The state lives here, once,
 * so the Call controls in the rows stay stateless. Turning it off (or unmounting) unsubscribes and destroys the
 * instance; StrictMode's second mount, and away-and-back, leave one.
 *
 * What the SDK (1.4.2) doesn't do, done here (ledger B05 §0): it reads every `message` on the page with no origin
 * check, so `guardDialerMessages` stops a dialer-shaped message from any other origin — or, once the frame exists, from
 * any window but the frame — before it (a capture listener on `window` runs before the SDK's own at the target, in
 * current Chrome, Firefox and Safari, and it is added first anyway); its `destroy()` keeps
 * that listener and its own copy of the sign-in callbacks, so a destroyed instance's callbacks are ignored; its
 * `isLoggedIn()` has no time limit, so the check (and the frame's load) is bounded; and every event's fields are
 * checked before they are used.
 *
 * The SDK is imported only behind `process.env.JUSTCALL_ENABLED === "true"`, which the build inlines: a build with the
 * dialer switch off holds no SDK chunk at all (plan §9 row 1).
 */

import { useEffect, useReducer, useRef } from "react";
import { CALL_SID_PATTERN } from "@/lib/justcall/types";
import { DIALER_COPY } from "@/lib/justcall/words";

export const DIALER_MOUNT_ID = "justcall-dialer";
export const JUSTCALL_ORIGIN = "https://app.justcall.io";
const LOGIN_CHECK_MS = 10_000;
const READY_MS = 30_000;
const MAX_CALL_SECONDS = 24 * 60 * 60;
const MAX_NUMBER_CHARS = 40;

type DialerSdk = typeof import("@justcall/justcall-dialer-sdk");
type SdkDialer = InstanceType<DialerSdk["JustCallDialer"]>;

export type DialerStatus = "off" | "loading" | "signed_out" | "signed_in" | "failed";
export interface CallFacts {
  readonly callSid: string;
  readonly outbound: boolean;
  /** Her number: who was rung (outgoing) or who rang (incoming); null if the call was never seen ringing. */
  readonly number: string | null;
}
export type CallPhase =
  | { readonly kind: "idle" }
  | ({ readonly kind: "ringing" | "on_call" } & CallFacts)
  | ({ readonly kind: "ended"; readonly seconds: number } & CallFacts);
export interface DialerState {
  readonly status: DialerStatus;
  /** Who is signed in to JustCall (email, else name), once JustCall says. */
  readonly agent: string | null;
  readonly call: CallPhase;
}
export interface Dialer {
  readonly state: DialerState;
  /** Puts a number into the dialer: false when not signed in, a call is live, or JustCall refuses. */
  readonly dial: (number: string) => boolean;
}
export interface DialerOptions {
  readonly load?: () => Promise<DialerSdk | null>;
  readonly loginCheckMs?: number;
  readonly readyMs?: number;
}

const IDLE: CallPhase = { kind: "idle" };
const OFF: DialerState = { status: "off", agent: null, call: IDLE };

type Action =
  | { readonly type: "off" | "start" | "failed" | "logout" | "dialed" }
  | { readonly type: "ready"; readonly loggedIn: boolean }
  | { readonly type: "login"; readonly agent: string | null }
  | ({ readonly type: "ringing" } & CallFacts)
  | { readonly type: "answered"; readonly callSid: string; readonly outbound: boolean }
  | { readonly type: "ended"; readonly callSid: string; readonly outbound: boolean; readonly seconds: number };

export function callIsLive(call: CallPhase): boolean {
  return call.kind === "ringing" || call.kind === "on_call";
}

/** Her number from the call before, when it is the same call. */
const numberOf = (call: CallPhase, callSid: string): string | null => (call.kind !== "idle" && call.callSid === callSid ? call.number : null);

/** While a call is live, an answer or end for another call is not this call's (a stray or late event). */
function otherCall(state: DialerState, callSid: string): boolean {
  return callIsLive(state.call) && state.call.kind !== "idle" && state.call.callSid !== callSid;
}

function reduce(state: DialerState, action: Action): DialerState {
  switch (action.type) {
    case "off":
      return OFF;
    case "start":
      return { ...OFF, status: "loading" };
    case "failed":
      return { ...state, status: "failed" };
    case "ready":
      return state.status === "signed_in" ? state : { ...state, status: action.loggedIn ? "signed_in" : "signed_out" };
    case "login":
      return { ...state, status: "signed_in", agent: action.agent };
    case "logout":
      return { ...state, status: "signed_out", agent: null };
    case "dialed":
      return { ...state, call: IDLE };
    case "ringing":
      return { ...state, call: { kind: "ringing", callSid: action.callSid, outbound: action.outbound, number: action.number } };
    case "answered":
      if (otherCall(state, action.callSid)) return state;
      return { ...state, call: { kind: "on_call", callSid: action.callSid, outbound: action.outbound, number: numberOf(state.call, action.callSid) } };
    case "ended":
      if (otherCall(state, action.callSid)) return state;
      return { ...state, call: { kind: "ended", callSid: action.callSid, outbound: action.outbound, number: numberOf(state.call, action.callSid), seconds: action.seconds } };
    default:
      return unreachable(action);
  }
}

function unreachable(action: never): never {
  throw new Error(`unknown dialer action ${JSON.stringify(action)}`);
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null);
const sidOf = (value: unknown): string | null => (typeof value === "string" && CALL_SID_PATTERN.test(value) ? value : null);
const outboundOf = (value: unknown): boolean | null => (value === "outbound" ? true : value === "inbound" ? false : null);
const numberText = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= MAX_NUMBER_CHARS ? value : null);

function ringingAction(data: unknown): Action | null {
  const d = record(data);
  const callSid = sidOf(d?.call_sid);
  const outbound = outboundOf(d?.direction);
  if (d === null || callSid === null || outbound === null) return null;
  return { type: "ringing", callSid, outbound, number: numberText(outbound ? d.to : d.from) };
}

function answeredAction(data: unknown): Action | null {
  const d = record(data);
  const callSid = sidOf(d?.call_sid);
  const outbound = outboundOf(d?.direction);
  return callSid === null || outbound === null ? null : { type: "answered", callSid, outbound };
}

function endedAction(data: unknown): Action | null {
  const d = record(data);
  const callSid = sidOf(d?.call_sid);
  const outbound = outboundOf(d?.direction);
  const duration = d?.duration;
  if (callSid === null || outbound === null || typeof duration !== "number" || !Number.isFinite(duration)) return null;
  if (duration < 0 || duration > MAX_CALL_SECONDS) return null;
  return { type: "ended", callSid, outbound, seconds: Math.round(duration) };
}

/** A short non-empty text, trimmed; null otherwise. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 200) : null;
}

function loginAction(data: unknown): Action {
  const info = record(record(data)?.user_info);
  return { type: "login", agent: textOf(info?.email) ?? textOf(info?.name) };
}

const DIALER_EVENTS: ReadonlySet<string> = new Set(["call-ringing", "call-answered", "call-ended", "sms-received", "logged-in-status", "is-logged-in"]);

/** The window of JustCall's frame in the mount, once the SDK has made it. */
function mountedFrame(): Window | null {
  return document.getElementById(DIALER_MOUNT_ID)?.querySelector("iframe")?.contentWindow ?? null;
}

/**
 * Stops a dialer-shaped message (`{name: <a dialer event>}`) before later listeners — the SDK's among them — see it,
 * unless it comes from JustCall's origin and, once the frame exists (`frame()`), from the frame itself. Every other
 * message passes. Returns the undo.
 */
export function guardDialerMessages(target: Window, frame: () => Window | null = () => null): () => void {
  const guard = (event: MessageEvent) => {
    const name = record(event.data)?.name;
    if (typeof name !== "string" || !DIALER_EVENTS.has(name)) return;
    const ours = frame();
    if (event.origin !== JUSTCALL_ORIGIN || (ours !== null && event.source !== ours)) event.stopImmediatePropagation();
  };
  target.addEventListener("message", guard, true);
  return () => target.removeEventListener("message", guard, true);
}

/** The SDK, only in a build with the dialer switch on: the build drops this `import()` (and its chunk) otherwise. */
export function loadDialerSdk(): Promise<DialerSdk | null> {
  if (process.env.JUSTCALL_ENABLED === "true") {
    return import("@justcall/justcall-dialer-sdk");
  }
  return Promise.resolve(null);
}

/** A promise's answer, or `fallback` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

interface Session {
  alive: boolean;
  dialer: SdkDialer | null;
  /** Hands the instance to `dial` while this session is the live one. */
  readonly keep: (dialer: SdkDialer) => void;
}

function listen(dialer: SdkDialer, send: (a: Action) => void): void {
  const on = (event: "call-ringing" | "call-answered" | "call-ended", toAction: (d: unknown) => Action | null) =>
    dialer.on(event, (data: unknown) => {
      const action = toAction(data);
      if (action !== null) send(action);
    });
  on("call-ringing", ringingAction);
  on("call-answered", answeredAction);
  on("call-ended", endedAction);
}

async function startDialer(session: Session, send: (a: Action) => void, options: DialerOptions): Promise<void> {
  try {
    const sdk = await (options.load ?? loadDialerSdk)();
    if (!session.alive) return;
    if (sdk === null) return send({ type: "off" });
    const dialer = new sdk.JustCallDialer({ dialerId: DIALER_MOUNT_ID, onLogin: (d) => send(loginAction(d)), onLogout: () => send({ type: "logout" }) });
    session.dialer = dialer;
    session.keep(dialer);
    document.getElementById(DIALER_MOUNT_ID)?.querySelector("iframe")?.setAttribute("title", DIALER_COPY.title);
    listen(dialer, send);
    const loaded = await within(dialer.ready().then(() => true), options.readyMs ?? READY_MS, false);
    if (!session.alive) return;
    if (!loaded) return send({ type: "failed" });
    send({ type: "ready", loggedIn: await within(dialer.isLoggedIn(), options.loginCheckMs ?? LOGIN_CHECK_MS, false) });
  } catch (thrown) {
    console.error("[justcall/dialer] the dialer didn't start", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    send({ type: "failed" });
  }
}

function stopDialer(dialer: SdkDialer | null): void {
  if (dialer === null) return;
  try {
    dialer.unsubscribeAll();
    dialer.destroy();
  } catch (thrown) {
    console.error("[justcall/dialer] the dialer didn't stop cleanly", { name: thrown instanceof Error ? thrown.name : typeof thrown });
  }
}

export function useJustCallDialer(enabled: boolean, options: DialerOptions = {}): Dialer {
  const [state, send] = useReducer(reduce, OFF);
  const current = useRef<SdkDialer | null>(null);
  // `dial` reads the latest state, so one taken before a call went live (a callback run after an await) still refuses.
  const latest = useRef(state);
  latest.current = state;
  const opts = useRef(options);
  opts.current = options;
  useEffect(() => {
    if (!enabled) return send({ type: "off" });
    const session: Session = { alive: true, dialer: null, keep: (dialer) => (current.current = dialer) };
    const live = (action: Action) => {
      if (session.alive) send(action);
    };
    const unguard = guardDialerMessages(window, mountedFrame);
    send({ type: "start" });
    void startDialer(session, live, opts.current);
    return () => {
      session.alive = false;
      unguard();
      stopDialer(session.dialer);
      if (current.current === session.dialer) current.current = null;
    };
  }, [enabled]);
  const dial = (number: string): boolean => {
    const dialer = current.current;
    if (dialer === null || latest.current.status !== "signed_in" || callIsLive(latest.current.call)) return false;
    try {
      dialer.dialNumber(number);
    } catch (thrown) {
      console.error("[justcall/dialer] the dialer refused the number", { name: thrown instanceof Error ? thrown.name : typeof thrown });
      return false;
    }
    send({ type: "dialed" });
    return true;
  };
  return { state, dial };
}
