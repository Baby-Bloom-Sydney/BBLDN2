"use client";

/**
 * Her bank details as she types them (plan 06 §14.6 b3.3; brief §0.1; ledger B06 §9.1 R3): Name on account, Sort code
 * and Account number, each a row of the Business page's "Bank details" card in edit mode (and 06b-4's first-invoice
 * setup). Plan §9 surface 2: no autofill and no spell check; the number fields bring up a number keypad.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; BB-wave1-041126/06b3-rework, 2026-11-09 (in place of the dialog).
 */

import { useId } from "react";
import { EditRow, TextField } from "@/components/settings/SettingsFields";
import { INVOICE_RULES } from "@/config/invoices";

export interface PaymentFieldsValue {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
}

export interface PaymentDetailsFieldsProps {
  readonly value: PaymentFieldsValue;
  readonly onChange: (field: keyof PaymentFieldsValue, next: string) => void;
  readonly issues?: Readonly<Record<string, string>>;
}

/** No autofill and no spell check; the `data-` hints ask password managers that ignore `autocomplete="off"` to stay out
 * too (06b-3 security review L3). */
const PRIVATE = { autoComplete: "off", spellCheck: false, "data-1p-ignore": "true", "data-lpignore": "true", "data-form-type": "other" } as const;

export function PaymentDetailsFields({ value, onChange, issues = {} }: PaymentDetailsFieldsProps) {
  const id = useId();
  return (
    <>
      <EditRow>
        <TextField id={`${id}-name`} label="Name on account" value={value.accountName} onChange={(v) => onChange("accountName", v)}
          error={issues.accountName} input={{ ...PRIVATE, maxLength: INVOICE_RULES.text.accountNameMax }} />
      </EditRow>
      <EditRow>
        <TextField id={`${id}-sort`} label="Sort code" value={value.sortCode} onChange={(v) => onChange("sortCode", v)} error={issues.sortCode}
          input={{ ...PRIVATE, inputMode: "numeric", placeholder: "00-00-00" }} />
      </EditRow>
      <EditRow isLast>
        <TextField id={`${id}-account`} label="Account number" value={value.accountNumber} onChange={(v) => onChange("accountNumber", v)}
          error={issues.accountNumber} input={{ ...PRIVATE, inputMode: "numeric", placeholder: "12345678" }} />
      </EditRow>
    </>
  );
}
