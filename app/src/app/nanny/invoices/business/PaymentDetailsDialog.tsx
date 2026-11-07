"use client";

/**
 * Add or change her bank details for invoices (plan 06 §14.6 b3.3; brief §0a 2: "the nanny must be able to edit their
 * bank details from within the settings on their account (for invoices only)"). Invoices only — never payouts.
 *
 * - The fields always start empty: the browser never holds her saved numbers (it has the masks only), so a change is
 *   typed in full.
 * - Cleared once saved, and when it closes without saving (plan §9 surface 2) — when it actually closes: a close the
 *   section refuses mid-save keeps what she typed (06b-3 code review L1).
 * - A change says we'll email her (brief §11 Q12); the first save doesn't.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useEffect, useState } from "react";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import type { BankView, SaveOutcome } from "./business-view";
import { DialogFields, useFocusFirstInvalid } from "./form-fields";
import { EMPTY_PAYMENT_FIELDS, PaymentDetailsFields, type PaymentFieldsValue } from "./PaymentDetailsFields";

export interface PaymentDetailsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  /** Her saved details (masks), or null for none yet. */
  readonly bank: BankView | null;
  readonly onSave: (fields: PaymentFieldsValue) => Promise<SaveOutcome>;
}

const NO_ISSUES: Readonly<Record<string, string>> = Object.freeze({});

export const CHANGE_NOTE = "These replace your current details on future invoices. We'll email you to confirm the change.";

export function PaymentDetailsDialog({ open, onOpenChange, bank, onSave }: PaymentDetailsDialogProps) {
  const [fields, setFields] = useState<PaymentFieldsValue>(EMPTY_PAYMENT_FIELDS);
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>(NO_ISSUES);
  useFocusFirstInvalid(issues);

  useEffect(() => {
    if (open) return;
    setFields(EMPTY_PAYMENT_FIELDS);
    setIssues(NO_ISSUES);
  }, [open]);

  async function submit() {
    const outcome = await onSave(fields);
    if (outcome.success) {
      setFields(EMPTY_PAYMENT_FIELDS);
      setIssues(NO_ISSUES);
    } else setIssues({ ...outcome.fields });
    return outcome;
  }

  return (
    <EditFieldDialog
      open={open}
      onOpenChange={onOpenChange}
      title={bank === null ? "Add your bank details" : "Change your bank details"}
      description="Printed in full on your invoices, so families can pay you. On screen we only show the last digits."
      onSubmit={submit}
    >
      <DialogFields>
        {bank !== null && <p className="text-sm text-slate-600">{CHANGE_NOTE}</p>}
        <PaymentDetailsFields value={fields} onChange={setFields} issues={issues} />
      </DialogFields>
    </EditFieldDialog>
  );
}
