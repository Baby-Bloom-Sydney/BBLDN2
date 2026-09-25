"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ConnectionRequestWithDetails,
  cancelConnectionRequest,
  scheduleConnectionTime,
} from "@/lib/actions/connection";
import { confirmPlacement } from "@/lib/actions/position-funnel";
import { recordInformedAction } from "@/lib/legal/record-consent";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import {
  formatSydneyDate,
  TIME_BRACKETS,
  BRACKET_KEYS,
  getBracketTimeOptions,
} from "@/lib/timezone";
import {
  Clock,
  Phone,
  Loader2,
  Check,
  X,
  Calendar,
  UserCheck,
  Award,
  Star,
} from "lucide-react";
import { ConnectionTile } from "@/components/connections/ConnectionTile";

interface ParentConnectionsClientProps {
  requests: ConnectionRequestWithDetails[];
}

export function ParentConnectionsClient({
  requests,
}: ParentConnectionsClientProps) {
  const router = useRouter();
  const [selectedRequest, setSelectedRequest] =
    useState<ConnectionRequestWithDetails | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Connections awaiting parent confirmation (Path A — nanny reported hired)
  const awaitingConfirmation = requests.filter(
    (r) =>
      r.connection_stage === CONNECTION_STAGE.OFFERED &&
      r.fill_initiated_by === "nanny",
  );
  const confirmed = requests.filter((r) => r.status === "confirmed");
  const accepted = requests.filter((r) => r.status === "accepted");
  const pending = requests.filter((r) => r.status === "pending");
  const past = requests.filter((r) =>
    ["declined", "cancelled", "expired"].includes(r.status),
  );

  const handleConfirmPlacement = async (requestId: string) => {
    setConfirmingId(requestId);
    setConfirmError(null);

    recordInformedAction({
      agreementId: "AGR-10",
      buttonText: "Confirm Placement",
      modalContentVersion: "v3.0-2026-03-23",
      relatedEntityId: requestId,
    }).catch(() => {});

    const result = await confirmPlacement(requestId);
    setConfirmingId(null);
    if (!result.success) {
      setConfirmError(result.error || "Failed to confirm placement.");
    } else {
      router.refresh();
    }
  };

  return (
    <div className="space-y-8">
      {/* Detail Modal */}
      {selectedRequest && (
        <ConnectionDetailModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onAction={() => {
            setSelectedRequest(null);
            router.refresh();
          }}
        />
      )}

      {/* Confirm Placement — Path A: nanny reported hired */}
      {awaitingConfirmation.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-green-700">
            <Award className="h-5 w-5" />
            Confirm Placement ({awaitingConfirmation.length})
          </h2>
          {confirmError && (
            <p className="text-sm text-red-600 px-1">{confirmError}</p>
          )}
          <div className="grid gap-3">
            {awaitingConfirmation.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border-2 border-green-300 bg-green-50 p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  {req.nanny?.profile_picture_url ? (
                    <img
                      src={req.nanny.profile_picture_url}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-200">
                      <span className="text-sm font-semibold text-green-700">
                        {req.nanny?.first_name?.[0]}
                        {req.nanny?.last_name?.[0]}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-slate-900">
                      {req.nanny?.first_name} {req.nanny?.last_name?.[0]}.
                    </p>
                    <p className="text-sm text-green-700">
                      {req.nanny?.first_name} has indicated they&apos;ve been
                      selected for your position
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  By confirming, you agree to the{" "}
                  <Link
                    href="/legal/client-terms"
                    target="_blank"
                    className="text-violet-500 hover:underline"
                  >
                    Terms
                  </Link>{" "}
                  &amp;{" "}
                  <Link
                    href="/legal/privacy-policy"
                    target="_blank"
                    className="text-violet-500 hover:underline"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedRequest(req)}
                  >
                    View Details
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    disabled={confirmingId === req.id}
                    onClick={() => handleConfirmPlacement(req.id)}
                  >
                    {confirmingId === req.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Confirming...
                      </>
                    ) : (
                      <>
                        <Star className="mr-2 h-4 w-4" />
                        Confirm Placement
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirmed Intros */}
      {confirmed.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-green-700">
            <Check className="h-5 w-5" />
            Upcoming Intros ({confirmed.length})
          </h2>
          <div className="grid gap-3">
            {confirmed.map((req) => (
              <ConnectionTile
                key={req.id}
                request={req}
                viewerRole="parent"
                onClick={() => setSelectedRequest(req)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Schedule Intro — Accepted by nanny */}
      {accepted.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-blue-700">
            <UserCheck className="h-5 w-5" />
            Schedule Intro ({accepted.length})
          </h2>
          <div className="grid gap-3">
            {accepted.map((req) => (
              <ConnectionTile
                key={req.id}
                request={req}
                viewerRole="parent"
                onClick={() => setSelectedRequest(req)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Awaiting Response */}
      {pending.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-700">
            <Clock className="h-5 w-5" />
            Awaiting Response ({pending.length})
          </h2>
          <div className="grid gap-3">
            {pending.map((req) => (
              <ConnectionTile
                key={req.id}
                request={req}
                viewerRole="parent"
                onClick={() => setSelectedRequest(req)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Past */}
      {past.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-500">
            Past ({past.length})
          </h2>
          <div className="grid gap-2">
            {past.map((req) => (
              <ConnectionTile
                key={req.id}
                request={req}
                viewerRole="parent"
                onClick={() => setSelectedRequest(req)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Connection Detail Modal ──

function ConnectionDetailModal({
  request,
  onClose,
  onAction,
}: {
  request: ConnectionRequestWithDetails;
  onClose: () => void;
  onAction: () => void;
}) {
  const [step, setStep] = useState<"details" | "schedule">("details");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const isPending = request.status === "pending";
  const isAccepted = request.status === "accepted";
  const isConfirmed = request.status === "confirmed";
  const isPast = ["declined", "cancelled", "expired"].includes(request.status);

  // Availability grid data
  const availableSlots = new Set(request.proposed_times || []);
  const uniqueDates = Array.from(
    new Set((request.proposed_times || []).map((s) => s.split("_")[0])),
  ).sort();

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
    const day = date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    return { weekday, day };
  };

  // Time picker
  const selectedBracketKey = selectedSlot
    ? (selectedSlot.split("_")[1] as keyof typeof TIME_BRACKETS)
    : null;
  const selectedDate = selectedSlot ? selectedSlot.split("_")[0] : null;
  const timeGrid: { hour: number; minute: number; label: string }[][] = [];
  if (selectedBracketKey) {
    const options = getBracketTimeOptions(selectedBracketKey);
    for (let row = 0; row < 3; row++) {
      timeGrid.push(options.slice(row * 4, row * 4 + 4));
    }
  }

  const hasSelectedTime =
    selectedHour !== null && selectedMinute !== null && selectedDate;

  const getConfirmationLabel = () => {
    if (!selectedDate || selectedHour === null || selectedMinute === null)
      return "";
    const { weekday, day } = formatDate(selectedDate);
    const period = selectedHour >= 12 ? "PM" : "AM";
    const displayHour =
      selectedHour > 12
        ? selectedHour - 12
        : selectedHour === 0
          ? 12
          : selectedHour;
    const displayMin = selectedMinute.toString().padStart(2, "0");
    return `${weekday} ${day} at ${displayHour}:${displayMin} ${period}`;
  };

  const handleSchedule = async () => {
    if (!selectedDate || selectedHour === null || selectedMinute === null)
      return;
    setSubmitting(true);
    setError(null);
    const result = await scheduleConnectionTime(
      request.id,
      selectedDate,
      selectedHour,
      selectedMinute,
    );
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Failed to schedule.");
    } else {
      onAction();
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    const result = await cancelConnectionRequest(request.id);
    setCancelling(false);
    if (!result.success) {
      setError(result.error || "Failed to cancel.");
    } else {
      onAction();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {request.nanny?.profile_picture_url ? (
                <img
                  src={request.nanny.profile_picture_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${isConfirmed ? "bg-green-100" : isAccepted ? "bg-blue-100" : "bg-violet-100"}`}
                >
                  <span
                    className={`text-sm font-semibold ${isConfirmed ? "text-green-700" : isAccepted ? "text-blue-700" : "text-violet-600"}`}
                  >
                    {request.nanny?.first_name?.[0]}
                    {request.nanny?.last_name?.[0]}
                  </span>
                </div>
              )}
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  {request.nanny?.first_name} {request.nanny?.last_name?.[0]}.
                  <Link
                    href={`/nannies/${request.nanny_id}`}
                    className="text-xs font-normal text-violet-500 hover:text-violet-700 transition-colors"
                  >
                    View Profile
                  </Link>
                </CardTitle>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ── Step 2: Schedule time picker ── */}
          {isAccepted && step === "schedule" ? (
            <div className="space-y-4">
              {/* Availability grid — dates as rows, brackets as columns */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {request.nanny?.first_name}&apos;s availability
                </p>

                <div className="overflow-x-auto">
                  <div className="min-w-[340px]">
                    {/* Bracket column headers */}
                    <div className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                      <div />
                      {BRACKET_KEYS.map((bracket) => (
                        <div key={bracket} className="text-center">
                          <p className="text-xs font-semibold text-slate-600">
                            {TIME_BRACKETS[bracket].label}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {TIME_BRACKETS[bracket].sublabel}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Date rows */}
                    {uniqueDates.map((date) => {
                      const { weekday, day } = formatDate(date);
                      return (
                        <div
                          key={date}
                          className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1"
                        >
                          <div className="flex items-center">
                            <div>
                              <p className="text-xs font-semibold text-slate-600">
                                {weekday}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {day}
                              </p>
                            </div>
                          </div>
                          {BRACKET_KEYS.map((bracket) => {
                            const slot = `${date}_${bracket}`;
                            const isAvailable = availableSlots.has(slot);
                            const isSelected = selectedSlot === slot;
                            return (
                              <button
                                key={slot}
                                type="button"
                                disabled={!isAvailable}
                                onClick={() => {
                                  if (!isAvailable) return;
                                  setSelectedSlot(isSelected ? null : slot);
                                  setSelectedHour(null);
                                  setSelectedMinute(null);
                                }}
                                className={`h-10 rounded-md border text-xs font-medium transition-colors ${
                                  isSelected
                                    ? "bg-violet-600 text-white border-violet-600 cursor-pointer"
                                    : isAvailable
                                      ? "bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400 cursor-pointer"
                                      : "bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed"
                                }`}
                              >
                                {isAvailable
                                  ? isSelected
                                    ? "\u2713"
                                    : ""
                                  : ""}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 4×3 time picker */}
              {selectedSlot && selectedBracketKey && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">
                    Select a time
                  </p>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="grid grid-cols-4 gap-1.5">
                      {timeGrid.flat().map((opt) => {
                        const isSelected =
                          selectedHour === opt.hour &&
                          selectedMinute === opt.minute;
                        return (
                          <button
                            key={`${opt.hour}-${opt.minute}`}
                            type="button"
                            onClick={() => {
                              setSelectedHour(opt.hour);
                              setSelectedMinute(opt.minute);
                            }}
                            className={`py-2.5 rounded-md border text-sm font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-violet-600 text-white border-violet-600"
                                : "bg-white text-slate-700 border-slate-200 hover:border-violet-400"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Confirmation */}
              {hasSelectedTime && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-800">
                    {getConfirmationLabel()}
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setStep("details");
                    setSelectedSlot(null);
                    setSelectedHour(null);
                    setSelectedMinute(null);
                    setError(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-violet-500 hover:bg-violet-600"
                  disabled={!hasSelectedTime || submitting}
                  onClick={handleSchedule}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Scheduling...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4" />
                      Confirm Intro
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            /* ── Step 1: Details view ── */
            <>
              {/* Status info */}
              {isPending && (
                <div className="space-y-3">
                  <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    Awaiting Response
                  </span>
                  <p className="text-sm text-slate-500">
                    Waiting for {request.nanny?.first_name} to respond to your
                    connection request...
                  </p>
                  {request.message && (
                    <p className="text-sm text-slate-500 italic">
                      &ldquo;{request.message}&rdquo;
                    </p>
                  )}
                </div>
              )}

              {isAccepted && (
                <div className="space-y-3">
                  <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    Accepted
                  </span>
                  <p className="text-sm text-slate-700">
                    {request.nanny?.first_name} would love to meet you! Pick a
                    time that works for your meet and greet.
                  </p>
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <Phone className="h-4 w-4 text-blue-600 flex-shrink-0" />
                    <p className="text-xs text-blue-700">
                      Once you confirm a time, {request.nanny?.first_name}
                      &apos;s phone number will be shared with you.
                    </p>
                  </div>
                  <Button
                    className="w-full bg-violet-500 hover:bg-violet-600"
                    onClick={() => setStep("schedule")}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    Pick a Time
                  </Button>
                </div>
              )}

              {isConfirmed && (
                <div className="space-y-3">
                  <span className="inline-block rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                    Meet Scheduled
                  </span>
                  {request.confirmed_time && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-green-600" />
                        <p className="text-sm font-medium text-green-800">
                          {formatSydneyDate(request.confirmed_time)} (AEST)
                        </p>
                      </div>
                      {request.nanny_phone_shared && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-green-600" />
                          <p className="text-lg font-bold text-green-800">
                            {request.nanny_phone_shared}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    Please call {request.nanny?.first_name} at the scheduled
                    time. We encourage you to message them beforehand to
                    connect.
                  </p>
                </div>
              )}

              {isPast && (
                <div className="space-y-2">
                  {request.status === "declined" && (
                    <span className="inline-block rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                      Declined
                    </span>
                  )}
                  {request.status === "cancelled" && (
                    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      Cancelled
                    </span>
                  )}
                  {request.status === "expired" && (
                    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                      Expired
                    </span>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              {/* Cancel — available on pending, accepted, confirmed */}
              {!isPast && !showConfirmCancel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-500"
                  onClick={() => setShowConfirmCancel(true)}
                >
                  {isConfirmed ? "Cancel Intro" : "Cancel Request"}
                </Button>
              )}

              {!isPast && showConfirmCancel && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-600">
                    Cancel this {isConfirmed ? "meet and greet" : "request"}?
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowConfirmCancel(false)}
                  >
                    No
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={cancelling}
                    onClick={handleCancel}
                  >
                    {cancelling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-3 w-3" />
                        Yes, Cancel
                      </>
                    )}
                  </Button>
                </div>
              )}

              <p className="text-xs text-slate-400">
                Sent {formatSydneyDate(request.created_at)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
