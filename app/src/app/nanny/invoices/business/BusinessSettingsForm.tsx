"use client";

/**
 * The Settings Business section (plan 06 §14.6 b3.3; brief §0a B, C): who she is on her invoices and her bank details
 * for them, in the Settings look (`SettingsSubsection`, `SettingsRow`, `EditFieldDialog`). BAI 2026-11-06: "the whole
 * system will work with no setup at all" — so every row starts on its default, shown with where it came from, and
 * each row opens one focused dialog.
 *
 * - **Who she is:** business type; for a limited company its name and number, and its registered office — the one
 *   address her invoices print (BAI 2026-11-07), so no other address row; for a partnership its name; her trading
 *   name (optional — when entered, it replaces the business's name); otherwise the address on her invoices.
 * - **VAT** and **bank details** (masks only: the props never hold a full number).
 * - **Saving:** the shared schema first (a refusal is shown by its field; the action isn't called), then the action,
 *   then a refresh so the server leaf reads her details again. One save at a time (`useSingleFlight`).
 * - **Focus:** closing a dialog (Escape, Cancel or a save) gives focus back to the row that opened it. Radix's Dialog,
 *   used without a `Dialog.Trigger` (as `EditFieldDialog` is), prevents its own restore and focuses no trigger, so
 *   focus fell to the page (found by the b3.6 keyboard walk).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { saveBusinessDetails } from "@/lib/invoices/actions/save-business-details";
import { savePaymentDetails } from "@/lib/invoices/actions/save-payment-details";
import { paymentDetailsSchema } from "@/lib/invoices/validation";
import { businessDetailsSchema } from "@/lib/invoices/validation-business";
import { AddressDialog } from "./AddressDialog";
import { BusinessTypeDialog } from "./BusinessTypeDialog";
import {
  bankSummary,
  businessTypeLabel,
  CHECK_MARKED,
  fieldIssues,
  saveInput,
  vatSummary,
  type BankView,
  type BusinessFormInput,
  type BusinessView,
  type SaveOutcome,
} from "./business-view";
import { PaymentDetailsDialog } from "./PaymentDetailsDialog";
import type { PaymentFieldsValue } from "./PaymentDetailsFields";
import { TradingNameDialog } from "./TradingNameDialog";
import { useSingleFlight } from "./useSingleFlight";
import { VatDialog } from "./VatDialog";

export interface BusinessSettingsFormProps {
  readonly business: BusinessView;
  readonly bank: BankView | null;
}

type DialogName = "type" | "trading" | "address" | "vat" | "bank";
type Opener = (name: DialogName) => (event?: { readonly currentTarget: EventTarget | null }) => void;

export const FUTURE_ONLY = "Changes apply to future invoices. Invoices you've sent stay as they were.";

function refusedByFields(error: z.ZodError): SaveOutcome {
  const fields = fieldIssues(error);
  return { success: false, error: fields.form ?? CHECK_MARKED, fields };
}

const Muted = ({ children }: { readonly children: ReactNode }) => <span className="text-sm text-slate-500">{children}</span>;
/** A note in place of a value: wraps (the row's value cell truncates), so a narrow screen shows all of it. */
const Note = ({ children }: { readonly children: ReactNode }) => (
  <span className="block whitespace-normal text-sm text-slate-500">{children}</span>
);
const Missing = ({ children }: { readonly children: ReactNode }) => (
  <span className="block whitespace-normal text-sm italic text-slate-500">{children}</span>
);
const Lines = ({ text }: { readonly text: string }) => (
  <span className="block whitespace-pre-line break-words text-sm text-slate-900">{text}</span>
);

const OWNER: Readonly<Record<"limited_company" | "partnership", string>> = { limited_company: "company", partnership: "partnership" };

/** The trading name row: what she entered, else her own name (a sole trader) or the business's registered name. */
function tradingNameDisplay(view: BusinessView): { readonly display: ReactNode; readonly caption?: string } {
  const owner = view.businessType === "sole_trader" ? null : OWNER[view.businessType];
  if (view.tradingName !== null) {
    return { display: <span className="text-sm text-slate-900">{view.tradingName}</span>, caption: owner ? `Printed instead of the ${owner}'s name.` : undefined };
  }
  if (owner) return { display: <Note>None — your invoices use the {owner}&apos;s name</Note> };
  if (view.name === null) return { display: <Missing>Not set — add a name for your invoices</Missing> };
  return { display: <><span className="text-sm text-slate-900">{view.name}</span> <Muted>(your name)</Muted></> };
}

function addressDisplay(view: BusinessView): ReactNode {
  if (view.address === null) return <Missing>Not on file — add the address for your invoices</Missing>;
  return (
    <>
      <Lines text={view.address} />
      {view.addressSource === "verification" && <span className="block text-xs text-slate-500">(from your verification)</span>}
    </>
  );
}

