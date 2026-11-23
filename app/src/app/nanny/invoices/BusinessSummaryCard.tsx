"use client";

/**
 * Who she is on her invoices, at the top of her list (plan 06 §14.6 b4.4; brief §0.2, §0a A "shown read-only … with
 * 'Change in Settings'"): her business type, the trading name she entered ("None" when she hasn't), and her bank
 * details **masked** ("sort code ••-••-56, account ending 4321") or "Not added" — the first invoice asks for them.
 * "Change in Settings" opens her Settings' Business page in a new tab. Labels and values only (brief §0b 6).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { ExternalLink } from "lucide-react";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { NOT_ADDED } from "@/components/settings/ValueLines";
import type { ReviewBank } from "@/lib/invoices/actions/invoice-messages";
import { maskedDetailsLine } from "@/lib/invoices/masking";

export interface BusinessSummary {
  /** The business type's label ("Sole trader"). */
  readonly businessType: string;
  /** A trading name she entered; null = none (her own name prints). */
  readonly tradingName: string | null;
}

export const SETTINGS_BUSINESS_HREF = "/nanny/settings?s=business";
export const NO_TRADING_NAME = "None";

/** "Change in Settings", in a new tab: her Business page; the invoice reads the change the next time it's reviewed. */
export function ChangeInSettingsLink() {
  return (
    <a
      href={SETTINGS_BUSINESS_HREF}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-violet-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      Change in Settings
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

export function BusinessSummaryCard({ business, bank }: { readonly business: BusinessSummary | null; readonly bank: ReviewBank | null }) {
  return (
    <section aria-label="Business" className="space-y-2">
      <SettingsSubsection>
        {business && <SettingsRow label="Business type" value={business.businessType} />}
        {business && <SettingsRow label="Trading name" value={business.tradingName ?? NO_TRADING_NAME} wrap />}
        <SettingsRow
          label="Bank details"
          display={
            bank === null ? (
              <span className="text-sm italic text-slate-500">{NOT_ADDED}</span>
            ) : (
              <span className="block whitespace-normal text-sm text-slate-900">
                <span className="block break-words">{bank.accountName}</span>
                <span className="block">{maskedDetailsLine(bank)}</span>
              </span>
            )
          }
          isLast
          wrap
        />
      </SettingsSubsection>
      <div className="px-1">
        <ChangeInSettingsLink />
      </div>
    </section>
  );
}
