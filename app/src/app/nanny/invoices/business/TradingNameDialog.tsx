"use client";

/**
 * Her trading name (plan 06 §14.6 b3.3). BAI 2026-11-07: the trading name "is not mandatory", and when she enters one it
 * "replaces the business name" on her invoices. Blank means her own name.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useId, useState } from "react";
import { INVOICE_RULES } from "@/config/invoices";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import type { BusinessView, SaveOutcome } from "./business-view";
import { DialogFields, TextField, useFocusFirstInvalid } from "./form-fields";

export interface TradingNameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly view: BusinessView;
  readonly onSave: (patch: { readonly tradingName: string }) => Promise<SaveOutcome>;
}

/** What the box's hint says, by how she trades. */
export function tradingNameHint(view: BusinessView): string {
  if (view.businessType === "limited_company") return "If you add one, your invoices show it instead of the company's registered name.";
  if (view.businessType === "partnership") return "If you add one, your invoices show it instead of the partnership's name.";
  return view.name === null ? "Add the name to print on your invoices." : `Leave this blank to use your own name, ${view.name}.`;
}

export function TradingNameDialog({ open, onOpenChange, view, onSave }: TradingNameDialogProps) {
  const id = useId();
  const [tradingName, setTradingName] = useState(view.tradingName ?? "");
  // an object, so the same refusal twice still re-runs the focus (06b-3 verification L2)
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  useFocusFirstInvalid(issues);

  async function submit() {
    const outcome = await onSave({ tradingName });
    setIssues({ ...outcome.fields }); // a fresh object: the same refusal twice still refocuses
    return outcome;
  }

  return (
    <EditFieldDialog open={open} onOpenChange={onOpenChange} title="Trading name" onSubmit={submit}>
      <DialogFields>
        <TextField id={`${id}-trading`} label="Trading name (optional)" value={tradingName} onChange={setTradingName}
          hint={tradingNameHint(view)} error={issues.tradingName} input={{ maxLength: INVOICE_RULES.text.tradingNameMax }} />
      </DialogFields>
    </EditFieldDialog>
  );
}
