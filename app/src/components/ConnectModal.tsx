"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createConnectionRequest } from "@/lib/actions/connection";
import { CONNECTION_ERRORS } from "@/lib/actions/connection-errors";
import { recordInformedAction } from "@/lib/legal/record-consent";
import {
  X,
  Loader2,
  MapPin,
  Check,
  Send,
  Phone,
  CalendarCheck,
  Heart,
  Clock,
  ClipboardList,
} from "lucide-react";
import Link from "next/link";

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  nanny: {
    id: string;
    first_name: string;
    last_name: string;
    suburb: string;
    hourly_rate_min: number | null;
    profile_picture_url?: string | null;
    date_of_birth?: string | null;
  };
  pendingRequestCount: number;
}

function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
  return years > 0 && years < 120 ? years : null;
}

const JOURNEY_STEPS = [
  { label: "Connect", icon: Send, description: "Send a connection request" },
  { label: "Meet", icon: Phone, description: "Schedule a meet and greet" },
  { label: "Trial", icon: CalendarCheck, description: "Arrange a trial shift" },
  { label: "Matched!", icon: Heart, description: "Start your placement" },
];

export function ConnectModal({
  isOpen,
  onClose,
  nanny,
  pendingRequestCount,
}: ConnectModalProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionRequired, setPositionRequired] = useState(false);

  if (!isOpen) return null;

  const atLimit = pendingRequestCount >= 5;
  const age = computeAge(nanny.date_of_birth);
  const firstName =
    nanny.first_name.charAt(0).toUpperCase() + nanny.first_name.slice(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (atLimit) {
      setError("You have reached the maximum of 5 open requests.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Record informed action (non-blocking, never blocks connection flow)
    recordInformedAction({
      agreementId: "AGR-06",
      buttonText: `Connect with ${firstName}`,
      modalContentVersion: "v3.0-2026-03-23",
    }).catch(() => {});

    const result = await createConnectionRequest(
      nanny.id,
      message || undefined,
    );

    setSubmitting(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
        router.push("/parent/connections");
      }, 3000);
    } else if (result.error === CONNECTION_ERRORS.POSITION_REQUIRED) {
      setPositionRequired(true);
    } else {
      setError(result.error || "Failed to send request");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <h2 className="text-lg font-bold text-slate-900">
            Connect with {firstName}
          </h2>
          <div className="flex items-center gap-3">
            {!success && !positionRequired && (
              <span
                className={`text-xs ${atLimit ? "text-red-500 font-semibold" : "text-slate-400"}`}
              >
                {pendingRequestCount}/5 ongoing
              </span>
            )}
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          {positionRequired ? (
            /* ── Position Required (T-041) ── */
            <div className="flex flex-col items-center py-6 space-y-4">
              <div
                aria-hidden="true"
                className="rounded-full bg-violet-50 border border-violet-200 p-3"
              >
                <ClipboardList className="h-7 w-7 text-violet-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Create your position first
              </h3>
              <p className="text-center text-sm text-slate-500 leading-relaxed">
                To connect with {firstName}, you&apos;ll need to tell us about
                your family&apos;s nanny needs. It only takes a few minutes.
              </p>
              <div className="flex gap-2.5 w-full pt-1">
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  asChild
                  className="flex-1 bg-violet-600 hover:bg-violet-700"
                >
                  <Link href="/parent/request">Create position</Link>
                </Button>
              </div>
            </div>
          ) : success ? (
            /* ── Success ── */
            <div className="flex flex-col items-center py-6">
              <div className="rounded-full bg-green-50 border border-green-200 p-3">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">
                Request Sent!
              </h3>
              <p className="mt-1.5 text-center text-sm text-slate-500 leading-relaxed">
                {firstName} will be notified and can respond from their inbox.
              </p>
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3.5 py-2.5 w-full">
                <Clock className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <p className="text-xs text-violet-600">
                  {firstName} has <span className="font-semibold">3 days</span>{" "}
                  to respond to your request.
                </p>
              </div>
            </div>
          ) : (
            /* ── Main Form ── */
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Nanny Card */}
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0">
                  {nanny.profile_picture_url ? (
                    <img
                      src={nanny.profile_picture_url}
                      alt={firstName}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-violet-100 flex items-center justify-center">
                      <span className="text-lg font-semibold text-violet-500">
                        {nanny.first_name[0]}
                        {nanny.last_name[0]}
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base text-slate-900">
                    {firstName}
                    {age ? `, ${age}` : ""}
                  </h3>
                  <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {nanny.suburb}
                  </p>
                </div>
              </div>

              {/* Journey Stepper */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3.5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Your journey
                </p>
                <div>
                  {JOURNEY_STEPS.map((step, i) => {
                    const isFirst = i === 0;
                    const isLast = i === JOURNEY_STEPS.length - 1;
                    const Icon = step.icon;
                    return (
                      <div key={step.label} className="flex gap-3">
                        <div className="flex w-5 shrink-0 flex-col items-center">
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                              isFirst
                                ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            {isFirst && (
                              <div className="h-2 w-2 rounded-full bg-violet-500" />
                            )}
                          </div>
                          {!isLast && (
                            <div
                              className={`w-0.5 flex-1 ${isFirst ? "bg-violet-200" : "bg-slate-100"}`}
                            />
                          )}
                        </div>
                        <div className={isLast ? "pb-0" : "pb-1"}>
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className={`h-3 w-3 ${isFirst ? "text-violet-500" : "text-slate-300"}`}
                            />
                            <p
                              className={`text-xs leading-5 ${
                                isFirst
                                  ? "font-semibold text-violet-700"
                                  : "font-medium text-slate-400"
                              }`}
                            >
                              {step.label}
                            </p>
                          </div>
                          {isFirst && (
                            <p className="text-[11px] text-violet-500/80 mt-0.5 ml-[18px]">
                              {step.description}
                            </p>
                          )}
                          {!isFirst && !isLast && <div className="h-1" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-1.5">
                <label
                  htmlFor="connect-message"
                  className="text-sm font-medium text-slate-700"
                >
                  Message{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="connect-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Introduce yourself and share any details about your family..."
                  className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-colors resize-none"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              {/* Terms notice */}
              <p className="text-[10px] text-slate-400 text-center">
                By connecting, you agree to our{" "}
                <Link
                  href="/legal/client-terms"
                  target="_blank"
                  className="text-violet-500 hover:underline"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  href="/legal/privacy-policy"
                  target="_blank"
                  className="text-violet-500 hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </p>

              {/* Actions */}
              <div className="flex gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-medium"
                  disabled={submitting || atLimit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    `Connect with ${firstName}`
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
