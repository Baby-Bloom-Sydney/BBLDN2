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
 *   focus fell to the page (found by the b3.6 keyboard walk). If that row is gone after the refresh (a company's rows
 *   when she becomes a sole trader), focus goes to "Business type".
 * - **While a save is in flight** the dialog can't be closed, a changed second submit is told to wait, and an action
 *   that throws (offline, a stale deploy) or doesn't answer within `SAVE_WAIT_MS` answers the general message, so a
 *   stalled request never locks the dialog (06b-3 review round 1).
 * - Notes that carry content (company number, VAT number, the one-address line) are slate-500, not the rows' faint
 *   captions (AA contrast); the bank line is read out in words, not bullets.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { ACTION_MESSAGES } from "@/lib/invoices/actions/messages";
import { saveBusinessDetails } from "@/lib/invoices/actions/save-business-details";
import { savePaymentDetails } from "@/lib/invoices/actions/save-payment-details";
import { maskAccountNumber, maskSortCode } from "@/lib/invoices/masking";
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
export const STILL_SAVING = "Still saving — try again in a moment.";
const BANK_NOTE = "Printed in full on your invoices, so families can pay you. On screen we only show the last digits.";

/** Refused by the shared schema: each field's message; the alert says "marked below" only if the dialog shows one of
 * them, else it names the first (a stored value the open dialog doesn't show). */
function refusedByFields(error: z.ZodError, shown: readonly string[]): SaveOutcome {
  const fields = fieldIssues(error);
  const marked = shown.some((field) => Object.hasOwn(fields, field));
  return { success: false, error: fields.form ?? (marked ? CHECK_MARKED : Object.values(fields)[0]), fields };
}

const SAVE_FAILED: SaveOutcome = { success: false, error: ACTION_MESSAGES.error };
const BUSY: SaveOutcome = { success: false, error: STILL_SAVING };

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
/** A value with a note beneath it, at AA contrast (the row's own caption is a fainter slate-400). */
const WithNote = ({ children, note }: { readonly children: ReactNode; readonly note: string | null }) => (
  <>
    {children}
    {note && <span className="mt-0.5 block whitespace-normal text-xs text-slate-500">{note}</span>}
  </>
);
const Plain = ({ text }: { readonly text: string }) => <span className="text-sm text-slate-900">{text}</span>;

const OWNER: Readonly<Record<"limited_company" | "partnership", string>> = { limited_company: "company", partnership: "partnership" };

