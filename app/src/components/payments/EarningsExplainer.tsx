"use client";

/**
 * EarningsExplainer — short summary of how contributions work.
 *
 * T-018 reframing (Bailey 2026-05-15): "Payouts" → "Contributions".
 * Our framing positions BB's payment to the nanny as a contribution
 * towards the nanny's developmental support of children — we are
 * not paying them for the customer; we're rewarding their work for
 * the betterment of young children.
 *
 * NEVER uses "track" / "tracking" terminology.
 */

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function EarningsExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        How it works
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-200 px-5 py-4 text-sm text-slate-700">
          <p className="text-slate-900">
            Our contribution towards your great work!
          </p>

          <ul className="space-y-2 pl-1">
            <li className="flex gap-2">
              <span aria-hidden="true" className="select-none">
                •
              </span>
              <span>
                <span className="font-semibold text-slate-900">£100</span> for
                every month of continued developmental support with a family.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="select-none">
                •
              </span>
              <span>
                <span className="font-semibold text-slate-900">£1,000</span>{" "}
                for assisting families that pre-plan for long-term development.
              </span>
            </li>
          </ul>

          <p className="text-sm italic text-slate-600">
            You just keep doing what you do best!
          </p>

          <p>
            <Link
              href="/nanny/payouts/terms"
              className="font-medium text-violet-700 underline-offset-2 hover:underline"
            >
              See the full terms →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
