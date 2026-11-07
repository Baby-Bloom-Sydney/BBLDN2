"use client";

/**
 * How she trades (plan 06 §14.6 b3.3; brief §0a B): sole trader (the default), limited company or partnership, as
 * native radios. A limited company needs its registered name, its Companies House number and its registered office;
 * a partnership needs its name. BAI 2026-11-07: a limited company's "registered office would replace their home
 * address … it doesnt need to have both" — so the dialog says so and asks for no other address.
 *
 * It saves only the fields it owns (`onSave` merges them into the rest); the form validates with the shared schema
 * and hands back the plain message for each refused field.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useId, useState } from "react";
import { BUSINESS_TYPES } from "@/config/invoices";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import { BUSINESS_TYPE_KEYS, type BusinessType } from "@/lib/invoices/types";
import type { BusinessFormInput, BusinessView, SaveOutcome } from "./business-view";
import { DialogFields, RadioChoice, RadioGroupFieldset, TextField, useFocusFirstInvalid } from "./form-fields";

type Owned = Pick<BusinessFormInput, "businessType" | "companyName" | "companyNumber" | "registeredOffice" | "partnershipName">;

export interface BusinessTypeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly view: BusinessView;
  readonly onSave: (patch: Owned) => Promise<SaveOutcome>;
}

export const ONE_ADDRESS = "Your invoices show the registered office as your address, so you don't need to add another one.";

export function BusinessTypeDialog({ open, onOpenChange, view, onSave }: BusinessTypeDialogProps) {
  const id = useId();
  const [type, setType] = useState<BusinessType>(view.businessType);
  const [companyName, setCompanyName] = useState(view.companyName ?? "");
  const [companyNumber, setCompanyNumber] = useState(view.companyNumber ?? "");
  const [registeredOffice, setRegisteredOffice] = useState(view.registeredOffice ?? "");
  const [partnershipName, setPartnershipName] = useState(view.partnershipName ?? "");
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  useFocusFirstInvalid(issues);

  async function submit() {
    const outcome = await onSave({ businessType: type, companyName, companyNumber, registeredOffice, partnershipName });
    setIssues({ ...outcome.fields }); // a fresh object: the same refusal twice still refocuses
    return outcome;
  }

  return (
    <EditFieldDialog open={open} onOpenChange={onOpenChange} title="Business type" onSubmit={submit}>
      <DialogFields>
        <RadioGroupFieldset legend="How do you trade?">
          {BUSINESS_TYPE_KEYS.map((key) => (
            <RadioChoice
              key={key}
              name={`${id}-type`}
              value={key}
              checked={type === key}
              onSelect={() => setType(key)}
              label={BUSINESS_TYPES[key]}
            />
          ))}
        </RadioGroupFieldset>
        {type === "limited_company" && (
          <>
            <TextField id={`${id}-company-name`} label="Company name" value={companyName} onChange={setCompanyName}
              hint="As registered at Companies House." error={issues.companyName} />
            <TextField id={`${id}-company-number`} label="Company number" value={companyNumber} onChange={setCompanyNumber}
              error={issues.companyNumber} input={{ placeholder: "12345678", spellCheck: false }} />
            <TextField id={`${id}-office`} label="Registered office" value={registeredOffice} onChange={setRegisteredOffice}
              multiline hint={ONE_ADDRESS} error={issues.registeredOffice} />
          </>
        )}
        {type === "partnership" && (
          <TextField id={`${id}-partnership`} label="Partnership name" value={partnershipName} onChange={setPartnershipName}
            error={issues.partnershipName} />
        )}
      </DialogFields>
    </EditFieldDialog>
  );
}
