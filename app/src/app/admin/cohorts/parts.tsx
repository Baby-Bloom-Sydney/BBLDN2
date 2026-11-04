/**
 * Small shared pieces of /admin/cohorts, in the admin idiom (brief §7): the Counter tile of /admin/subscriptions
 * (`page.tsx:322-345`, matched), the small uppercase slate-500 label and the violet-50 action button of
 * `SubscriptionDetailHeader.tsx` (`:291`, `:350`), and its amber `role="alert"` line (`:422-426`).
 * BB-wave1-041126/02-build.
 */

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export const ACTION_BUTTON =
  "rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50";
export const QUIET_BUTTON =
  "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{children}</p>;
}

const TONES = { plain: "text-slate-900", info: "text-violet-700", active: "text-emerald-700", warn: "text-amber-700" } as const;

export function Tile({ label, value, tone = "plain" }: { label: string; value: number; tone?: keyof typeof TONES }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${TONES[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export function AlertLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-amber-700">
      {children}
    </p>
  );
}

export function NoteLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-600">{children}</p>;
}