/** The trading name row: what she entered, else her own name (a sole trader) or the business's registered name. */
function tradingNameDisplay(view: BusinessView): ReactNode {
  const owner = view.businessType === "sole_trader" ? null : OWNER[view.businessType];
  if (view.tradingName !== null) {
    return <WithNote note={owner ? `Printed instead of the ${owner}'s name.` : null}><Plain text={view.tradingName} /></WithNote>;
  }
  if (owner) return <Note>None — your invoices use the {owner}&apos;s name</Note>;
  if (view.name === null) return <Missing>Not set — add a name for your invoices</Missing>;
  return <><Plain text={view.name} /> <Muted>(your name)</Muted></>;
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

/** Her masked bank details: wraps on a narrow screen, but never inside a mask; read out in words, not bullets. */
function BankLine({ bank }: { readonly bank: BankView | null }) {
  if (bank === null) return <span className="block whitespace-normal text-sm text-slate-900">{bankSummary(null)}</span>;
  return (
    <span className="block">
      <span aria-hidden="true" className="block whitespace-normal text-sm text-slate-900">
        {bank.accountName} · <span className="whitespace-nowrap">sort code {maskSortCode(bank.sortCodeLast2)},</span>{" "}
        <span className="whitespace-nowrap">account {maskAccountNumber(bank.accountLast4)}</span>
      </span>
      <span className="sr-only">{`${bank.accountName}, sort code ending ${bank.sortCodeLast2}, account ending ${bank.accountLast4}`}</span>
    </span>
  );
}

function CompanyRows({ view, open }: { readonly view: BusinessView; readonly open: Opener }) {
  return (
    <>
      <SettingsRow label="Company" onClick={open("type")} display={
        <WithNote note={view.companyNumber ? `Company no. ${view.companyNumber}` : null}>
          {view.companyName ? <Plain text={view.companyName} /> : <Missing>Not set</Missing>}
        </WithNote>
      } />
      <SettingsRow label="Registered office" onClick={open("type")} display={
        <WithNote note="Your invoices show this as your address.">
          {view.registeredOffice ? <Lines text={view.registeredOffice} /> : <Missing>Not set</Missing>}
        </WithNote>
      } />
    </>
  );
}

function WhoRows({ view, open }: { readonly view: BusinessView; readonly open: Opener }) {
  return (
    <SettingsSubsection header="On your invoices">
      <SettingsRow label="Business type" value={businessTypeLabel(view.businessType)} onClick={open("type")} />
      {view.businessType === "limited_company" && <CompanyRows view={view} open={open} />}
      {view.businessType === "partnership" && <SettingsRow label="Partnership name" value={view.partnershipName} onClick={open("type")} />}
      <SettingsRow label="Trading name" display={tradingNameDisplay(view)} onClick={open("trading")}
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
        <SettingsRow label="VAT" display={<WithNote note={vat.caption}><Plain text={vat.value} /></WithNote>} onClick={open("vat")} isLast />
      </SettingsSubsection>
      <div className="space-y-2">
        <SettingsSubsection header="Bank details for invoices">
          <SettingsRow label="Bank details" display={<BankLine bank={bank} />} onClick={open("bank")} isLast />
        </SettingsSubsection>
        <p className="px-1 text-xs text-slate-500">{BANK_NOTE}</p>
      </div>
    </>
  );
}

/** How long a save may take before the section gives up on its answer (code review L2). */
export const SAVE_WAIT_MS = 30_000;

/** Run an action: null when it throws (offline, a stale deploy) or gives no answer within `SAVE_WAIT_MS`. */
async function attempt<R>(run: () => Promise<R>): Promise<R | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SAVE_WAIT_MS);
  });
  try {
    return await Promise.race([run(), gaveUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The two saves, each checked by the shared schema before the action, one at a time; `saving` says one is in flight. */
function useSaves(view: BusinessView) {
  const router = useRouter();
  const saving = useRef(0);
  const finish = (ok: boolean): SaveOutcome => {
    if (!ok) return SAVE_FAILED;
    router.refresh();
    return { success: true };
  };
  const saveBusiness = useSingleFlight(async (patch: Partial<BusinessFormInput>): Promise<SaveOutcome> => {
    const input = saveInput(view, patch);
    const parsed = businessDetailsSchema.safeParse(input);
    if (!parsed.success) return refusedByFields(parsed.error, Object.keys(patch));
    saving.current += 1;
    const reply = await attempt(() => saveBusinessDetails(input)).finally(() => (saving.current -= 1));
    return reply !== null && !reply.ok ? { success: false, error: reply.message } : finish(reply !== null);
  }, () => BUSY);
  const savePayment = useSingleFlight(async (fields: PaymentFieldsValue): Promise<SaveOutcome> => {
    const parsed = paymentDetailsSchema.safeParse(fields);
    if (!parsed.success) return refusedByFields(parsed.error, Object.keys(fields));
    saving.current += 1;
    const reply = await attempt(() => savePaymentDetails(fields)).finally(() => (saving.current -= 1));
    return reply !== null && !reply.ok ? { success: false, error: reply.message } : finish(reply !== null);
  }, () => BUSY);
  return { saveBusiness, savePayment, isSaving: () => saving.current > 0 };
}

/**
 * Which dialog is open — a fresh one per opening (no stale input or error) — and where focus goes on close: back to
 * the row that opened it, or, when the refresh has removed that row, to the section's first row ("Business type").
 */
function useDialogs(section: RefObject<HTMLDivElement>, refreshed: unknown) {
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [opened, setOpened] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (dialog === null && wasOpen.current) opener.current?.focus();
    wasOpen.current = dialog !== null;
  }, [dialog]);
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (dialog === null && lost && opener.current && !opener.current.isConnected) {
      section.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [refreshed, dialog, section]);
  const open: Opener = (name) => (event) => {
    opener.current = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    setOpened((n) => n + 1);
    setDialog(name);
  };
  return { dialog, setDialog, opened, open };
}

export function BusinessSettingsForm({ business, bank }: BusinessSettingsFormProps) {
  const section = useRef<HTMLDivElement>(null);
  const { dialog, setDialog, opened, open } = useDialogs(section, business);
  const { saveBusiness, savePayment, isSaving } = useSaves(business);
  // a close only closes its own dialog, and never while a save is in flight (React review M1, TS review M1)
  const shown = (name: DialogName) => ({
    open: dialog === name,
    onOpenChange: (next: boolean) => {
      if (!next && isSaving()) return;
      setDialog((current) => (next ? name : current === name ? null : current));
    },
  });

  return (
    <div ref={section} className="space-y-6">
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
