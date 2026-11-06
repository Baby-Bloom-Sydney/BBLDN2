"use client";

/**
 * Call settings on the Calendar tab (plan C5; brief §3 admin 5, §0a.13; BB-wave1-041126/04c2-build): the call length
 * as a choice of 15 / 20 / 30 / 45 / 60 minutes (BAI 2026-11-06: "the fixed list"), the notice and the hold in
 * minutes, and the caller number the emails name. The values go to the server as typed; the server checks them all
 * and refuses a length off the list. A stored length off the list (set outside the app) shows as itself, never as the
 * first choice. Changing the length moves no booking (brief §3 admin 5).
 *
 * Native inputs; the <select> is styled as the input (plan §12 R16; no new UI dependency).
 */

import { useId, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_COPY, callLengthOption } from "@/lib/calls/copy";
import { CALL_LENGTH_CHOICES } from "@/lib/calls/calendar-limits";
import type { CallSettings } from "@/lib/calls/types";
import { ACTION_BUTTON, AlertLine } from "../cohorts/parts";
import { saveCallSettingsAction } from "./actions";
import { useCalendarSave } from "./use-calendar-save";

/** The `Input` look, for a native <select> (plan §12 R16). */
export const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const HINT = "text-xs text-slate-500";

function LengthField({ id, value, stored, disabled, onChange }: { readonly id: string; readonly value: string; readonly stored: number; readonly disabled: boolean; readonly onChange: (v: string) => void }) {
  const offList = !CALL_LENGTH_CHOICES.includes(stored);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{ADMIN_COPY.callLengthLabel}</Label>
      <select id={id} className={SELECT_CLASS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {offList && <option value={String(stored)}>{`${callLengthOption(stored)} (${ADMIN_COPY.offListLength})`}</option>}
        {CALL_LENGTH_CHOICES.map((minutes) => (
          <option key={minutes} value={String(minutes)}>
            {callLengthOption(minutes)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface NumberProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (v: string) => void;
}

function MinutesField({ id, label, hint, min, max, value, disabled, onChange }: NumberProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={value} disabled={disabled} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.value)} />
      <p id={`${id}-hint`} className={HINT}>
        {hint}
      </p>
    </div>
  );
}

export function CallSettingsForm({ settings }: { readonly settings: CallSettings }) {
  const id = useId();
  const save = useCalendarSave(ADMIN_COPY.settingsInvalid);
  const [length, setLength] = useState(String(settings.slotMinutes));
  const [notice, setNotice] = useState(String(settings.noticeMinutes));
  const [hold, setHold] = useState(String(settings.holdMinutes));
  const [caller, setCaller] = useState(settings.callerNumber ?? "");
  const submit = () => save.run(() => saveCallSettingsAction({ slotMinutes: length, noticeMinutes: notice, holdMinutes: hold, callerNumber: caller }));
  return (
    <section aria-labelledby={`${id}-heading`}>
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <h2 id={`${id}-heading`} className="text-base font-semibold text-slate-900">
            {ADMIN_COPY.settingsHeading}
          </h2>
          <form
            noValidate
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <LengthField id={`${id}-length`} value={length} stored={settings.slotMinutes} disabled={save.saving} onChange={setLength} />
            <MinutesField id={`${id}-notice`} label={ADMIN_COPY.noticeLabel} hint={ADMIN_COPY.noticeHint} min={0} max={10080} value={notice} disabled={save.saving} onChange={setNotice} />
            <MinutesField id={`${id}-hold`} label={ADMIN_COPY.holdLabel} hint={ADMIN_COPY.holdHint} min={1} max={60} value={hold} disabled={save.saving} onChange={setHold} />
            <div className="space-y-1">
              <Label htmlFor={`${id}-caller`}>{ADMIN_COPY.callerNumberLabel}</Label>
              <Input id={`${id}-caller`} type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={caller} disabled={save.saving} aria-describedby={`${id}-caller-hint`} onChange={(e) => setCaller(e.target.value)} />
              <p id={`${id}-caller-hint`} className={HINT}>
                {ADMIN_COPY.callerNumberHint}
              </p>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className={ACTION_BUTTON} disabled={save.saving}>
                {save.saving ? ADMIN_COPY.saving : ADMIN_COPY.saveSettings}
              </button>
            </div>
          </form>
          {save.error && <AlertLine>{save.error}</AlertLine>}
          <p role="status" className="text-sm text-slate-600">
            {save.status}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
