/**
 * The one card at the top of `/parent` (brief 04 §0.5, D8 "one card, not the full rail"; plan B7 + §12 R16):
 *
 *   booked      "Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time) · Change"
 *   not booked  "Pick a time for your Complimentary matchmaker call"
 *
 * Server-rendered: the line arrives in London words from `parent-view.ts`. Nothing renders without a card.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { PARENT_COPY } from "@/lib/calls/copy";
import { CALL_PAGE_PATH } from "@/lib/calls/next-path";
import type { HubCallCard } from "@/lib/calls/parent-view";

const LINK = "font-semibold text-violet-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2";

export function CallHubCard({ card }: { readonly card: HubCallCard | null }) {
  if (card === null) return null;
  return (
    <Card className="border-violet-200 bg-violet-50">
      <CardContent className="px-4 py-4">
        {card.kind === "booked" ? (
          <p className="text-sm font-medium text-slate-900">
            {card.line}
            {card.changeable && (
              <>
                {" · "}
                <Link href={CALL_PAGE_PATH} className={LINK}>
                  {PARENT_COPY.change}
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="text-sm">
            <Link href={CALL_PAGE_PATH} className={LINK}>
              {card.line}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
