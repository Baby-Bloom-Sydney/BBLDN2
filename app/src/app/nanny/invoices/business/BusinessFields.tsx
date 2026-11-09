"use client";

/**
 * The Business page in edit mode (ledger B06 §9.1 R1, R3, R5): every field in place of its row. Business type radios
 * reveal a limited company's name, number and registered office, or a partnership's name; Trading name (no
 * "(optional)", no hint); her address (the inline search; not for a limited company, whose registered office is its
 * address); VAT registered No / Yes, then the VAT number and how it's charged — "Included in rates" with a grey
 * "(Recommended)" (the default) or "Added to rates" — and no rate (always 20%); her bank details.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useId } from "react";
import { AddressSearchField } from "@/components/settings/AddressSearchField";
import { EditRow, RadioChoice, RadioGroupFieldset, TextField } from "@/components/settings/SettingsFields";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { BUSINESS_TYPE_KEYS } from "@/lib/invoices/types";
import { accountNameShown, businessTypeLabel, vatChargedLabel, type BusinessForm, type BusinessView } from "./business-view";
import { PaymentDetailsFields } from "./PaymentDetailsFields";

export interface BusinessFieldsProps {
  readonly form: BusinessForm;
  readonly set: (patch: Partial<BusinessForm>) => void;
  readonly view: BusinessView;
  readonly errors: Readonly<Record<string, string>>;
}

function WhoFields({ form, set, errors, id }: Omit<BusinessFieldsProps, "view"> & { readonly id: string }) {
  const ltd = form.businessType === "limited_company";
  return (
    <SettingsSubsection>
      <EditRow>
        <RadioGroupFieldset legend="Business type">
          {BUSINESS_TYPE_KEYS.map((type) => (
            <RadioChoice key={type} name={`${id}-type`} value={type} checked={form.businessType === type}
              onSelect={() => set({ businessType: type })} label={businessTypeLabel(type)} />
          ))}
        </RadioGroupFieldset>
      </EditRow>
      {ltd && (
        <>
          <EditRow><TextField id={`${id}-company`} label="Company name" value={form.companyName} onChange={(v) => set({ companyName: v })} error={errors.companyName} required /></EditRow>
          <EditRow><TextField id={`${id}-number`} label="Company number" value={form.companyNumber} onChange={(v) => set({ companyNumber: v })} error={errors.companyNumber} input={{ placeholder: "12345678", autoComplete: "off" }} required /></EditRow>
          <EditRow><TextField id={`${id}-office`} label="Registered office" value={form.registeredOffice} onChange={(v) => set({ registeredOffice: v })} error={errors.registeredOffice} multiline required /></EditRow>
        </>
      )}
      {form.businessType === "partnership" && (
        <EditRow><TextField id={`${id}-partnership`} label="Partnership name" value={form.partnershipName} onChange={(v) => set({ partnershipName: v })} error={errors.partnershipName} required /></EditRow>
      )}
      <EditRow isLast={ltd}>
        <TextField id={`${id}-trading`} label="Trading name" value={form.tradingName} onChange={(v) => set({ tradingName: v })} error={errors.tradingName} />
      </EditRow>
      {!ltd && (
        <EditRow isLast><AddressSearchField id={`${id}-address`} value={form.home} onPick={(home) => set({ home })} error={errors.address} required /></EditRow>
      )}
    </SettingsSubsection>
  );
}

function VatFields({ form, set, errors, id }: Omit<BusinessFieldsProps, "view"> & { readonly id: string }) {
  return (
    <SettingsSubsection header="VAT">
      <EditRow isLast={!form.vatRegistered}>
        <RadioGroupFieldset legend="VAT registered">
          <RadioChoice name={`${id}-vat`} value="no" checked={!form.vatRegistered} onSelect={() => set({ vatRegistered: false })} label="No" />
          <RadioChoice name={`${id}-vat`} value="yes" checked={form.vatRegistered} onSelect={() => set({ vatRegistered: true })} label="Yes" />
        </RadioGroupFieldset>
      </EditRow>
      {form.vatRegistered && (
        <>
          <EditRow>
            <TextField id={`${id}-vat-number`} label="VAT number" value={form.vatNumber} onChange={(v) => set({ vatNumber: v })} error={errors.vatNumber}
              input={{ placeholder: "GB 123 4567 89", autoComplete: "off" }} required />
          </EditRow>
          <EditRow isLast>
            <RadioGroupFieldset legend="VAT charged">
              <RadioChoice name={`${id}-charged`} value="included" checked={form.vatCharged === "included"} onSelect={() => set({ vatCharged: "included" })}
                label={vatChargedLabel("included")} suffix="(Recommended)" />
              <RadioChoice name={`${id}-charged`} value="added" checked={form.vatCharged === "added"} onSelect={() => set({ vatCharged: "added" })}
                label={vatChargedLabel("added")} />
            </RadioGroupFieldset>
          </EditRow>
        </>
      )}
    </SettingsSubsection>
  );
}

/** A bank field's change, by its own key (typing a name makes it hers). */
function bankPatch(field: "accountName" | "sortCode" | "accountNumber", next: string): Partial<BusinessForm> {
  if (field === "accountName") return { accountName: next, accountNameTouched: true };
  return field === "sortCode" ? { sortCode: next } : { accountNumber: next };
}

export function BusinessFields({ form, set, view, errors }: BusinessFieldsProps) {
  const id = useId();
  const bank = { accountName: accountNameShown(form, view), sortCode: form.sortCode, accountNumber: form.accountNumber };
  return (
    <>
      <WhoFields form={form} set={set} errors={errors} id={id} />
      <VatFields form={form} set={set} errors={errors} id={id} />
      <SettingsSubsection header="Bank details">
        <PaymentDetailsFields value={bank} issues={errors} onChange={(field, next) => set(bankPatch(field, next))} />
      </SettingsSubsection>
    </>
  );
}
