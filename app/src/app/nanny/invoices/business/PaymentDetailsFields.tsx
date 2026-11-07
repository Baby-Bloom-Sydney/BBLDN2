"use client";

/**
 * Her bank details as she types them (plan 06 §14.6 b3.3; brief §0.1): the name on the account, the sort code and the
 * account number. Shared by the Settings dialog and 06b-4's first-invoice setup. Plan §9 surface 2: every field has
 * `autocomplete="off"` and no spell check; the number fields bring up a number keypad. The values live only in the
 * parent's state, which clears them once saved or closed.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useId } from "react";
import { INVOICE_RULES } from "@/config/invoices";
import { TextField } from "./form-fields";

export interface PaymentFieldsValue {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
}

export const EMPTY_PAYMENT_FIELDS: PaymentFieldsValue = Object.freeze({ accountName: "", sortCode: "", accountNumber: "" });

export interface PaymentDetailsFieldsProps {
  readonly value: PaymentFieldsValue;
  readonly onChange: (next: PaymentFieldsValue) => void;
  readonly issues?: Readonly<Record<string, string>>;
}

/** No autofill and no spell check; the `data-` hints ask password managers that ignore `autocomplete="off"` to stay out
 * too (security review L3). */
const PRIVATE = { autoComplete: "off", spellCheck: false, "data-1p-ignore": "true", "data-lpignore": "true", "data-form-type": "other" } as const;

export function PaymentDetailsFields({ value, onChange, issues = {} }: PaymentDetailsFieldsProps) {
  const id = useId();
  const set = (field: keyof PaymentFieldsValue) => (next: string) => onChange({ ...value, [field]: next });
  return (
    <>
      <TextField id={`${id}-name`} label="Name on the account" value={value.accountName} onChange={set("accountName")}
        error={issues.accountName} input={{ ...PRIVATE, maxLength: INVOICE_RULES.text.accountNameMax }} />
      <TextField id={`${id}-sort`} label="Sort code" value={value.sortCode} onChange={set("sortCode")} error={issues.sortCode}
        input={{ ...PRIVATE, inputMode: "numeric", placeholder: "00-00-00", maxLength: 8 }} />
      <TextField id={`${id}-account`} label="Account number" value={value.accountNumber} onChange={set("accountNumber")}
        error={issues.accountNumber} input={{ ...PRIVATE, inputMode: "numeric", placeholder: "8 digits", maxLength: 10 }} />
    </>
  );
}
