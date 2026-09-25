"use client";

/**
 * Paywall — rendered in place of paid feature content when the family
 * has no active access.
 *
 * Spec: `system/APP/PAYMENTS/10-ui-surfaces.md` §1.
 *
 * Renders different copy + CTAs by role:
 * - Parent: subscribe / start trial buttons.
 * - Nanny: read-only "ask the family to renew" + button to open Katie chat.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface PaywallProps {
  childFirstName: string;
  /** Whether the parent has used their lifetime 30-day trial. Drives
   *  the CTA copy (trial-available vs subscribe-only). Ignored when
   *  `role === 'nanny'`. */
  hasUsedTrial?: boolean;
  /** Parent's first name — shown to nannies so they know who to nudge. */
  parentFirstName?: string;
  role: "parent" | "nanny";
}

export function Paywall({
  childFirstName,
  hasUsedTrial = false,
  parentFirstName,
  role,
}: PaywallProps) {
  const router = useRouter();

  if (role === "nanny") {
    return (
      <NannyPaywall
        childFirstName={childFirstName}
        parentFirstName={parentFirstName}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 px-4 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
        <Lock className="h-6 w-6 text-violet-600" />
      </div>
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-slate-900">
          You&apos;re missing {childFirstName}&apos;s feed
        </h1>
        <p className="text-base text-slate-600">
          Subscribe to Baby Bloom to track activities, milestones, and daily
          progress with your nanny.
        </p>
      </div>

      <Card className="w-full border-violet-200 bg-violet-50/50">
        <CardContent className="flex flex-col gap-4 p-5">
          {!hasUsedTrial ? (
            <>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                <p className="text-sm font-medium text-violet-900">
                  Try Baby Bloom free for 30 days
                </p>
              </div>
              <Button
                size="lg"
                className="w-full bg-violet-600 hover:bg-violet-700"
                onClick={() => router.push("/parent/subscribe?trial=true")}
              >
                Start 30-day free trial
              </Button>
              <p className="text-xs text-slate-500">
                No charge today. Cancel anytime before the trial ends.
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full bg-violet-600 hover:bg-violet-700"
                onClick={() => router.push("/parent/subscribe?plan=monthly")}
              >
                Subscribe — £200/month
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                onClick={() => router.push("/parent/subscribe?plan=upfront")}
              >
                Or pay upfront — £2,000
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Link
        href="/parent/subscription"
        className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        Cancelled by mistake? Manage subscription
      </Link>
    </div>
  );
}

function NannyPaywall({
  childFirstName,
  parentFirstName,
}: {
  childFirstName: string;
  parentFirstName?: string;
}) {
  const parentRef = parentFirstName ?? "the family";
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-6 px-4 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
        <Lock className="h-6 w-6 text-amber-600" />
      </div>
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-slate-900">
          {childFirstName}&apos;s family subscription has lapsed
        </h1>
        <p className="text-base text-slate-600">
          Once {parentRef} renews their subscription, {childFirstName}&apos;s
          feed will be restored — your notes and milestones are safe.
        </p>
      </div>
    </div>
  );
}
