"use client";

// T-032 — Subscription / payout context (collapsed by default).

import { useState } from "react";
import { ChevronDown, ChevronRight, Wallet } from "lucide-react";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import { payoutsEnabled } from "@/lib/payments/flags";

interface LeadDrawerSubscriptionPayoutProps {
  detail: LeadDetail;
}

export function LeadDrawerSubscriptionPayout({
  detail,
}: LeadDrawerSubscriptionPayoutProps) {
  const [open, setOpen] = useState(false);
  const n = detail.nanny;

  // 4a-i (P-23): every field here is Connect / payout / tax ID — hidden unless PAYOUTS_ENABLED.
  if (!payoutsEnabled()) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Wallet className="h-3 w-3" />
        Subscription &amp; payout
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-slate-200 bg-white p-2">
            <div className="text-[10px] uppercase text-slate-500">
              Payouts enabled
            </div>
            <div
              className={
                n?.payouts_enabled ? "text-green-700" : "text-slate-500"
              }
            >
              {n?.payouts_enabled === true
                ? "Yes"
                : n?.payouts_enabled === false
                  ? "No"
                  : "—"}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-2">
            <div className="text-[10px] uppercase text-slate-500">
              Charges enabled
            </div>
            <div
              className={
                n?.charges_enabled ? "text-green-700" : "text-slate-500"
              }
            >
              {n?.charges_enabled === true
                ? "Yes"
                : n?.charges_enabled === false
                  ? "No"
                  : "—"}
            </div>
          </div>
          <div className="col-span-2 rounded-md border border-slate-200 bg-white p-2">
            <div className="text-[10px] uppercase text-slate-500">
              Payout application status
            </div>
            <div className="text-slate-700">
              {n?.payout_application_status ?? "not_applied"}
            </div>
          </div>
          <div className="col-span-2 rounded-md border border-slate-200 bg-white p-2">
            <div className="text-[10px] uppercase text-slate-500">ABN</div>
            <div className="text-slate-700">
              {n?.abn ?? "—"}
              {n?.abn_push_flagged_at && (
                <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                  Flagged for admin
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
