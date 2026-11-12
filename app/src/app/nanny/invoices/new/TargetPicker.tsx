"use client";

/**
 * Who and when the invoice is for (plan 06 old step 14, §14.6 b4.4; brief §0.3, §3 nanny 3–4; D5: a native `<select>`
 * and two buttons for the kind, no new dependency).
 *
 * - **Family:** her own families (name and area). Choosing one opens the form for its placement — or, with none, its
 *   Trial Shift — through the page's own parameter, so the server checks it's hers and pre-fills it.
 * - **Kind:** "Regular week" or "Trial Shift", as two buttons (`aria-pressed`); one the family hasn't got is disabled.
 * - **Week** (Regular week): the Mondays she can pick ("8–14 Feb 2027"), newest first; changing it is the form's.
 * - **A Trial Shift's date** is its own: fixed, or chosen when the family has had more than one.
 * - **A correction** keeps its family and kind (R4: the same family) and says "Replaces …".
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { periodForSubject } from "@/lib/invoices/emails/invoice-wording";
import { LINE_MESSAGES } from "@/lib/invoices/validation-lines";
import { shiftDateLabel, weekRangeLabel } from "@/lib/invoices/week";
import { cn } from "@/lib/utils";
import { SELECT } from "./ShiftRows";
import type { FamilyOption, InvoiceTargetView } from "./invoice-form";

const NEW_INVOICE = "/nanny/invoices/new";

export interface TargetPickerProps {
  readonly families: readonly FamilyOption[];
  readonly target: InvoiceTargetView | null;
  readonly periodStart: string;
  readonly onWeek: (monday: string) => void;
}

const familyLabel = (f: FamilyOption): string => (f.area ? `${f.familyName} — ${f.area}` : f.familyName);

function useGo() {
  const router = useRouter();
  return (param: "placement" | "connection", id: string) => router.push(`${NEW_INVOICE}?${param}=${encodeURIComponent(id)}`);
}

function FamilySelect({ families, value }: { readonly families: readonly FamilyOption[]; readonly value: string }) {
  const id = useId();
  const go = useGo();
  const choose = (key: string) => {
    const family = families.find((f) => f.key === key);
    const trial = family?.trials[0];
    if (family?.placementId) go("placement", family.placementId);
    else if (trial) go("connection", trial.connectionId);
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Family</Label>
      <select id={id} className={SELECT} value={value} onChange={(e) => choose(e.target.value)}>
        <option value="" disabled>{LINE_MESSAGES.family}</option>
        {families.map((f) => <option key={f.key} value={f.key}>{familyLabel(f)}</option>)}
      </select>
    </div>
  );
}

function KindButtons({ family, target }: { readonly family: FamilyOption; readonly target: InvoiceTargetView }) {
  const go = useGo();
  const trial = family.trials[0];
  const kind = (label: string, pressed: boolean, enabled: boolean, onClick: () => void) => (
    <Button type="button" variant="outline" aria-pressed={pressed} disabled={!enabled} onClick={pressed ? undefined : onClick}
      className={cn("flex-1 sm:flex-none", pressed && "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-50")}>
      {label}
    </Button>
  );
  return (
    <div className="flex gap-2">
      {kind("Regular week", target.kind === "regular_week", family.placementId !== null, () => family.placementId && go("placement", family.placementId))}
      {kind("Trial Shift", target.kind === "trial_shift", trial !== undefined, () => trial && go("connection", trial.connectionId))}
    </div>
  );
}

function WeekSelect({ weeks, value, onWeek }: { readonly weeks: readonly string[]; readonly value: string; readonly onWeek: (m: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Week</Label>
      <select id={id} className={SELECT} value={value} onChange={(e) => onWeek(e.target.value)}>
        {weeks.map((w) => <option key={w} value={w}>{weekRangeLabel(w)}</option>)}
      </select>
    </div>
  );
}

function TrialDate({ family, target }: { readonly family: FamilyOption | undefined; readonly target: InvoiceTargetView }) {
  const id = useId();
  const go = useGo();
  const trials = family?.trials ?? [];
  if (trials.length < 2 || target.replaces) return <p className="text-sm font-medium text-slate-900">{periodForSubject("trial_shift", target.periodStart)}</p>;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Date</Label>
      <select id={id} className={SELECT} value={target.targetId} onChange={(e) => go("connection", e.target.value)}>
        {trials.map((t) => <option key={t.connectionId} value={t.connectionId}>{shiftDateLabel(t.date)}</option>)}
      </select>
    </div>
  );
}

export function TargetPicker({ families, target, periodStart, onWeek }: TargetPickerProps) {
  const family = target ? families.find((f) => f.key === target.familyKey) : undefined;
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {target?.replaces ? (
        <div>
          <p className="font-semibold text-slate-900">{target.familyName}</p>
          <p className="break-all text-sm text-slate-500">Replaces {target.replaces.number}</p>
        </div>
      ) : (
        <FamilySelect families={families} value={target?.familyKey ?? ""} />
      )}
      {target && family && !target.replaces && <KindButtons family={family} target={target} />}
      {target?.kind === "regular_week" && <WeekSelect weeks={target.weeks} value={periodStart} onWeek={onWeek} />}
      {target?.kind === "trial_shift" && <TrialDate family={family} target={target} />}
    </div>
  );
}
