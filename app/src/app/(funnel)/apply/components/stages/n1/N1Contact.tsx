"use client";

import { useState, useCallback } from "react";
import { StageProps } from "../../FunnelOrchestrator";
import { CompoundPageShell } from "../../shared/CompoundPageShell";
import { ProgressiveReveal } from "../../shared/ProgressiveReveal";
import { createNannyLead } from "@/lib/actions/nanny-leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check } from "lucide-react";
import Link from "next/link";
import {
  formatUkMobile,
  isUkMobile,
  normaliseUkMobile,
} from "@/lib/uk-contact";

export function N1Contact({
  state,
  dispatch,
  goNext,
  goBack,
  progress,
  questionNumber,
}: StageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateContact = useCallback(
    (
      payload: Partial<
        Pick<typeof state, "first_name" | "last_name" | "email" | "phone">
      >,
    ) => {
      dispatch({ type: "UPDATE_CONTACT", payload });
    },
    [dispatch],
  );

  const hasNames =
    state.first_name.trim() !== "" && state.last_name.trim() !== "";
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);
  const hasEmail = state.email.trim() !== "" && emailValid;
  const phoneValid = isUkMobile(state.phone);
  const canSubmit = hasNames && hasEmail && phoneValid;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    const result = await createNannyLead({
      first_name: state.first_name.trim(),
      last_name: state.last_name.trim(),
      email: state.email.trim().toLowerCase(),
      phone: normaliseUkMobile(state.phone),
      identity: state.identity,
      experience: state.experience,
      qualifications: state.qualifications,
      residency: state.residency,
      lead_signals: state.lead_signals,
    });

    if (result.success && result.leadId) {
      dispatch({ type: "SET_LEAD_ID", payload: result.leadId });
      goNext();
    } else {
      setError(result.error || "Something went wrong. Please try again.");
    }

    setSubmitting(false);
  };

  return (
    <CompoundPageShell
      title="How We Can Reach You"
      subtitle="How can we reach you with the result of your application?"
      progress={progress}
      showBack={true}
      onBack={goBack}
      questionNumber={questionNumber}
    >
      <div className="flex flex-col gap-4">
        {/* First & last name on same row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-slate-700">
              First name
            </Label>
            <Input
              type="text"
              value={state.first_name}
              onChange={(e) => updateContact({ first_name: e.target.value })}
              placeholder="First name"
              className="h-11 border-slate-200 focus:border-violet-500 focus:ring-violet-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-slate-700">
              Last name
            </Label>
            <Input
              type="text"
              value={state.last_name}
              onChange={(e) => updateContact({ last_name: e.target.value })}
              placeholder="Last name"
              className="h-11 border-slate-200 focus:border-violet-500 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* Email — reveals after names filled */}
        <ProgressiveReveal show={hasNames}>
          <div className="flex flex-col gap-1.5 pt-1">
            <Label className="text-sm font-medium text-slate-700">
              Email address
            </Label>
            <Input
              type="email"
              value={state.email}
              onChange={(e) => updateContact({ email: e.target.value })}
              placeholder="your@email.com"
              className="h-11 border-slate-200 focus:border-violet-500 focus:ring-violet-500"
            />
          </div>
        </ProgressiveReveal>

        {/* Phone — reveals after email filled, UK format with +44 prefix */}
        <ProgressiveReveal show={hasEmail}>
          <div className="flex flex-col gap-1.5 pt-1">
            <Label className="text-sm font-medium text-slate-700">
              Phone number
            </Label>
            <div className="flex gap-2">
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 h-11 text-sm text-slate-700 flex-shrink-0">
                <span>+44</span>
              </div>
              <div className="flex-1">
                <Input
                  type="tel"
                  value={state.phone}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9 ]/g, "");
                    updateContact({ phone: cleaned });
                  }}
                  placeholder="07XXX XXX XXX"
                  maxLength={13}
                  className="h-11 border-slate-200 focus:border-violet-500 focus:ring-violet-500"
                />
              </div>
            </div>
            {phoneValid && (
              <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                {formatUkMobile(state.phone)}
                <Check className="h-3 w-3" />
              </p>
            )}
          </div>
        </ProgressiveReveal>

        {error === "account_exists" && (
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 flex flex-col gap-2">
            <p className="text-sm text-violet-700 font-medium">
              An account with this email already exists.
            </p>
            <Link href="/login">
              <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white h-10 text-sm font-medium">
                Log in
              </Button>
            </Link>
          </div>
        )}

        {error && error !== "account_exists" && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
            {error}
          </p>
        )}

        <ProgressiveReveal show={canSubmit}>
          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-4">
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Application"
                )}
              </Button>
            </div>
          </div>
        </ProgressiveReveal>
      </div>
    </CompoundPageShell>
  );
}
