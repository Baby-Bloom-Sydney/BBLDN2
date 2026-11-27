"use client";

/**
 * Under a past attempt made through JustCall, in the row drawer (plan 05 §5 B5; brief §0.6–§0.7, §3 admin 6; D2, D4).
 * BB-wave2-231126/05-build.
 *
 * - JustCall's own notes and disposition, one line each (admin only, Q2).
 * - On an "outcome needed" entry (answered by the webhook, no outcome yet): **Add outcome** opens 04's outcome form
 *   with Answered chosen and the JustCall line read-only. It saves through `saveJustCallOutcomeAction` with the call's
 *   sid, her id and her booked call — `justcall_save_outcome`, so his words complete the same entry (R5). Then the form
 *   closes and the page refreshes.
 * Anything not made through JustCall draws nothing.
 *
 * After the React review: each Add outcome button is named with its attempt's time; it points at its form only while
 * the form is open; after a save, "Outcome saved." stays in a status line under the attempt and focus moves there (the
 * button and the form have gone).
 */

import { useId, useRef, useState } from "react";
import { saveJustCallOutcomeAction } from "@/app/admin/calls/justcall-actions";
import { OutcomeForm, type OutcomeSave } from "@/app/admin/calls/OutcomeForm";
import { Button } from "@/components/ui/button";
import type { AttemptView } from "@/lib/calls/family-panel";
import { JUSTCALL_COPY, justcallErrorLine } from "@/lib/justcall/words";

export interface JustCallFamily {
  readonly parentUserId: string;
  readonly bookingId: string | null;
}

/** 04's form saving through the JustCall action, its refusal in 05's words. */
function saveFor(callSid: string): OutcomeSave {
  return async (payload) => {
    const saved = await saveJustCallOutcomeAction({ ...payload, callSid });
    return saved.ok ? { ok: true, entryId: saved.value.entryId } : { ok: false, line: justcallErrorLine(saved.error) };
  };
}

interface AddOutcomeProps {
  readonly callSid: string;
  readonly summary: string;
  /** The attempt's time, "Tue 9 Feb, 14:03 (London time)": names the button among several. */
  readonly when: string;
  readonly family: JustCallFamily;
  readonly onSaved: () => void;
}

export function AddOutcome({ callSid, summary, when, family, onSaved }: AddOutcomeProps) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const saved = () => {
    setOpen(false);
    onSaved();
  };
  return (
    <div className="mt-2 space-y-2">
      <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={open ? formId : undefined} aria-label={`${JUSTCALL_COPY.addOutcome}: ${when}`} onClick={() => setOpen(!open)}>
        {JUSTCALL_COPY.addOutcome}
      </Button>
      {open && (
        <div id={formId}>
          <OutcomeForm
            parentUserId={family.parentUserId}
            bookingId={family.bookingId}
            prefill={{ result: "answered" }}
            extraReadOnly={<p className="text-xs text-slate-600">{summary}</p>}
            save={saveFor(callSid)}
            onSaved={saved}
          />
        </div>
      )}
    </div>
  );
}

export interface JustCallAttemptActionProps {
  readonly attempt: AttemptView;
  readonly family: JustCallFamily;
  readonly onSaved: () => void;
}

/** The drawer's slot under one attempt (`renderAttemptAction`). */
export function JustCallAttemptAction({ attempt, family, onSaved }: JustCallAttemptActionProps) {
  const here = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const justcall = attempt.justcall;
  if (justcall === undefined) return null;
  const afterSave = () => {
    setSaved(true);
    here.current?.focus();
    onSaved();
  };
  return (
    <div ref={here} tabIndex={-1} className="focus:outline-none">
      {justcall.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {justcall.lines.map((line, i) => (
            <li key={`${i}-${line}`} className="whitespace-pre-line">
              {line}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className={saved ? "mt-1 text-xs text-green-700" : "sr-only"}>
        {saved ? JUSTCALL_COPY.outcomeSaved : ""}
      </p>
      {justcall.needsOutcome && <AddOutcome callSid={justcall.callSid} summary={justcall.summary} when={attempt.when} family={family} onSaved={afterSave} />}
    </div>
  );
}
