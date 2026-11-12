"use client";

/**
 * The first-invoice setup (plan 06 §14.1 item 4, §14.3, §14.6 b4.4; brief §0a C "The only thing asked once is her bank
 * details, on her first invoice, saved to the Business section"; A4; risk X5; ledger B06 §9.10 item 4).
 *
 * - Shown on the review **only** when the review says something is missing: her bank details (`needsPaymentDetails`)
 *   and — rarely, when none is on file — her address (`needsAddress`). A second invoice doesn't ask again.
 * - The Business page's own fields (`PaymentDetailsFields`, `AddressSearchField`) and its own check
 *   (`checkBusinessPage`, the one the server runs), so the same plain messages show under the same fields.
 * - Saved through the Business page's action: her bank details with no version (none saved yet), her address with her
 *   row's version (`addressVersion`). Name on account starts as the company's or partnership's name, else hers
 *   (Settings' rule). No autofill on the bank fields; they live only in this component and go once saved.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AddressSearchField } from "@/components/settings/AddressSearchField";
import { EditRow } from "@/components/settings/SettingsFields";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { Button } from "@/components/ui/button";
import { checkBusinessPage, type BusinessPageInput } from "@/lib/invoices/actions/business-page";
import { INVOICE_ACTION_MESSAGES, type InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import type { HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { PaymentDetailsFields, type PaymentFieldsValue } from "../business/PaymentDetailsFields";

export interface FirstInvoiceSetupProps {
  readonly preview: InvoicePreview;
  /** The save's refusal by field (`accountName`, `sortCode`, `accountNumber`, `address`). */
  readonly issues: Readonly<Record<string, string>>;
  readonly saving: boolean;
  readonly onSave: (input: BusinessPageInput) => void;
}

/** Name on account to start with: the company's or partnership's name, else hers. */
function startingName(issuer: InvoicePreview["issuer"]): string {
  if (issuer.businessType === "limited_company") return issuer.companyName ?? "";
  if (issuer.businessType === "partnership") return issuer.partnershipName ?? "";
  return issuer.name ?? "";
}

/** What the setup saves: her bank details (none saved: no version) and, when asked, her address with its version. */
function setupInput(preview: InvoicePreview, bank: PaymentFieldsValue, home: HomeAddress | null): BusinessPageInput {
  return {
    ...(preview.needsPaymentDetails ? { bank: { ...bank, expectedUpdatedAt: null } } : {}),
    ...(preview.needsAddress && home ? { address: { ...home, expectedUpdatedAt: preview.addressVersion } } : {}),
  };
}

export function FirstInvoiceSetup({ preview, issues, saving, onSave }: FirstInvoiceSetupProps) {
  const [bank, setBank] = useState<PaymentFieldsValue>({ accountName: startingName(preview.issuer), sortCode: "", accountNumber: "" });
  const [home, setHome] = useState<HomeAddress | null>(null);
  const [checked, setChecked] = useState<Readonly<Record<string, string>> | null>(null);
  const shown = checked ?? issues;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const input = setupInput(preview, bank, home);
    const found = checkBusinessPage(input, !preview.needsAddress, preview.issuer.businessType);
    setChecked(Object.keys(found).length > 0 ? found : null);
    if (Object.keys(found).length === 0) onSave(input);
  };

  return (
    <form onSubmit={save} noValidate className="space-y-3">
      {preview.needsPaymentDetails && (
        <>
          <p className="px-1 text-sm font-medium text-slate-900">{INVOICE_ACTION_MESSAGES.no_details}</p>
          <SettingsSubsection header="Bank details">
            <PaymentDetailsFields value={bank} issues={shown} onChange={(field, next) => setBank((b) => ({ ...b, [field]: next }))} />
          </SettingsSubsection>
        </>
      )}
      {preview.needsAddress && (
        <>
          <p className="px-1 text-sm font-medium text-slate-900">{INVOICE_ACTION_MESSAGES.no_address}</p>
          <SettingsSubsection>
            <EditRow isLast>
              <AddressSearchField id="first-invoice-address" value={home} onPick={setHome} error={shown.address} required />
            </EditRow>
          </SettingsSubsection>
        </>
      )}
      <Button type="submit" aria-disabled={saving || undefined} className="bg-violet-600 text-white hover:bg-violet-700">
        {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
