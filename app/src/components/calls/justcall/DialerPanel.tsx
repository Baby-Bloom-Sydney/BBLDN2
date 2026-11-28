"use client";

/**
 * The JustCall dialer panel (plan 05 §5 PR 05b C4; brief §0.1, §3.1, §3.3, §3.8, §7). BB-wave2-231126/05-build.
 *
 * At `lg` and up: a `Card` fixed on the right, 369 px (the frame's 365 px and its border), below the admin header, scrolling inside
 * the screen if it is short. Its top line says who is signed in to JustCall (or "Sign in to JustCall"), with the call's
 * phase as a `StatusBadge` — ringing amber, on call green, ended slate — in one announced status. Under it, the empty
 * element JustCall's frame is put in (`DIALER_MOUNT_ID`, by `use-justcall-dialer`). Below `lg` there is no panel and
 * no frame, only "On a phone, use the JustCall app — your calls still log here" (brief §3.8). Before the width is known,
 * nothing.
 *
 * `useDialerScreen()` is the width rule (the wrapper turns the dialer on only while it holds); `isInDialer()` is what
 * the side-by-side drawer leaves open (plan D6).
 */

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Card } from "@/components/ui/card";
import { callPhaseWord, DIALER_COPY, dialerSignInLine } from "@/lib/justcall/words";
import { DIALER_MOUNT_ID, type DialerState } from "./use-justcall-dialer";

const WIDE = "(min-width: 1024px)";
/** The panel's marker attribute (`data-dialer-region`). */
const REGION_SELECTOR = "[data-dialer-region]";
const PHASE_TONE = { ringing: "pending", on_call: "active", ended: "unattempted" } as const;

/** True while the screen is wide enough for the dialer (`lg`); null until it has looked; false without matchMedia. */
export function useDialerScreen(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return setWide(false);
    const query = window.matchMedia(WIDE);
    setWide(query.matches);
    const changed = (event: { readonly matches: boolean }) => setWide(event.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return wide;
}

/** Inside the dialer panel (its frame included). */
export function isInDialer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(REGION_SELECTOR) !== null;
}

export interface DialerPanelProps {
  /** Null: not known yet — nothing is drawn (no flash of the phone line on a laptop). */
  readonly wide: boolean | null;
  readonly state: DialerState;
}

export function DialerPanel({ wide, state }: DialerPanelProps) {
  if (wide === null) return null;
  if (!wide) return <p className="mt-4 text-sm text-slate-600">{DIALER_COPY.phone}</p>;
  const phase = state.call.kind === "idle" ? null : state.call.kind;
  const phaseWord = callPhaseWord(state.call.kind);
  return (
    <aside data-dialer-region="" aria-label={DIALER_COPY.title} className="fixed right-2 top-20 z-30 max-h-[calc(100vh-6rem)] w-[369px] overflow-y-auto">
      <Card className="overflow-hidden">
        <div role="status" className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <p className="text-sm font-medium text-slate-900">{dialerSignInLine(state.status, state.agent)}</p>
          {phase !== null && phaseWord !== null && <StatusBadge variant={PHASE_TONE[phase]}>{phaseWord}</StatusBadge>}
        </div>
        <div id={DIALER_MOUNT_ID} className="min-h-[610px] bg-white" />
      </Card>
    </aside>
  );
}