function WhoRows({ view, open }: { readonly view: BusinessView; readonly open: Opener }) {
  const trading = tradingNameDisplay(view);
  return (
    <SettingsSubsection header="On your invoices">
      <SettingsRow label="Business type" value={businessTypeLabel(view.businessType)} onClick={open("type")} />
      {view.businessType === "limited_company" && (
        <>
          <SettingsRow label="Company" value={view.companyName} caption={view.companyNumber ? `Company no. ${view.companyNumber}` : undefined} onClick={open("type")} />
          <SettingsRow label="Registered office" display={view.registeredOffice ? <Lines text={view.registeredOffice} /> : undefined}
            caption="Your invoices show this as your address." onClick={open("type")} />
        </>
      )}
      {view.businessType === "partnership" && <SettingsRow label="Partnership name" value={view.partnershipName} onClick={open("type")} />}
      <SettingsRow label="Trading name" display={trading.display} caption={trading.caption} onClick={open("trading")}
        isLast={view.businessType === "limited_company"} />
      {view.businessType !== "limited_company" && (
        <SettingsRow label="Address on invoices" display={addressDisplay(view)} onClick={open("address")} isLast />
      )}
    </SettingsSubsection>
  );
}

function MoneyRows({ view, bank, open }: { readonly view: BusinessView; readonly bank: BankView | null; readonly open: Opener }) {
  const vat = vatSummary(view);
  return (
    <>
      <SettingsSubsection header="VAT">
        <SettingsRow label="VAT" value={vat.value} caption={vat.caption ?? undefined} onClick={open("vat")} isLast />
      </SettingsSubsection>
      <SettingsSubsection header="Bank details for invoices" footnote="Printed in full on your invoices, so families can pay you. On screen we only show the last digits.">
        <SettingsRow label="Bank details" value={bankSummary(bank)} onClick={open("bank")} isLast />
      </SettingsSubsection>
    </>
  );
}

/** The two saves, each checked by the shared schema before the action, one at a time. */
function useSaves(view: BusinessView) {
  const router = useRouter();
  const saveBusiness = useSingleFlight(async (patch: Partial<BusinessFormInput>): Promise<SaveOutcome> => {
    const input = saveInput(view, patch);
    const parsed = businessDetailsSchema.safeParse(input);
    if (!parsed.success) return refusedByFields(parsed.error);
    const reply = await saveBusinessDetails(input);
    if (!reply.ok) return { success: false, error: reply.message };
    router.refresh();
    return { success: true };
  });
  const savePayment = useSingleFlight(async (fields: PaymentFieldsValue): Promise<SaveOutcome> => {
    const parsed = paymentDetailsSchema.safeParse(fields);
    if (!parsed.success) return refusedByFields(parsed.error);
    const reply = await savePaymentDetails(fields);
    if (!reply.ok) return { success: false, error: reply.message };
    router.refresh();
    return { success: true };
  });
  return { saveBusiness, savePayment };
}

/** Which dialog is open, a fresh one per opening (no stale input or error), and focus back to its row on close. */
function useDialogs() {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [opened, setOpened] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (dialog === null && wasOpen.current) opener.current?.focus();
    wasOpen.current = dialog !== null;
  }, [dialog]);
  const open: Opener = (name) => (event) => {
    opener.current = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    setOpened((n) => n + 1);
    setDialog(name);
  };
  return { dialog, setDialog, opened, open };
}

export function BusinessSettingsForm({ business, bank }: BusinessSettingsFormProps) {
  const { dialog, setDialog, opened, open } = useDialogs();
  const { saveBusiness, savePayment } = useSaves(business);
  const shown = (name: DialogName) => ({ open: dialog === name, onOpenChange: (next: boolean) => setDialog(next ? name : null) });

  return (
    <div className="space-y-6">
      <p className="px-1 text-sm text-slate-600">How you appear on the invoices you send. It&apos;s all filled in from your account — change only what you need to.</p>
      <WhoRows view={business} open={open} />
      <MoneyRows view={business} bank={bank} open={open} />
      <p className="px-1 text-xs text-slate-500">{FUTURE_ONLY}</p>
      <BusinessTypeDialog key={`type-${opened}`} {...shown("type")} view={business} onSave={saveBusiness} />
      <TradingNameDialog key={`trading-${opened}`} {...shown("trading")} view={business} onSave={saveBusiness} />
      <AddressDialog key={`address-${opened}`} {...shown("address")} title="Address on your invoices"
        description={business.addressSource === null ? "We don't have an address we can print, so please add one." : "Leave this blank to use the address from your verification."}
        initial={business.addressSource === "business" ? (business.address ?? "") : ""} onSave={(address) => saveBusiness({ businessAddress: address })} />
      <VatDialog key={`vat-${opened}`} {...shown("vat")} view={business} onSave={saveBusiness} />
      <PaymentDetailsDialog key={`bank-${opened}`} {...shown("bank")} bank={bank} onSave={savePayment} />
    </div>
  );
}
