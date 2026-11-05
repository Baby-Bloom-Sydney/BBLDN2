"use client";

/**
 * Record what happened on a call (plan C4; brief §3 admin 3, §0.10, §11 Q4; BB-wave1-041126/04c1-build).
 *
 * The chip rows are `LeadDrawerLogContactForm`'s (rounded-full, `ring-1 ring-inset`, `aria-pressed`, a second tap
 * unselects; refusals in a `role="alert"` line); one save per press (an in-flight guard, review round 2 M3):
 *   - the result: Answered / No answer / Voicemail left / Wrong number;
 *   - the outcome, only once Answered is chosen: Deposit taken / Link sent / Call back later / Not going ahead /
 *     Pre-booked next cohort / Other — with a call-back time (London clock, read on the server) for Call back later;
 *   - "Stop calling" on its own (refused while a time is booked: "Cancel the booked time first");
 *   - a note.
 * No answer, Voicemail left and Wrong number close her booked call and put her back under Not booked (the database's
 * `call_record_outcome`); the page refreshes through `onSaved`.
 *
 * Brief 05's "after call" hook: `prefill` (what JustCall knows), `extraReadOnly` (shown above the chips), `onSaved`.
 */

import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ADMIN_COPY, adminErrorLine } from "@/lib/calls/copy";
import { outcomeLabel, resultLabel } from "@/lib/calls/outcomes";
import type { CallOutcomeCode, CallResultCode } from "@/lib/calls/types";
import { recordCallOutcomeAction } from "./actions";

export interface OutcomePrefill {
  readonly result?: CallResultCode | null;
  readonly outcome?: CallOutcomeCode | null;
  readonly note?: string;
}

export interface OutcomeFormProps {
  readonly parentUserId: string;
  /** Her booked call, closed by the outcome; null when she has none. */
  readonly bookingId: string | null;
  readonly prefill?: OutcomePrefill;
  readonly extraReadOnly?: ReactNode;
  readonly onSaved?: (entryId: string) => void;
}

const GREEN = "bg-green-50 text-green-700 ring-green-200";
const SLATE = "bg-slate-50 text-slate-600 ring-slate-200";
const AMBER = "bg-amber-50 text-amber-700 ring-amber-200";
const RED = "bg-red-50 text-red-700 ring-red-200";
const VIOLET = "bg-violet-50 text-violet-700 ring-violet-200";

const RESULT_CHIPS: readonly (readonly [CallResultCode, string])[] = [
  ["answered", GREEN],
  ["no_answer", SLATE],
  ["voicemail", AMBER],
  ["wrong_number", RED],
];
const OUTCOME_CHIPS: readonly (readonly [Exclude<CallOutcomeCode, "stop_calling">, string])[] = [
  ["deposit_taken", GREEN],
  ["link_sent", VIOLET],
  ["call_back_later", AMBER],
  ["not_going_ahead", SLATE],
  ["prebooked_next_cohort", VIOLET],
  ["other", SLATE],
];

