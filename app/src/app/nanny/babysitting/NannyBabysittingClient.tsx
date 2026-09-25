"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  requestBabysittingJob,
  declineBabysittingRequest,
  nannyCancelBabysittingRequest,
  type NannyBabysittingJob,
} from "@/lib/actions/babysitting";
import {
  Briefcase,
  Clock,
  MapPin,
  PoundSterling,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ShieldX,
  Baby,
  Check,
  XCircle,
  Sparkles,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { recordInformedAction } from "@/lib/legal/record-consent";
import { formatClockTime as formatTime } from "@/lib/timezone";

// ── Helpers ──

function formatTimeLeft(expiresAt: string | null): { text: string; urgent: boolean } {
  if (!expiresAt) return { text: "", urgent: false };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { text: "Expired", urgent: true };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours < 6) return { text: `${hours}h ${minutes}m left`, urgent: true };
  if (hours < 24) return { text: `${hours}h left`, urgent: false };
  const days = Math.floor(hours / 24);
  return { text: `${days}d ${hours % 24}h left`, urgent: false };
}

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatChildAge(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

// ── Main Component ──

interface NannyBabysittingClientProps {
  jobs: NannyBabysittingJob[];
  banned: boolean;
  banUntil: string | null;
  hideHeader?: boolean;
  shareUnlocked?: boolean;
}

export function NannyBabysittingClient({ jobs, banned, banUntil, hideHeader, shareUnlocked = false }: NannyBabysittingClientProps) {
  const router = useRouter();
  const [selectedJob, setSelectedJob] = useState<NannyBabysittingJob | null>(null);
  const [showPast, setShowPast] = useState(false);

  // Sort by earliest upcoming slot date (chronological)
  const sortByNextSlot = (a: NannyBabysittingJob, b: NannyBabysittingJob) => {
    const aDate = a.slots.length > 0 ? a.slots.reduce((min, s) => s.slot_date < min ? s.slot_date : min, a.slots[0].slot_date) : "9999";
    const bDate = b.slots.length > 0 ? b.slots.reduce((min, s) => s.slot_date < min ? s.slot_date : min, b.slots[0].slot_date) : "9999";
    return aDate.localeCompare(bDate);
  };

  // Group jobs
  const available = jobs.filter(
    (j) =>
      j.status === "open" &&
      !j.notification.requestedAt &&
      !j.notification.declinedAt &&
      !j.notification.notifiedFilled &&
      j.accepted_nanny_id === null
  ).sort(sortByNextSlot);
  const requested = jobs.filter(
    (j) =>
      j.status === "open" &&
      !!j.notification.requestedAt &&
      !j.notification.acceptedAt &&
      !j.notification.declinedAt &&
      !j.notification.notifiedFilled
  ).sort(sortByNextSlot);
  const accepted = jobs.filter(
    (j) => j.status === "filled" && j.notification.acceptedAt
  ).sort(sortByNextSlot);
  const past = jobs.filter(
    (j) =>
      j.notification.declinedAt ||
      j.notification.notifiedFilled ||
      ["expired", "cancelled", "nanny_cancelled", "completed"].includes(j.status)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      {!hideHeader && (
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Babysitting Jobs</h1>
          <p className="mt-1 text-slate-500">
            View and respond to one-time babysitting opportunities
          </p>
        </div>
      )}

      {/* Ban Banner */}
      {banned && banUntil && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <ShieldX className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Babysitting Suspended</p>
            <p className="text-sm text-red-700 mt-0.5">
              Due to multiple cancellations, you are suspended from accepting babysitting
              jobs until{" "}
              {new Date(banUntil).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              . You can still view job details.
            </p>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          banned={banned}
          onClose={() => setSelectedJob(null)}
          onAction={() => {
            setSelectedJob(null);
            router.refresh();
          }}
        />
      )}

      {/* ═══ UNIFIED CARD ═══ */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* Card header */}
        <div className="flex items-center gap-2 mb-4">
          <Briefcase className="h-5 w-5 text-violet-600" />
          <p className="text-base font-semibold text-slate-800">Jobs</p>
        </div>

        {/* Empty state / share CTA when no current jobs */}
        {available.length === 0 && requested.length === 0 && accepted.length === 0 && (
          !shareUnlocked ? (
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4 text-center space-y-2">
              <p className="text-sm text-slate-600">
                Share your profile to start receiving babysitting job notifications
              </p>
              <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700">
                <Link href="/nanny/share">
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Unlock babysitting
                </Link>
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400">
                No babysitting jobs right now. When families in your area need a babysitter, they&apos;ll appear here.
              </p>
            </div>
          )
        )}

        {jobs.length > 0 && (
          <>
            {/* ── Available ── */}
            {available.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Available ({available.length})
                </p>
                <div className="grid gap-3">
                  {available.map((job) => (
                    <JobTile
                      key={job.id}
                      job={job}
                      type="available"
                      onClick={() => setSelectedJob(job)}
                      locked={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Requested ── */}
            {requested.length > 0 && (
              <div className={`${available.length > 0 ? "mt-5 pt-5 border-t border-slate-100" : ""}`}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Requested ({requested.length})
                </p>
                <div className="grid gap-3">
                  {requested.map((job) => (
                    <JobTile
                      key={job.id}
                      job={job}
                      type="requested"
                      onClick={() => setSelectedJob(job)}
                      locked={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Your Jobs (accepted) ── */}
            {accepted.length > 0 && (
              <div className={`${available.length > 0 || requested.length > 0 ? "mt-5 pt-5 border-t border-slate-100" : ""}`}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Your Jobs ({accepted.length})
                </p>
                <div className="grid gap-3">
                  {accepted.map((job) => (
                    <JobTile
                      key={job.id}
                      job={job}
                      type="accepted"
                      onClick={() => setSelectedJob(job)}
                      locked={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Past (collapsible) ── */}
            {past.length > 0 && (
              <div className={`${available.length > 0 || requested.length > 0 || accepted.length > 0 ? "mt-5 pt-5 border-t border-slate-100" : ""}`}>
                <button
                  onClick={() => setShowPast(!showPast)}
                  className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-slate-600 transition-colors"
                >
                  {showPast ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Past ({past.length})
                </button>
                {showPast && (
                  <div className="grid gap-2 mt-3">
                    {past.map((job) => (
                      <JobTile
                        key={job.id}
                        job={job}
                        type="past"
                        onClick={() => setSelectedJob(job)}
                        locked={false}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* ═══ END UNIFIED CARD ═══ */}
    </div>
  );
}

// ── Job Tile (compact list item) ──

function JobTile({
  job,
  type,
  onClick,
  locked,
}: {
  job: NannyBabysittingJob;
  type: "available" | "requested" | "accepted" | "past";
  onClick: () => void;
  locked?: boolean;
}) {
  const { text: timeLeft, urgent } = formatTimeLeft(job.expires_at);
  const hasClashes = job.clashSlotIds.length > 0;
  const allClash = job.clashSlotIds.length === job.slots.length;

  const borderColor =
    type === "available"
      ? hasClashes
        ? "border-amber-200"
        : "border-violet-200"
      : type === "requested"
      ? "border-amber-200"
      : type === "accepted"
      ? "border-green-200"
      : "border-slate-200";

  const firstSlot = job.slots?.[0];

  const pastLabel = job.notification.declinedAt
    ? "Declined"
    : job.notification.notifiedFilled
    ? "Filled"
    : job.status === "expired"
    ? "Expired"
    : job.status === "cancelled"
    ? "Cancelled"
    : job.status === "nanny_cancelled"
    ? "You Cancelled"
    : job.status === "completed"
    ? "Completed"
    : "Closed";

  const pastStyle = job.notification.declinedAt
    ? "bg-slate-100 text-slate-600"
    : job.notification.notifiedFilled
    ? "bg-violet-100 text-violet-700"
    : job.status === "nanny_cancelled"
    ? "bg-red-100 text-red-700"
    : job.status === "completed"
    ? "bg-green-100 text-green-700"
    : "bg-slate-100 text-slate-600";

  return (
    <button
      onClick={onClick}
      className={`relative w-full text-left rounded-lg border ${borderColor} bg-white p-4 ${locked ? "" : "hover:bg-slate-50"} transition-colors cursor-pointer ${
        type === "past" ? "opacity-75" : ""
      }`}
    >
      {locked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 shadow-sm">
            <Lock className="h-4 w-4 text-slate-400" />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {firstSlot && (
              <p className="text-sm font-medium text-slate-900">
                {formatSlotDate(firstSlot.slot_date)}
                {job.slots.length > 1 && (
                  <span className="text-slate-400">
                    {" "}
                    +{job.slots.length - 1} more
                  </span>
                )}
              </p>
            )}
            {type === "available" && hasClashes && (
              <span className="flex items-center gap-0.5 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {allClash ? "All clash" : "Clash"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {firstSlot && (
              <>
                {formatTime(firstSlot.start_time)} – {formatTime(firstSlot.end_time)}
              </>
            )}
            <span> · {type === "accepted" && job.address ? `${job.address}, ${job.suburb}` : job.suburb}</span>
            {job.notification.distanceKm !== null && (
              <span>
                {" "}
                · {job.notification.distanceKm < 1 ? "<1" : job.notification.distanceKm} km
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {type === "available" && timeLeft && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                urgent ? "bg-red-100 text-red-700" : "bg-violet-50 text-violet-700"
              }`}
            >
              <Clock className="h-3 w-3" />
              {timeLeft}
            </span>
          )}
          {type === "requested" && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              <Clock className="h-3 w-3" />
              Requested
            </span>
          )}
          {type === "accepted" && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <CheckCircle className="h-3 w-3" />
              Accepted
            </span>
          )}
          {type === "past" && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pastStyle}`}
            >
              {pastLabel}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}

// ── Job Detail Modal ──

function JobDetailModal({
  job,
  banned,
  onClose,
  onAction,
}: {
  job: NannyBabysittingJob;
  banned: boolean;
  onClose: () => void;
  onAction: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAvailable =
    job.status === "open" &&
    !job.notification.requestedAt &&
    !job.notification.declinedAt &&
    !job.notification.notifiedFilled;
  const isRequested =
    job.status === "open" &&
    !!job.notification.requestedAt &&
    !job.notification.acceptedAt &&
    !job.notification.declinedAt;
  const isAccepted = job.status === "filled" && job.notification.acceptedAt;
  const hasClashes = job.clashSlotIds.length > 0;
  const allClash = job.clashSlotIds.length === job.slots.length;

  const handleRequest = async () => {
    setError(null);
    setAccepting(true);

    // Record informed consent — non-blocking
    recordInformedAction({
      agreementId: 'AGR-09',
      buttonText: 'Request Job',
      modalContentVersion: 'v3.0-2026-03-23',
      relatedEntityId: job.id,
    }).catch(() => {});

    const result = await requestBabysittingJob(job.id);
    setAccepting(false);
    if (!result.success) {
      setError(result.error || "Failed to accept");
    } else {
      onAction();
    }
  };

  const handleDecline = async () => {
    setDeclining(true);
    setError(null);
    const result = await declineBabysittingRequest(job.id);
    setDeclining(false);
    if (!result.success) {
      setError(result.error || "Failed to decline");
    } else {
      onAction();
    }
  };

  const handleNannyCancel = async () => {
    setCancelling(true);
    setError(null);
    const result = await nannyCancelBabysittingRequest(job.id);
    setCancelling(false);
    if (!result.success) {
      setError(result.error || "Failed to cancel");
    } else {
      onAction();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Babysitting Job</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          {isAvailable && (
            <div className="space-y-2">
              <span className="inline-block rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                Available
              </span>
              {job.expires_at && (
                <p className="text-xs text-slate-400">
                  Expires{" "}
                  {new Date(job.expires_at).toLocaleString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          )}

          {isRequested && (
            <div className="space-y-2">
              <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Requested — Waiting for Parent
              </span>
              <p className="text-sm text-slate-500">
                The family is reviewing requests. You&apos;ll be notified if they choose you.
              </p>
            </div>
          )}

          {isAccepted && (
            <span className="inline-block rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
              You Got This Job
            </span>
          )}

          {!isAvailable && !isRequested && !isAccepted && (
            <div>
              {job.notification.declinedAt && (
                <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Declined
                </span>
              )}
              {job.notification.notifiedFilled && !job.notification.acceptedAt && (
                <span className="inline-block rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                  Filled by Another Nanny
                </span>
              )}
              {job.status === "expired" && !job.notification.declinedAt && !job.notification.notifiedFilled && (
                <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                  Expired
                </span>
              )}
              {job.status === "cancelled" && (
                <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Cancelled by Parent
                </span>
              )}
              {job.status === "nanny_cancelled" && (
                <span className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                  You Cancelled
                </span>
              )}
              {job.status === "completed" && (
                <span className="inline-block rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  Completed
                </span>
              )}
            </div>
          )}

          {/* Clash Warning */}
          {isAvailable && hasClashes && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                {allClash
                  ? "All time slots clash with your existing accepted jobs (2h buffer)."
                  : "Some time slots clash with your existing accepted jobs (2h buffer). Clashing slots are marked below."}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
              {job.slots.map((slot) => {
                const isClash = job.clashSlotIds.includes(slot.id);

                return (
                  <div
                    key={slot.id}
                    className={`flex items-center justify-between px-3 py-2.5 ${
                      isClash ? "opacity-50" : ""
                    }`}
                  >
                    <span className="text-sm text-slate-700">
                      {formatSlotDate(slot.slot_date)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </span>
                      {isClash && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          Clash
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          {/* Children */}
          {job.children.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Baby className="h-3.5 w-3.5" />
                Children
              </p>
              <p className="text-sm text-slate-500">
                {job.children.length} child{job.children.length > 1 ? "ren" : ""}:{" "}
                {job.children.map((c, i) => (
                  <span key={i}>
                    {formatChildAge(c.age_months)}
                    {c.gender ? ` (${c.gender})` : ""}
                    {i < job.children.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            </div>
          )}

          {/* Details */}
          <div className="space-y-2 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" />
              <span>
                {isAccepted && job.address && <>{job.address}, </>}
                {job.suburb} {job.postcode}
                {job.notification.distanceKm !== null && (
                  <span className="text-slate-400">
                    {" "}({job.notification.distanceKm < 1 ? "<1" : job.notification.distanceKm} km away)
                  </span>
                )}
              </span>
            </div>
            {(() => {
              let mins = 0;
              for (const s of job.slots) {
                if (s.start_time && s.end_time) {
                  const [sh, sm] = s.start_time.split(":").map(Number);
                  const [eh, em] = s.end_time.split(":").map(Number);
                  mins += (eh * 60 + em) - (sh * 60 + sm);
                }
              }
              const hrs = Math.round((mins / 60) * 10) / 10;
              return hrs > 0 ? (
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  {hrs} hrs total
                </div>
              ) : null;
            })()}
            {job.hourly_rate && (
              <div className="flex items-center gap-2">
                <PoundSterling className="h-3.5 w-3.5" />£{job.hourly_rate}/hr
                {(() => {
                  let mins = 0;
                  for (const s of job.slots) {
                    if (s.start_time && s.end_time) {
                      const [sh, sm] = s.start_time.split(":").map(Number);
                      const [eh, em] = s.end_time.split(":").map(Number);
                      mins += (eh * 60 + em) - (sh * 60 + sm);
                    }
                  }
                  const hrs = Math.round((mins / 60) * 10) / 10;
                  const est = Math.round(hrs * job.hourly_rate!);
                  return hrs > 0 ? <span> (est. £{est})</span> : null;
                })()}
              </div>
            )}
            {isAccepted && job.special_requirements && (
              <p className="text-sm text-slate-600 italic">
                &ldquo;{job.special_requirements}&rdquo;
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions for available jobs */}
          {isAvailable && !banned && !allClash && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 text-center">
                By requesting this job, your phone number will be shared with the family if they accept you.{" "}
                <Link href="/legal/professional-terms" target="_blank" className="text-violet-500 hover:underline">Terms</Link>
                {" "}&amp;{" "}
                <Link href="/legal/privacy-policy" target="_blank" className="text-violet-500 hover:underline">Privacy Policy</Link>.
              </p>
              <div className="flex gap-2">
              <Button
                className="flex-1 bg-violet-500 hover:bg-violet-600"
                disabled={accepting || declining}
                onClick={handleRequest}
              >
                {accepting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Request Job
              </Button>
              <Button
                variant="outline"
                className="text-slate-500"
                disabled={accepting || declining}
                onClick={handleDecline}
              >
                {declining ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-1 h-4 w-4" />
                )}
                Decline
              </Button>
              </div>
            </div>
          )}

          {isAvailable && banned && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              You are currently suspended from requesting babysitting jobs.
            </div>
          )}

          {isAvailable && !banned && allClash && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              All slots clash with your existing jobs. You can still decline this request.
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-500"
                  disabled={declining}
                  onClick={handleDecline}
                >
                  {declining ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <XCircle className="mr-1 h-3 w-3" />
                      Decline
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Withdraw for requested jobs */}
          {isRequested && (
            <Button
              variant="outline"
              size="sm"
              className="text-slate-500"
              disabled={declining}
              onClick={handleDecline}
            >
              {declining ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-3 w-3" />
              )}
              Withdraw Request
            </Button>
          )}

          {/* Cancel for accepted jobs */}
          {isAccepted && !showConfirmCancel && (
            <Button
              variant="outline"
              size="sm"
              className="text-slate-500"
              onClick={() => setShowConfirmCancel(true)}
            >
              Cancel This Job
            </Button>
          )}

          {isAccepted && showConfirmCancel && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-sm text-red-800 font-medium">
                Are you sure you want to cancel?
              </p>
              <p className="text-xs text-red-700">
                Cancelling accepted jobs counts against your record. 3 cancellations in 12 months will result in a 3-month suspension.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirmCancel(false)}
                >
                  Keep Job
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cancelling}
                  onClick={handleNannyCancel}
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
            </div>
          )}

          <p className="text-xs text-slate-400">
            Notified{" "}
            {new Date(job.notification.notifiedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
