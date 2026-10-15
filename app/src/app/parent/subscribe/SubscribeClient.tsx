"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createCheckoutSession } from "@/lib/actions/payments/checkout";
import { ACCESS_AGE_YEARS, PRICES, TRIAL_DAYS } from "@/config/prices";
import { APP_LOCALE } from "@/lib/constants";

// 4b (ADR-091): both prices come from `config/prices.ts`. Whole pounds render without pence.
const PENCE_PER_POUND = 100;
function formatPence(pence: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: PRICES.currency.toUpperCase(),
    minimumFractionDigits: pence % PENCE_PER_POUND === 0 ? 0 : 2,
  }).format(pence / PENCE_PER_POUND);
}

// 4g (ADR-083): upfront runs to this birthday; "3rd" while ACCESS_AGE_YEARS is 3.
const ORDINAL_SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
const ACCESS_BIRTHDAY = `${ACCESS_AGE_YEARS}${ORDINAL_SUFFIX[ACCESS_AGE_YEARS] ?? "th"} birthday`;

// 4g: upfront is cheaper than monthly for a child younger than this many months — the months to the access
// birthday less the months of monthly payments the upfront price buys. Derived from config, never written down.
const MONTHS_PER_YEAR = 12;
const BEST_VALUE_UNDER_MONTHS =
  ACCESS_AGE_YEARS * MONTHS_PER_YEAR -
  Math.ceil(
    PRICES.selfServe.upfrontToAge3Pence / PRICES.selfServe.monthlyPence,
  );

interface NannyContext {
  nannyFirstName: string;
  childFirstName: string;
}

interface SubscribeClientProps {
  trialAvailable: boolean;
  /** Set when arriving via a nanny share link — drives the
   *  personalised header copy + reinforces the relational frame. */
  nannyContext: NannyContext | null;
}

export function SubscribeClient({
  trialAvailable,
  nannyContext,
}: SubscribeClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<"monthly" | "upfront" | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function subscribe(plan: "monthly" | "upfront") {
    setError(null);
    setActivePlan(plan);
    startTransition(async () => {
      const result = await createCheckoutSession({ plan });
      if (!result.success || !result.data) {
        setError(
          result.error === "test_users_cannot_pay"
            ? "Test accounts have full access — no payment needed."
            : result.error === "payments_disabled"
              ? "Subscriptions are temporarily unavailable. Please try again later."
              : (result.error ?? "Couldn't start checkout."),
        );
        setActivePlan(null);
        return;
      }
      // Hand off to Stripe Checkout.
      router.push(result.data.url);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {nannyContext ? (
        <>
          <h1 className="text-2xl font-bold text-slate-900">
            {nannyContext.nannyFirstName} wants to keep supporting{" "}
            {nannyContext.childFirstName}&apos;s development with you
          </h1>
          <p className="mt-2 text-slate-600">
            Subscribe to continue {nannyContext.childFirstName}&apos;s feed —
            activities, milestones, and your nanny&apos;s notes.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-slate-900">
            Subscribe to support your child&apos;s development
          </h1>
          <p className="mt-2 text-slate-600">
            Follow daily activities, milestones, and your nanny&apos;s notes —
            all in one place.
          </p>
        </>
      )}

      {trialAvailable && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <p className="text-sm text-violet-900">
            <strong>Start with a {TRIAL_DAYS}-day trial.</strong> No charge
            today. Choose how you&apos;d like to pay when the trial ends.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Upfront card shown FIRST as the high anchor. Per spec §S7
          psychology — the upfront price sets the anchor; the monthly price
          appearing second reads as "reasonable" by comparison. Reversing the
          order makes the monthly look expensive on its own.
          "Pay once. Done until your child's 3rd birthday." moves the cost
          from the "subscription" bucket to "investment" (ADR-083). */}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card
          data-testid="plan-card-upfront"
          className="relative flex flex-col border-violet-200"
        >
          <span className="absolute -top-3 right-4 rounded-full bg-violet-600 px-3 py-0.5 text-xs font-medium text-white">
            Best value
          </span>
          <CardContent className="flex flex-1 flex-col gap-4 p-6">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
                Upfront
              </p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {formatPence(PRICES.selfServe.upfrontToAge3Pence)}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              Pay once. Done until your child&apos;s {ACCESS_BIRTHDAY}. Best
              value if your child is under {BEST_VALUE_UNDER_MONTHS} months.
            </p>
            <div className="flex-1" />
            <Button
              size="lg"
              className="w-full bg-violet-600 hover:bg-violet-700"
              disabled={isPending}
              onClick={() => subscribe("upfront")}
            >
              {activePlan === "upfront" && isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Pay upfront"
              )}
            </Button>
            {trialAvailable && (
              <p className="text-xs text-slate-500">
                Trial first — charged after {TRIAL_DAYS} days.
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="plan-card-monthly" className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-4 p-6">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
                Monthly
              </p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {formatPence(PRICES.selfServe.monthlyPence)}
                <span className="text-base font-normal text-slate-500">
                  /month
                </span>
              </p>
            </div>
            <p className="text-sm text-slate-600">
              Cancel anytime. Pay as you go.
            </p>
            <div className="flex-1" />
            <Button
              size="lg"
              variant="outline"
              className="w-full border-violet-300 text-violet-700 hover:bg-violet-50"
              disabled={isPending}
              onClick={() => subscribe("monthly")}
            >
              {activePlan === "monthly" && isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Subscribe monthly"
              )}
            </Button>
            {trialAvailable && (
              <p className="text-xs text-slate-500">
                Trial first — charged after {TRIAL_DAYS} days.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4g: the "supports your nanny" line is gone (cards 9a/9b — nothing replaces it); VAT shows only where
          card details are entered, on Stripe's page (M-1 1d). */}
      <p className="mt-8 text-xs text-slate-500">
        By subscribing you agree to our terms of service.
      </p>
    </div>
  );
}
