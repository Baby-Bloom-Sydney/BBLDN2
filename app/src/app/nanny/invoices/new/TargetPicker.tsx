"use client";

/**
 * Who the invoice is for (plan 06 old step 14, §14.6 b4.4; brief §0.3, §3 nanny 3; D5: a native `<select>`, no new
 * dependency; 06b-4 rework, BAI 2026-11-12: one family picker, no Regular week / Trial Shift choice, no week; and "in
 * the dropdown for 'Choose family' There could be an option to 'Add Family'").
 *
 * - **Family:** "Choose a family" first, then her families ("{name} — {area}"), then **"Add family"** last. Choosing a
 *   family is the form's own (its option holds the link id, the earliest date and the rate); nothing loads.
 * - **"Add family"** goes to her hub's Children tab with the add-child sheet open (`ADD_FAMILY_HREF`), in the same tab:
 *   where she invites a family of her own to the free trial. The select keeps showing her choice meanwhile.
 * - **A correction** keeps its family (R4: the same family): its name and "Replaces …", no select.
 * - The picker sits outside the form, which starts afresh for each family, so it stays mounted and keeps her focus when
 *   she picks (code review M2).
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */

import { useId } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { LINE_MESSAGES } from "@/lib/invoices/validation-lines";
import { SELECT } from "./ShiftRows";
import type { FamilyOption, InvoiceTargetView } from "./invoice-form";

/** Where she invites a family of her own: her hub's Children tab, the add-child sheet open (`NannyHubClient`). */
export const ADD_FAMILY_HREF = "/nanny?tab=children&add=child";
export const ADD_FAMILY_LABEL = "Add family";
/** The "Add family" option's value: never a family's key (those are indexes). */
const ADD_FAMILY = "add-family";

export interface TargetPickerProps {
  readonly families: readonly FamilyOption[];
  /** The chosen family's key; "" = none yet. */
  readonly value: string;
  readonly onChoose: (key: string) => void;
  /** A correction: its family is fixed. */
  readonly replaces: InvoiceTargetView["replaces"];
}

const familyLabel = (f: FamilyOption): string => (f.area ? `${f.familyName} — ${f.area}` : f.familyName);

function FamilySelect({ families, value, onChoose }: Omit<TargetPickerProps, "replaces">) {
  const id = useId();
  const router = useRouter();
  const choose = (key: string) => (key === ADD_FAMILY ? router.push(ADD_FAMILY_HREF) : onChoose(key));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Family</Label>
      <select id={id} className={SELECT} value={value} onChange={(e) => choose(e.target.value)}>
        <option value="" disabled>{LINE_MESSAGES.family}</option>
        {families.map((f) => <option key={f.key} value={f.key}>{familyLabel(f)}</option>)}
        <option value={ADD_FAMILY}>{ADD_FAMILY_LABEL}</option>
      </select>
    </div>
  );
}

export function TargetPicker({ families, value, onChoose, replaces }: TargetPickerProps) {
  const fixed = replaces ? families.find((f) => f.key === value) : undefined;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {replaces ? (
        <div>
          <p className="font-semibold text-slate-900">{fixed?.familyName}</p>
          <p className="break-all text-sm text-slate-500">Replaces {replaces.number}</p>
        </div>
      ) : (
        <FamilySelect families={families} value={value} onChoose={onChoose} />
      )}
    </div>
  );
}