interface ChipProps {
  readonly label: string;
  readonly tone: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function Chip({ label, tone, active, disabled, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${tone} ${active ? "ring-2" : ""} ${disabled ? "opacity-50" : ""}`}
    >
      {label}
    </button>
  );
}

function ChipRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function useOutcomeState(prefill: OutcomePrefill | undefined) {
  const [result, setResult] = useState<CallResultCode | null>(prefill?.result ?? null);
  const [outcome, setOutcome] = useState<CallOutcomeCode | null>(prefill?.outcome ?? null);
  const [note, setNote] = useState(prefill?.note ?? "");
  const [callBackDate, setCallBackDate] = useState("");
  const [callBackTime, setCallBackTime] = useState("");
  const pickResult = (next: CallResultCode) => {
    const chosen = result === next ? null : next;
    setResult(chosen);
    // An outcome needs Answered; Stop calling stands on its own.
    if (chosen !== "answered" && outcome !== "stop_calling") setOutcome(null);
  };
  const pickOutcome = (next: CallOutcomeCode) => setOutcome(outcome === next ? null : next);
  const reset = () => {
    setResult(null);
    setOutcome(null);
    setNote("");
    setCallBackDate("");
    setCallBackTime("");
  };
  const fields = { result, outcome, note, callBackDate, callBackTime };
  return { ...fields, setNote, setCallBackDate, setCallBackTime, pickResult, pickOutcome, reset };
}

type OutcomeState = ReturnType<typeof useOutcomeState>;

/** What goes to the server: the outcome only where it is allowed, the call-back only with Call back later. */
function payload(parentUserId: string, bookingId: string | null, s: OutcomeState) {
  const outcome = s.outcome === "stop_calling" || s.result === "answered" ? s.outcome : null;
  const callBack = outcome === "call_back_later" && s.callBackDate !== "" && s.callBackTime !== "";
  return {
    parentUserId,
    bookingId,
    result: s.result,
    outcome,
    note: s.note.trim() === "" ? null : s.note,
    callBackDate: callBack ? s.callBackDate : null,
    callBackTime: callBack ? s.callBackTime : null,
  };
}

function CallBackFields({ s, disabled }: { readonly s: OutcomeState; readonly disabled: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">{ADMIN_COPY.callBackAtLabel}</p>
      <div className="flex flex-wrap gap-2">
        <Input type="date" aria-label={ADMIN_COPY.callBackDate} value={s.callBackDate} onChange={(e) => s.setCallBackDate(e.target.value)} disabled={disabled} className="max-w-[11rem]" />
        <Input type="time" aria-label={ADMIN_COPY.callBackTime} value={s.callBackTime} onChange={(e) => s.setCallBackTime(e.target.value)} disabled={disabled} className="max-w-[8rem]" />
      </div>
    </div>
  );
}

function Chips({ s, pending }: { readonly s: OutcomeState; readonly pending: boolean }) {
  return (
    <>
      <ChipRow label={ADMIN_COPY.resultLabel}>
        {RESULT_CHIPS.map(([code, tone]) => (
          <Chip key={code} label={resultLabel(code)} tone={tone} active={s.result === code} disabled={pending} onClick={() => s.pickResult(code)} />
        ))}
      </ChipRow>
      {s.result === "answered" && (
        <ChipRow label={ADMIN_COPY.outcomeLabel}>
          {OUTCOME_CHIPS.map(([code, tone]) => (
            <Chip key={code} label={outcomeLabel(code)} tone={tone} active={s.outcome === code} disabled={pending} onClick={() => s.pickOutcome(code)} />
          ))}
        </ChipRow>
      )}
      {s.result === "answered" && s.outcome === "call_back_later" && <CallBackFields s={s} disabled={pending} />}
      <ChipRow label={ADMIN_COPY.orLabel}>
        <Chip label={outcomeLabel("stop_calling")} tone={RED} active={s.outcome === "stop_calling"} disabled={pending} onClick={() => s.pickOutcome("stop_calling")} />
      </ChipRow>
    </>
  );
}

/**
 * One save per press (review round 2 M3): under React 18 an async transition's `pending` clears before the action
 * settles, so a ref guards the call and `saving` holds the button until the promise does.
 */
function useOutcomeSave(parentUserId: string, bookingId: string | null, s: OutcomeState, onSaved?: (entryId: string) => void) {
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const saved = await recordCallOutcomeAction(payload(parentUserId, bookingId, s));
      if (!saved.ok) return setError(adminErrorLine(saved.error));
      s.reset();
      setStatus(ADMIN_COPY.saved);
      onSaved?.(saved.value.entryId);
    } catch {
      setError(adminErrorLine("error"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { saving, error, status, submit };
}

function NoteField({ s, disabled }: { readonly s: OutcomeState; readonly disabled: boolean }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-slate-500">{ADMIN_COPY.noteLabel}</span>
      <Textarea value={s.note} onChange={(e) => s.setNote(e.target.value)} disabled={disabled} rows={2} maxLength={2000} className="text-sm" />
    </label>
  );
}

interface FooterProps {
  readonly error: string | null;
  readonly status: string;
  readonly canSave: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
}

function Footer({ error, status, canSave, saving, onSave }: FooterProps) {
  return (
    <>
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <p role="status" className={status ? "text-xs text-green-700" : "sr-only"}>
        {status}
      </p>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onSave} disabled={!canSave || saving}>
          {saving ? ADMIN_COPY.saving : ADMIN_COPY.save}
        </Button>
      </div>
    </>
  );
}

export function OutcomeForm({ parentUserId, bookingId, prefill, extraReadOnly, onSaved }: OutcomeFormProps) {
  const s = useOutcomeState(prefill);
  const save = useOutcomeSave(parentUserId, bookingId, s, onSaved);
  const headingId = useId();
  // Call back later with only a date or only a time would drop the call-back silently: say so, and wait.
  const halfCallBack = s.result === "answered" && s.outcome === "call_back_later" && (s.callBackDate === "") !== (s.callBackTime === "");
  const canSave = (s.result !== null || s.outcome === "stop_calling") && !halfCallBack;
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {ADMIN_COPY.recordOutcome}
      </h3>
      {extraReadOnly}
      <Chips s={s} pending={save.saving} />
      {halfCallBack && <p className="text-xs text-amber-700">{ADMIN_COPY.callBackBoth}</p>}
      <NoteField s={s} disabled={save.saving} />
      <Footer error={save.error} status={save.status} canSave={canSave} saving={save.saving} onSave={save.submit} />
    </section>
  );
}
