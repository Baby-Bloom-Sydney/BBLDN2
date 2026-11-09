"use client";

/**
 * The Business page's rows (ledger B06 §9.1 R3, R5; brief 06 §0b 6): labels and values only — no notes on how it
 * works. Who she is (business type; a limited company's name, number and registered office; a partnership's name;
 * her trading name or "None"; her address, unless a limited company), VAT (registered No / Yes; when Yes the number
 * and how it's charged) and her bank details in full, or "Not added". Plain rows: nothing here is a button.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { NOT_ADDED, ValueLines as Lines } from "@/components/settings/ValueLines";
import { formatVatNumber } from "@/lib/invoices/vat-number";
import { homeLines, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { bankRows, businessTypeLabel, vatChargedLabel, type BankView, type BusinessView } from "./business-view";

export const NO_TRADING_NAME = "None";

const officeLines = (office: string | null): string[] => (office ?? "").split("\n").filter((l) => l.trim() !== "");

function WhoRows({ view, home }: { readonly view: BusinessView; readonly home: HomeAddress | null }) {
  const ltd = view.businessType === "limited_company";
  return (
    <SettingsSubsection>
      <SettingsRow label="Business type" value={businessTypeLabel(view.businessType)} />
      {ltd && (
        <>
          <SettingsRow label="Company name" value={view.companyName} />
          <SettingsRow label="Company number" value={view.companyNumber} />
          <SettingsRow label="Registered office" display={<Lines lines={officeLines(view.registeredOffice)} />} />
        </>
      )}
      {view.businessType === "partnership" && <SettingsRow label="Partnership name" value={view.partnershipName} />}
      <SettingsRow label="Trading name" value={view.tradingName ?? NO_TRADING_NAME} isLast={ltd} />
      {!ltd && <SettingsRow label="Address" display={<Lines lines={homeLines(home)} />} isLast />}
    </SettingsSubsection>
  );
}

function VatRows({ view }: { readonly view: BusinessView }) {
  const registered = view.vatMode !== "none";
  return (
    <SettingsSubsection header="VAT">
      <SettingsRow label="VAT registered" value={registered ? "Yes" : "No"} isLast={!registered} />
      {view.vatMode !== "none" && (
        <>
          <SettingsRow label="VAT number" value={view.vatNumber === null ? null : formatVatNumber(view.vatNumber)} />
          <SettingsRow label="VAT charged" value={vatChargedLabel(view.vatMode)} isLast />
        </>
      )}
    </SettingsSubsection>
  );
}

function BankRows({ bank }: { readonly bank: BankView | null }) {
  if (bank === null) {
    return (
      <SettingsSubsection header="Bank details">
        <p className="px-4 py-3 text-sm italic text-slate-500">{NOT_ADDED}</p>
      </SettingsSubsection>
    );
  }
  const rows = bankRows(bank);
  return (
    <SettingsSubsection header="Bank details">
      {rows.map((r, i) => (
        <SettingsRow key={r.label} label={r.label} value={r.value} mono={r.label !== "Name on account"} isLast={i === rows.length - 1} />
      ))}
    </SettingsSubsection>
  );
}

export function BusinessRows({ view, bank, home }: { readonly view: BusinessView; readonly bank: BankView | null; readonly home: HomeAddress | null }) {
  return (
    <>
      <WhoRows view={view} home={home} />
      <VatRows view={view} />
      <BankRows bank={bank} />
    </>
  );
}
