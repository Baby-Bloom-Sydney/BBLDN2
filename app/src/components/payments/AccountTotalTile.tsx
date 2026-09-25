"use client";

/**
 * AccountTotalTile — top-of-dashboard summary.
 *
 * Shows the nanny's earned-to-date (paid + currently accruing). Future
 * cycles already scheduled but not yet accruing are excluded so the
 * number reflects what's actually been worked (Bailey correction
 * 2026-05-13).
 */

import { Card, CardContent } from "@/components/ui/card";

export interface AccountTotalTileProps {
  totalAud: number;
  familyCount: number;
}

export function AccountTotalTile({
  totalAud,
  familyCount,
}: AccountTotalTileProps) {
  return (
    <Card className="border-violet-200 bg-violet-50/40">
      <CardContent className="space-y-2 p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-700">
          Earned to date
        </p>
        <p className="text-3xl font-bold text-slate-900">£{totalAud}</p>
        <p className="text-sm text-slate-600">
          {familyCount === 0
            ? "No families yet — onboard a child to start earning."
            : familyCount === 1
              ? "From 1 family"
              : `From ${familyCount} families`}
        </p>
      </CardContent>
    </Card>
  );
}
