"use client";

/**
 * VAT on her invoices (plan 06 §14.6 b3.3; brief §0a B): not registered (the default). Registered asks for her VAT
 * number (required), whether VAT is "included in my rates" (the default, so a family pays the agreed rate) or "added
 * on top", and the rate — 20% unless she changes it. Native radios. Not registered saves no number or rate.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useId, useState } from "react";
import { INVOICE_RULES } from "@/config/invoices";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import { percentText, type BusinessFormInput, type BusinessView, type SaveOutcome } from "./business-view";
import { DialogFields, RadioChoice, RadioGroupFieldset, TextField } from "./form-fields";

type Owned = Pick<BusinessFormInput, "vatMode" | "vatNumber" | "vatRate">;
type Charged = "included" | "added";

export interface VatDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly view: BusinessView;
  readonly onSave: (patch: Owned) => Promise<SaveOutcome>;
}

const DEFAULT_RATE = percentText(INVOICE_RULES.vatRateBp.default);

export function VatDialog({ open, onOpenChange, view, onSave }: VatDialogProps) {
  const id = useId();
  const [registered, setRegistered] = useState(view.vatMode !== "none");
  const [charged, setCharged] = useState<Charged>(view.vatMode === "added" ? "added" : "included");
  const [vatNumber, setVatNumber] = useState(view.vatNumber ?? "");
  const [rate, setRate] = useState(view.vatRateBp === null ? DEFAULT_RATE : percentText(view.vatRateBp));
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});

  async function submit() {
    const patch: Owned = registered ? { vatMode: charged, vatNumber, vatRate: rate } : { vatMode: "none", vatNumber: "", vatRate: "" };
    const outcome = await onSave(patch);
    setIssues(outcome.fields ?? {});
    return outcome;
  }

  return (
    <EditFieldDialog open={open} onOpenChange={onOpenChange} title="VAT" onSubmit={submit}>
      <DialogFields>
        <RadioGroupFieldset legend="Are you VAT registered?">
          <RadioChoice name={`${id}-registered`} value="no" checked={!registered} onSelect={() => setRegistered(false)} label="Not VAT registered" />
          <RadioChoice name={`${id}-registered`} value="yes" checked={registered} onSelect={() => setRegistered(true)} label="VAT registered" />
        </RadioGroupFieldset>
        {registered && (
          <>
            <TextField id={`${id}-number`} label="VAT number" value={vatNumber} onChange={setVatNumber} error={issues.vatNumber}
              input={{ placeholder: "GB 123 4567 89", spellCheck: false, maxLength: 20 }} />
            <RadioGroupFieldset legend="How do you charge it?">
              <RadioChoice name={`${id}-charged`} value="included" checked={charged === "included"} onSelect={() => setCharged("included")}
                label="VAT included in my rates" />
              <RadioChoice name={`${id}-charged`} value="added" checked={charged === "added"} onSelect={() => setCharged("added")}
                label="VAT added on top" />
            </RadioGroupFieldset>
            <TextField id={`${id}-rate`} label="VAT rate (%)" value={rate} onChange={setRate} error={issues.vatRate}
              input={{ inputMode: "decimal", maxLength: 5 }} />
          </>
        )}
      </DialogFields>
    </EditFieldDialog>
  );
}
