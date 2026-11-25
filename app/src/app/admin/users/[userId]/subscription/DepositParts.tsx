"use client";

/**
 * The deposit block's small shared parts (plan 03 row B3), used by `DepositBlock` and its two dialogs: today's
 * DfyPanel look only (the violet-50 button, the Copy control, the amber `role="alert"` line), the cohort target
 * choice (goodwill only when offered, D10), one request at a time, and the dialogs' write-then-refresh step.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import type { CohortView } from "@/lib/cohorts/types";
import { depositActionErrorLine, goodwillChoiceLabel, PANEL_ACTION_COPY, PANEL_COPY } from "@/lib/deposit/copy";
import type { PanelCohorts } from "@/lib/deposit/panel";
import type { DepositTarget } from "@/lib/deposit/types";

/** DfyPanel's violet-50 button (`SubscriptionDetailHeader.tsx`, the preset buttons). */
export const BUTTON =
  "rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50";
/** DfyPanel's white button (the access toggle's). */
export const QUIET_BUTTON =
  "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

/** DfyPanel's amber failure line. */
export function AlertLine({ text }: { readonly text: string }) {
  return (
    <p role="alert" className="break-words text-sm text-amber-700">
      {text}
    </p>
  );
}

/** The next cohort when goodwill can be offered (D10), else null. */
export const goodwillNext = (cohorts: PanelCohorts): CohortView | null => (cohorts.canOfferGoodwill ? cohorts.next : null);

/** "Current cohort" (default) or "Next cohort, goodwill (Mon 8 Feb · 5 left)"; nothing when goodwill isn't offered. */
export function TargetChoice(props: {
  readonly cohorts: PanelCohorts;
  readonly value: DepositTarget;
  readonly onChange: (next: DepositTarget) => void;
  readonly disabled: boolean;
}) {
  const name = useId();
  const next = goodwillNext(props.cohorts);
  if (next === null) return null;
  const choices: ReadonlyArray<readonly [DepositTarget, string]> = [
    ["current", PANEL_COPY.targetCurrent],
    ["goodwill", goodwillChoiceLabel(next)],
  ];
  return (
    <fieldset disabled={props.disabled} className="min-w-0 space-y-1">
      <legend className="text-xs text-slate-600">{PANEL_ACTION_COPY.targetLegend}</legend>
      {choices.map(([target, label]) => (
        <label key={target} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name={name} checked={props.value === target} onChange={() => props.onChange(target)} className="accent-violet-600" />
          <span className="min-w-0 break-words">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** DfyPanel's Copy control for a link. A Copy the browser refuses selects the link, for copying by hand. */
export function CopyableUrl({ url }: { readonly url: string }) {
  const box = useRef<HTMLInputElement>(null);
  const selectBox = () => {
    box.current?.focus();
    box.current?.select();
  };
  const copy = () => {
    const writing = navigator.clipboard?.writeText(url);
    if (writing === undefined) selectBox();
    else writing.catch(selectBox);
  };
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-50 p-2 text-xs">
      <input ref={box} readOnly value={url} className="min-w-0 flex-1 bg-transparent text-slate-600" aria-label={PANEL_ACTION_COPY.linkLabel}
        onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1 text-violet-700 hover:underline">
        <Copy className="h-3 w-3" aria-hidden="true" />
        {PANEL_ACTION_COPY.copy}
      </button>
    </div>
  );
}

/** One request at a time (a ref: React 18 batches state); a task that throws → `onThrow`. */
export function useOneAtATime() {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const run = async (task: () => Promise<void>, onThrow: () => void): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await task();
    } catch {
      onThrow();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return { pending, run };
}

type WriteResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * A dialog's write: a refusal stays in the dialog as its plain line; done → `reset`, close, refresh the page. It
 * can't close while the write runs.
 */
export function useDialogWrite(reset: () => void) {
  const router = useRouter();
  const { pending, run } = useOneAtATime();
  const [open, setOpenState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const setOpen = (next: boolean) => {
    if (pending) return;
    setMessage(null);
    if (!next) reset();
    setOpenState(next);
  };
  const submit = (write: () => Promise<WriteResult>) =>
    run(
      async () => {
        setMessage(null);
        const result = await write();
        if (!result.ok) return setMessage(depositActionErrorLine(result.error));
        reset();
        setOpenState(false);
        router.refresh();
      },
      () => setMessage(PANEL_ACTION_COPY.genericError),
    );
  return { open, setOpen, pending, message, submit };
}
