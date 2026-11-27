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
import { callIsLive, useJustCallDialer, type CallPhase, type Dialer } from "./use-justcall-dialer";

const PAGE = "/admin/calls";

export interface CallTarget {
  readonly parentUserId: string;
  /** E.164. */
  readonly mobile: string;
}

export interface DialerFlow {
  readonly dialer: Dialer;
  readonly live: boolean;
  readonly call: (target: CallTarget) => void;
  readonly callNext: () => Promise<void>;
  /** Call next's last word ("No one left to call right now."), or "". */
  readonly nextLine: string;
  readonly nextBusy: boolean;
  readonly afterCall: AfterCall;
}

export const DialerFlowContext = createContext<DialerFlow | null>(null);

export function useDialerFlowContext(): DialerFlow | null {
  return useContext(DialerFlowContext);
}

/** A number's digits in international form: `+44…`, `44…`, `0044…` and `07…` (UK) all read the same. */
function digitsOf(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return `44${digits.slice(1)}`;
  return digits;
}

export function sameNumber(a: string, b: string): boolean {
  const x = digitsOf(a);
  return x !== "" && x === digitsOf(b);
}

function afterCallFor(call: CallPhase, dialed: CallTarget | null, family: Parameters<AfterCall>[0], callNext: () => Promise<void>): AfterCallForm | null {
  if (call.kind !== "ended" || !call.outbound || call.number === null || dialed === null) return null;
  if (dialed.parentUserId !== family.parentUserId || !sameNumber(call.number, dialed.mobile)) return null;
  return {
    key: call.callSid,
    extraReadOnly: <p className="text-xs text-slate-600">{afterCallLine(call)}</p>,
    save: saveFor(call.callSid),
    saveNext: { label: DIALER_COPY.saveAndCallNext, onSavedNext: () => void callNext() },
  };
}

function useCallNext(call: (target: CallTarget) => void) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState("");
  const callNext = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setLine("");
    try {
      const next = await nextFamilyToCallAction({});
      if (!next.ok) return setLine(DIALER_COPY.callNextFailed);
      if (next.value === null) return setLine(DIALER_COPY.noOneLeft);
      call(next.value);
    } catch (thrown) {
      console.error("[justcall/call-next] the next family couldn't be asked for", { name: thrown instanceof Error ? thrown.name : typeof thrown });
      setLine(DIALER_COPY.callNextFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { callNext, nextLine: line, nextBusy: busy };
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
  const dialer = useJustCallDialer(enabled && wide);
  const [dialed, setDialed] = useState<CallTarget | null>(null);
  const call = (target: CallTarget) => {
    if (dialer.dial(target.mobile)) setDialed(target);
    router.push(`${PAGE}?openCall=${encodeURIComponent(target.parentUserId)}`, { scroll: false });
  };
  const next = useCallNext(call);
  const afterCall: AfterCall = (family) => (logging ? afterCallFor(dialer.state.call, dialed, family, next.callNext) : null);
  return { dialer, live: callIsLive(dialer.state.call), call, afterCall, ...next };
}
