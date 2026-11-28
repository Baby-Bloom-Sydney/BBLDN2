"use client";

/**
 * The dialer flow behind /admin/calls' JustCall controls (plan 05 §5 PR 05b; brief §0.2–0.4, §3.2–3.5).
 * BB-wave2-231126/05-build.
 *
 * One place, used by `JustCallCallsClient` and shared with the controls through `DialerFlowContext` (so the Call
 * control drawn twice per row — table and phone card — holds no state of its own):
 *   - `call(her)`: put her mobile into the dialer (when it can dial) and open her drawer (`?openCall=`).
 *   - `callNext()`: ask the server for the next family (R11), then `call` her; or say "No one left to call right now."
 *     One request at a time.
 *   - `afterCall(family)`: for her drawer, once the call it dialled has ended — outgoing, to the number it dialled — the
 *     outcome form with "JustCall · Outgoing · 6 min 12 s · Ref CA…", saving through 05a-2's JustCall save with that
 *     sid (method JustCall), and "Save and call next". Any other drawer, call or number: 04's form as it is. Only with
 *     logging on, whose action the save is (the ratified order turns logging on before the dialer).
 *   - `live`: a call is ringing or on (the family links then open in a new tab).
 * The dialer itself runs only on a wide screen (`lg`); on a phone, Call is 04's phone link and Call next opens her drawer.
 */

import { createContext, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nextFamilyToCallAction } from "@/app/admin/calls/justcall-actions";
import type { AfterCall, AfterCallForm } from "@/app/admin/calls/CallRowPanel";
import { afterCallLine, DIALER_COPY } from "@/lib/justcall/words";
import { saveFor } from "./AddOutcome";
import { callIsLive, useJustCallDialer, type CallPhase, type Dialer, type DialerState } from "./use-justcall-dialer";

const PAGE = "/admin/calls";

export interface CallTarget {
  readonly parentUserId: string;
  /** E.164. */
  readonly mobile: string;
}

export interface DialerFlow {
  readonly dialer: Dialer;
  readonly live: boolean;
  /** The screen counts as wide: it is, or a call is on (narrowing the window mid-call keeps the dialer). */
  readonly wide: boolean;
  readonly call: (target: CallTarget) => void;
  readonly callNext: () => Promise<void>;
  /** The flow's last word to BAI ("No one left to call right now.", "On a call", the number not dialled), or "". */
  readonly nextLine: string;
  /** Said to a screen reader only: what Call next opened. */
  readonly announce: string;
  readonly nextBusy: boolean;
  readonly afterCall: AfterCall;
}

export const DialerFlowContext = createContext<DialerFlow | null>(null);

export function useDialerFlowContext(): DialerFlow | null {
  return useContext(DialerFlowContext);
}

/** A number's digits in international form: `+44…`, `44…`, `0044…`, `07…` and `7…` (UK) all read the same. */
function digitsOf(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return `44${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 10) return `44${digits}`;
  return digits;
}

export function sameNumber(a: string, b: string): boolean {
  const x = digitsOf(a);
  return x !== "" && x === digitsOf(b);
}

/** The call it dialled for this family. `n` counts the dials, so each new call keys a fresh form. */
interface Dialled {
  readonly target: CallTarget;
  readonly n: number;
}

/**
 * Her drawer's form while the call it dialled for her lasts: one key from the dial to the end (nothing typed during the
 * call is lost), and — once JustCall reports that call, outgoing, to her number — the JustCall line (its length once it
 * has ended), the save bound to its sid and "Save and call next". Any other family: none.
 */
function afterCallFor(call: CallPhase, dialled: Dialled | null, family: Parameters<AfterCall>[0], callNext: () => Promise<void>): AfterCallForm | null {
  if (dialled === null || dialled.target.parentUserId !== family.parentUserId) return null;
  const key = `dialled-${dialled.n}`;
  if (call.kind === "idle" || !call.outbound || call.number === null || !sameNumber(call.number, dialled.target.mobile)) return { key };
  const seconds = call.kind === "ended" ? call.seconds : null;
  return {
    key,
    extraReadOnly: <p className="text-xs text-slate-600">{afterCallLine({ outbound: true, seconds, callSid: call.callSid })}</p>,
    save: saveFor(call.callSid),
    // `callNext` catches everything itself, so the promise it returns never rejects.
    saveNext: { label: DIALER_COPY.saveAndCallNext, onSavedNext: () => void callNext() },
  };
}

interface CallNextParts {
  /** The latest `call` and dialer state: Call next uses them after its request, not the ones from when it began. */
  readonly callRef: { readonly current: (target: CallTarget) => void };
  readonly latest: { readonly current: DialerState };
  readonly setLine: (line: string) => void;
  readonly setAnnounce: (line: string) => void;
}

function useCallNext({ callRef, latest, setLine, setAnnounce }: CallNextParts) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const callNext = async () => {
    if (inFlight.current) return;
    if (callIsLive(latest.current.call)) return setLine(DIALER_COPY.onACall);
    inFlight.current = true;
    setBusy(true);
    setLine("");
    setAnnounce("");
    try {
      const next = await nextFamilyToCallAction({});
      if (!next.ok) return setLine(DIALER_COPY.callNextFailed);
      if (next.value === null) return setLine(DIALER_COPY.noOneLeft);
      if (callIsLive(latest.current.call)) return setLine(DIALER_COPY.onACall);
      callRef.current(next.value);
      setAnnounce(DIALER_COPY.openedNext);
    } catch (thrown) {
      console.error("[justcall/call-next] the next family couldn't be asked for", { name: thrown instanceof Error ? thrown.name : typeof thrown });
      setLine(DIALER_COPY.callNextFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { callNext, nextBusy: busy };
}

export interface DialerFlowOptions {
  /** The dialer switch. */
  readonly enabled: boolean;
  /** A screen wide enough for the dialer (`lg`). */
  readonly wide: boolean;
  /** The logging switch: the after-call save is its action. */
  readonly logging: boolean;
}

export function useDialerFlow({ enabled, wide, logging }: DialerFlowOptions): DialerFlow {
  const router = useRouter();
  // Kept through a narrowing window while a call is on (read from the last render; written below, each render).
  const wasLive = useRef(false);
  const keepWide = wide || wasLive.current;
  const dialer = useJustCallDialer(enabled && keepWide);
  const live = callIsLive(dialer.state.call);
  wasLive.current = live;
  const latest = useRef(dialer.state);
  latest.current = dialer.state;
  const counter = useRef(0);
  const [dialled, setDialled] = useState<Dialled | null>(null);
  const [line, setLine] = useState("");
  const [announce, setAnnounce] = useState("");
  const call = (target: CallTarget) => {
    if (dialer.dial(target.mobile)) {
      counter.current += 1;
      setDialled({ target, n: counter.current });
      setLine("");
    } else setLine(DIALER_COPY.notDialled);
    router.push(`${PAGE}?openCall=${encodeURIComponent(target.parentUserId)}`, { scroll: false });
  };
  const callRef = useRef(call);
  callRef.current = call;
  const next = useCallNext({ callRef, latest, setLine, setAnnounce });
  const afterCall: AfterCall = (family) => (logging ? afterCallFor(dialer.state.call, dialled, family, next.callNext) : null);
  return { dialer, live, wide: keepWide, call, afterCall, nextLine: line, announce, ...next };
}
