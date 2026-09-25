"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MapPin,
  Clock,
  PoundSterling,
  Calendar,
  Users,
  ChevronRight,
  Bell,
  Heart,
  Loader2,
  X,
  Baby,
  Phone,
  Mail,
  PawPrint,
  Pencil,
  Check,
  MoreHorizontal,
  Sparkles,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { formatLondonDate } from "@/lib/timezone";
import {
  CONNECTION_STAGE,
  CONNECTION_STAGE_LABELS,
} from "@/lib/position/constants";
import type { ConnectionStage } from "@/lib/position/constants";
import {
  reportIntroOutcome,
  reportTrialOutcome,
  nannyConfirmPosition,
  nannyDismissConnection,
  nannyEndPlacement,
  nannyDismissPlacement,
  updateNannyPlacementRate,
  updateNannyPlacementHours,
  updatePositionRosterNotes,
  updatePositionNannyNotes,
} from "@/lib/actions/position-funnel";
import type { UpcomingIntro } from "@/lib/actions/position-funnel";
import { ConnectionDetailPopup } from "@/components/position/ConnectionDetailPopup";
import { cancelConnectionRequest } from "@/lib/actions/connection";
import {
  respondToDfyMatch,
  markDfyNotificationViewed,
} from "@/lib/actions/matching";
import type { DfyNotification } from "@/lib/actions/matching";
import { PositionAccordion } from "@/components/position/PositionAccordion";
import { AvailabilityGrid } from "@/components/position/AvailabilityGrid";
import Link from "next/link";

function formatStartWeekDisplay(dateStr: string): string {
  if (dateStr === "tbc") return "Start week to be confirmed";
  const d = new Date(dateStr + "T00:00:00");
  const label = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });
  const isPast = d.getTime() < Date.now();
  return isPast ? `Started week of ${label}` : `Starting week of ${label}`;
}

export interface Placement {
  id: string;
  parentName: string;
  parentLastName: string;
  parentSuburb: string;
  parentPhoto: string | null;
  parentDateOfBirth: string | null;
  weeklyHours: number | null;
  hourlyRate: number | null;
  hiredAt: string;
  startDate: string | null;
  status: string;
  positionId: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  positionFormData: Record<string, unknown> | null;
  rosterNotes: string | null;
  nannyNotes: string | null;
}

interface NannyPositionsClientProps {
  placements: Placement[];
  upcomingIntros?: UpcomingIntro[];
  dfyNotificationsInitial?: DfyNotification[];
  shareUnlocked?: boolean;
  embedded?: boolean;
}

function getStageBadge(
  stage: number,
  fillInitiatedBy?: string | null,
  trialDate?: string | null,
): { label: string; color: string } {
  switch (stage) {
    case CONNECTION_STAGE.REQUEST_SENT:
      return { label: "New Request", color: "bg-amber-100 text-amber-700" };
    case CONNECTION_STAGE.ACCEPTED_PENDING:
    case CONNECTION_STAGE.ACCEPTED:
      return { label: "Scheduling", color: "bg-blue-100 text-blue-700" };
    case CONNECTION_STAGE.INTRO_SCHEDULED:
      return {
        label: "Meet Scheduled",
        color: "bg-violet-100 text-violet-700",
      };
    case CONNECTION_STAGE.INTRO_COMPLETE:
      return { label: "Meet Completed", color: "bg-green-100 text-green-700" };
    case CONNECTION_STAGE.AWAITING_RESPONSE:
      return {
        label: "Awaiting Response",
        color: "bg-amber-100 text-amber-700",
      };
    case CONNECTION_STAGE.TRIAL_ARRANGED: {
      if (fillInitiatedBy === "nanny")
        return { label: "Trial Pending", color: "bg-amber-100 text-amber-700" };
      // Confirmed trial — check if date has elapsed
      const today = new Date().toISOString().split("T")[0];
      if (trialDate && trialDate < today)
        return { label: "Trial Done", color: "bg-cyan-100 text-cyan-700" };
      return { label: "Trial Arranged", color: "bg-cyan-100 text-cyan-700" };
    }
    case CONNECTION_STAGE.TRIAL_COMPLETE:
      return { label: "Trial Done", color: "bg-cyan-100 text-cyan-700" };
    case CONNECTION_STAGE.OFFERED:
      return { label: "Offered", color: "bg-green-100 text-green-700" };
    case CONNECTION_STAGE.CONFIRMED:
      return { label: "Confirmed", color: "bg-green-100 text-green-700" };
    case CONNECTION_STAGE.ACTIVE:
      return { label: "Active", color: "bg-emerald-100 text-emerald-700" };
    default:
      return {
        label:
          CONNECTION_STAGE_LABELS[stage as ConnectionStage] || "In Progress",
        color: "bg-slate-100 text-slate-600",
      };
  }
}

export function NannyPositionsClient({
  placements,
  upcomingIntros = [],
  dfyNotificationsInitial = [],
  shareUnlocked = false,
  embedded = false,
}: NannyPositionsClientProps) {
  const router = useRouter();
  const active = placements.filter((p) => p.status === "active");
  const past = placements.filter((p) => p.status !== "active");
  const [selectedIntro, setSelectedIntro] = useState<UpcomingIntro | null>(
    null,
  );
  const [activePlacementId, setActivePlacementId] = useState<string | null>(
    null,
  );
  const [removeStep, setRemoveStep] = useState<"none" | "confirm" | "reason">(
    "none",
  );
  const [removeReason, setRemoveReason] = useState<string | null>(null);
  const [removeNotes, setRemoveNotes] = useState("");
  const [removing, setRemoving] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [editRateValue, setEditRateValue] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [editHoursValue, setEditHoursValue] = useState("");
  const [savingHours, setSavingHours] = useState(false);
  const [popupEditing, setPopupEditing] = useState(false);
  const [showPopupMenu, setShowPopupMenu] = useState(false);
  const [rosterNotesValue, setRosterNotesValue] = useState("");
  const [nannyNotesValue, setNannyNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [showSpecificNeeds, setShowSpecificNeeds] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [dfyNotifications, setDfyNotifications] = useState<DfyNotification[]>(
    dfyNotificationsInitial,
  );
  const [dfyRespondingId, setDfyRespondingId] = useState<string | null>(null);
  const [dfySuccess, setDfySuccess] = useState<string | null>(null);
  const [dfyInterestedId, setDfyInterestedId] = useState<string | null>(null);
  const [dfyError, setDfyError] = useState<string | null>(null);
  const [selectedDfyIntro, setSelectedDfyIntro] =
    useState<UpcomingIntro | null>(null);

  // DFY intros from upcomingIntros (for ConnectionDetailPopup on responded DFY cards)
  const dfyIntros = upcomingIntros.filter((i) => i.source === "dfy");
  const dfyIntroMap = new Map(dfyIntros.map((i) => [i.positionId, i]));

  const handleDfyRespond = async (notificationId: string, slots: string[]) => {
    if (slots.length === 0) return;
    setDfyRespondingId(notificationId);
    setDfyError(null);
    const result = await respondToDfyMatch(notificationId, slots);
    setDfyRespondingId(null);
    if (result.success) {
      setDfySuccess(notificationId);
      setDfyNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? {
                ...n,
                status: "interested",
                respondedAt: new Date().toISOString(),
              }
            : n,
        ),
      );
      setDfyInterestedId(null);
      setTimeout(() => setDfySuccess(null), 3000);
    } else {
      setDfyError(result.error);
      if (result.error?.includes("expired")) {
        setDfyNotifications((prev) =>
          prev.filter((n) => n.id !== notificationId),
        );
        setDfyInterestedId(null);
      }
      setTimeout(() => setDfyError(null), 5000);
    }
  };

  // Split intros into requests, active connections, and ended
  // Hide connections for positions that already have an active placement
  const activePlacementPositionIds = new Set(
    active.map((p) => p.positionId).filter(Boolean),
  );
  const introRequests = upcomingIntros.filter(
    (i) =>
      i.connectionStage === CONNECTION_STAGE.REQUEST_SENT &&
      !(i.positionId && activePlacementPositionIds.has(i.positionId)),
  );
  const endedConnections = upcomingIntros.filter(
    (i) => i.connectionStage === CONNECTION_STAGE.NOT_HIRED,
  );
  const activeConnections = upcomingIntros.filter(
    (i) =>
      i.connectionStage !== CONNECTION_STAGE.REQUEST_SENT &&
      i.connectionStage !== CONNECTION_STAGE.NOT_HIRED &&
      i.connectionStage !== CONNECTION_STAGE.NANNY_APPLIED &&
      i.connectionStage !== CONNECTION_STAGE.NANNY_APPLIED_PENDING &&
      i.source !== "dfy" &&
      !(i.positionId && activePlacementPositionIds.has(i.positionId)),
  );
  const nannyAppliedIntros = upcomingIntros.filter(
    (i) =>
      i.connectionStage === CONNECTION_STAGE.NANNY_APPLIED ||
      i.connectionStage === CONNECTION_STAGE.NANNY_APPLIED_PENDING,
  );
  const [dismissing, setDismissing] = useState<string | null>(null);

  const handleIntroOutcome = async (
    connectionId: string,
    outcome: "hired" | "not_hired" | "awaiting" | "trial" | "incomplete",
    dateValue?: string,
  ) => {
    const result = await reportIntroOutcome(connectionId, outcome, dateValue);
    if (result.success) router.refresh();
    return result;
  };

  const handleTrialOutcome = async (
    connectionId: string,
    outcome: "hired" | "not_hired" | "awaiting",
    startDate?: string,
  ) => {
    const result = await reportTrialOutcome(connectionId, outcome, startDate);
    if (result.success) router.refresh();
    return result;
  };

  const handleConfirmPosition = async (connectionId: string) => {
    const result = await nannyConfirmPosition(connectionId);
    if (result.success) router.refresh();
    return result;
  };

  const handleDismiss = async (connectionId: string) => {
    setDismissing(connectionId);
    const result = await nannyDismissConnection(connectionId);
    setDismissing(null);
    if (result.success) router.refresh();
  };

  const handleDismissPlacement = async (placementId: string) => {
    const result = await nannyDismissPlacement(placementId);
    if (result.success) router.refresh();
  };

  const handleEndPlacement = async () => {
    const activePlacement = active[0];
    if (!activePlacement || !removeReason) return;
    setRemoving(true);
    const result = await nannyEndPlacement(
      activePlacement.id,
      removeReason,
      removeNotes || undefined,
    );
    setRemoving(false);
    if (result.success) {
      setActivePlacementId(null);
      setRemoveStep("none");
      setRemoveReason(null);
      setRemoveNotes("");
      router.refresh();
    }
  };

  const handleSaveRate = async (placementId: string) => {
    const rate = parseFloat(editRateValue);
    if (isNaN(rate) || rate <= 0) return;
    setSavingRate(true);
    const result = await updateNannyPlacementRate(placementId, rate);
    setSavingRate(false);
    if (result.success) {
      setEditingRate(false);
      router.refresh();
    }
  };

  const handleSaveHours = async (placementId: string) => {
    const hours = parseFloat(editHoursValue);
    if (isNaN(hours) || hours <= 0) return;
    setSavingHours(true);
    const result = await updateNannyPlacementHours(placementId, hours);
    setSavingHours(false);
    if (result.success) {
      setEditingHours(false);
      router.refresh();
    }
  };

  // Schedule constants for the table
  const DAY_OPTIONS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const DAY_SHORT: Record<string, string> = {
    Monday: "Mon",
    Tuesday: "Tue",
    Wednesday: "Wed",
    Thursday: "Thu",
    Friday: "Fri",
    Saturday: "Sat",
    Sunday: "Sun",
  };
  const TIME_BLOCKS = [
    { key: "morning", label: "Morning", sub: "6–10am" },
    { key: "midday", label: "Midday", sub: "10am–2pm" },
    { key: "afternoon", label: "Afternoon", sub: "2–6pm" },
    { key: "evening", label: "Evening", sub: "6–10pm" },
  ];
  const DAY_ROSTER_FIELD: Record<string, string> = {
    Monday: "monday_roster",
    Tuesday: "tuesday_roster",
    Wednesday: "wednesday_roster",
    Thursday: "thursday_roster",
    Friday: "friday_roster",
    Saturday: "saturday_roster",
    Sunday: "sunday_roster",
  };

  return (
    <div className="space-y-6">
      {/* ═══ UNIFIED CARD — mirrors parent hub "Nannies" card ═══ */}
      <div
        className={
          embedded
            ? "p-4 pt-3"
            : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        }
      >
        {/* Card header — hidden when embedded inside parent card */}
        {!embedded && (
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-violet-600" />
            <p className="text-base font-semibold text-slate-800">Families</p>
          </div>
        )}

        {/* ── My Positions (active placements) ── */}
        {active.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              My Families
            </p>
            <div className="rounded-lg border border-slate-100 overflow-hidden divide-y divide-slate-100">
              {active.map((placement) => (
                <div
                  key={placement.id}
                  className="relative flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/80 transition-colors group"
                  onClick={() => setActivePlacementId(placement.id)}
                >
                  {/* Avatar */}
                  {placement.parentPhoto ? (
                    <img
                      src={placement.parentPhoto}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover shrink-0 ring-2 ring-green-200"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-50 ring-2 ring-green-200 shrink-0">
                      <span className="text-sm font-semibold text-green-600">
                        {placement.parentLastName.charAt(0) ||
                          placement.parentName.charAt(0)}
                      </span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {placement.parentLastName ||
                        placement.parentName.split(" ").pop()}{" "}
                      Family
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500">
                      {placement.parentSuburb && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {placement.parentSuburb}
                        </span>
                      )}
                      {placement.weeklyHours && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {placement.weeklyHours}hrs/wk
                        </span>
                      )}
                      {placement.startDate &&
                        placement.startDate !== "tbc" &&
                        (() => {
                          const startMon = new Date(
                            placement.startDate + "T00:00:00",
                          );
                          const isPast = startMon <= new Date();
                          const label = startMon.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          });
                          return (
                            <span className="flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {isPast
                                ? `Started ${label}`
                                : `Starting ${label}`}
                            </span>
                          );
                        })()}
                      {placement.startDate === "tbc" && (
                        <span className="flex items-center gap-0.5 text-amber-600">
                          <Calendar className="h-3 w-3" />
                          Start TBC
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Active badge + chevron */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                </div>
              ))}
            </div>

            {/* My Family Detail Popups — one per placement, rendered outside the container */}
            {active.map((placement) => (
              <div key={`popup-${placement.id}`}>
                {/* My Family Detail Popup */}
                <Dialog
                  open={activePlacementId === placement.id}
                  onOpenChange={(open) => {
                    if (!open) {
                      setActivePlacementId(null);
                      setRemoveStep("none");
                      setRemoveReason(null);
                      setRemoveNotes("");
                    }
                  }}
                >
                  <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
                    <DialogHeader>
                      <div className="flex items-center gap-3">
                        {placement.parentPhoto ? (
                          <img
                            src={placement.parentPhoto}
                            alt=""
                            className="h-14 w-14 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                            <span className="text-lg font-semibold text-green-700">
                              {placement.parentLastName.charAt(0) ||
                                placement.parentName.charAt(0)}
                            </span>
                          </div>
                        )}
                        <div className="flex-1">
                          <DialogTitle>
                            The{" "}
                            {placement.parentLastName ||
                              placement.parentName.split(" ").pop()}{" "}
                            Family
                          </DialogTitle>
                          {placement.parentSuburb && (
                            <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" />{" "}
                              {placement.parentSuburb}
                            </p>
                          )}
                        </div>
                      </div>
                    </DialogHeader>

                    {/* 3-dot menu + green tick — top right, left of X */}
                    <div className="absolute right-11 top-4 flex items-center gap-1">
                      {popupEditing && (
                        <button
                          onClick={async () => {
                            if (placement.positionId) {
                              setSavingNotes(true);
                              await Promise.all([
                                updatePositionRosterNotes(
                                  placement.positionId,
                                  rosterNotesValue,
                                ),
                                updatePositionNannyNotes(
                                  placement.positionId,
                                  nannyNotesValue,
                                ),
                              ]);
                              setSavingNotes(false);
                              router.refresh();
                            }
                            setPopupEditing(false);
                            setEditingRate(false);
                            setEditingHours(false);
                          }}
                          disabled={savingNotes}
                          className="rounded-sm text-green-600 opacity-70 hover:opacity-100 transition-opacity"
                        >
                          {savingNotes ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowPopupMenu((p) => !p)}
                          className="rounded-sm opacity-70 hover:opacity-100 transition-opacity text-slate-500"
                          tabIndex={-1}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {showPopupMenu && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowPopupMenu(false)}
                            />
                            <div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-50">
                              <button
                                onClick={() => {
                                  setShowPopupMenu(false);
                                  setPopupEditing(true);
                                  setRosterNotesValue(
                                    placement.rosterNotes || "",
                                  );
                                  setNannyNotesValue(
                                    placement.nannyNotes || "",
                                  );
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                              >
                                Edit
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Children */}
                    {placement.positionFormData &&
                      (() => {
                        const fd = placement.positionFormData;
                        const numChildren = Number(fd.num_children) || 0;
                        const ageKeys = [
                          "child_a_age",
                          "child_b_age",
                          "child_c_age",
                        ];
                        const genderKeys = [
                          "child_a_gender",
                          "child_b_gender",
                          "child_c_gender",
                        ];
                        if (numChildren === 0) return null;
                        return (
                          <div className="space-y-2 mt-2">
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                              Children
                            </p>
                            {Array.from({ length: numChildren }).map((_, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 text-sm text-slate-600"
                              >
                                <Baby className="h-4 w-4 text-slate-400" />
                                {(fd[ageKeys[i] as string] as string) ||
                                  "Age not specified"}
                                {(fd[genderKeys[i] as string] as string)
                                  ? ` · ${fd[genderKeys[i] as string]}`
                                  : ""}
                              </div>
                            ))}
                            <button
                              onClick={() => setShowSpecificNeeds((p) => !p)}
                              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 transition-colors mt-1"
                            >
                              {showSpecificNeeds ? (
                                <ChevronRight className="h-3 w-3 rotate-90 transition-transform" />
                              ) : (
                                <ChevronRight className="h-3 w-3 transition-transform" />
                              )}
                              View specific needs
                            </button>
                            {showSpecificNeeds && (
                              <div className="space-y-1.5 ml-6">
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                  <span className="text-slate-400">
                                    Developmental conditions:
                                  </span>
                                  {fd.child_needs_yn === "Yes" &&
                                  fd.child_needs_details
                                    ? String(fd.child_needs_details)
                                    : "No"}
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                  <span className="text-slate-400">
                                    Dietary restrictions:
                                  </span>
                                  {fd.dietary_restrictions_yn === "Yes"
                                    ? fd.dietary_restrictions_details
                                      ? String(fd.dietary_restrictions_details)
                                      : "Yes — not specified"
                                    : "No"}
                                </div>
                                {/* Notes (moved here from bottom) */}
                                {placement.positionFormData?.notes ? (
                                  <div className="text-sm text-slate-600 mt-1">
                                    <span className="text-slate-400">
                                      Parent notes:
                                    </span>{" "}
                                    {String(placement.positionFormData.notes)}
                                  </div>
                                ) : null}
                                {popupEditing ? (
                                  <textarea
                                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 mt-1"
                                    rows={3}
                                    placeholder="Add your own notes about this position..."
                                    value={nannyNotesValue}
                                    onChange={(e) =>
                                      setNannyNotesValue(e.target.value)
                                    }
                                  />
                                ) : placement.nannyNotes || nannyNotesValue ? (
                                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mt-1">
                                    {nannyNotesValue || placement.nannyNotes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    {/* Pay & Hours */}
                    <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Pay &amp; Hours
                      </p>

                      {/* Hourly Rate */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <PoundSterling className="h-4 w-4 text-slate-400" />
                          {editingRate ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">£</span>
                              <input
                                type="number"
                                step="0.50"
                                min="0"
                                className="w-20 text-sm border border-violet-300 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                value={editRateValue}
                                onChange={(e) =>
                                  setEditRateValue(e.target.value)
                                }
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleSaveRate(placement.id);
                                  if (e.key === "Escape") setEditingRate(false);
                                }}
                              />
                              <span className="text-slate-400">/hr</span>
                              <button
                                onClick={() => handleSaveRate(placement.id)}
                                disabled={savingRate}
                                className="p-1 rounded-md text-green-600 hover:bg-green-50 transition-colors"
                              >
                                {savingRate ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => setEditingRate(false)}
                                className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              {placement.hourlyRate
                                ? `£${placement.hourlyRate}/hr`
                                : "Rate not set"}
                            </>
                          )}
                        </div>
                        {!editingRate && popupEditing && (
                          <button
                            onClick={() => {
                              setEditingRate(true);
                              setEditRateValue(
                                placement.hourlyRate?.toString() || "",
                              );
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Weekly Hours */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Clock className="h-4 w-4 text-slate-400" />
                          {editingHours ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="1"
                                min="1"
                                max="168"
                                className="w-16 text-sm border border-violet-300 rounded-md px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                value={editHoursValue}
                                onChange={(e) =>
                                  setEditHoursValue(e.target.value)
                                }
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleSaveHours(placement.id);
                                  if (e.key === "Escape")
                                    setEditingHours(false);
                                }}
                              />
                              <span className="text-slate-400">hrs/week</span>
                              <button
                                onClick={() => handleSaveHours(placement.id)}
                                disabled={savingHours}
                                className="p-1 rounded-md text-green-600 hover:bg-green-50 transition-colors"
                              >
                                {savingHours ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => setEditingHours(false)}
                                className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              {placement.weeklyHours
                                ? `${placement.weeklyHours} hours per week`
                                : "Hours not set"}
                            </>
                          )}
                        </div>
                        {!editingHours && popupEditing && (
                          <button
                            onClick={() => {
                              setEditingHours(true);
                              setEditHoursValue(
                                placement.weeklyHours?.toString() || "",
                              );
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Start date */}
                      {placement.startDate &&
                        placement.startDate !== "tbc" &&
                        (() => {
                          const startMon = new Date(
                            placement.startDate + "T00:00:00",
                          );
                          const isPast = startMon <= new Date();
                          const label = startMon.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                          });
                          return (
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Calendar className="h-4 w-4 text-slate-400" />
                              {isPast
                                ? `Started week of ${label}`
                                : `Starting week of ${label}`}
                            </div>
                          );
                        })()}
                      {placement.startDate === "tbc" && (
                        <div className="flex items-center gap-2 text-sm text-amber-600">
                          <Calendar className="h-4 w-4" />
                          Start week to be confirmed
                        </div>
                      )}

                      {/* Estimated weekly pay */}
                      {placement.hourlyRate && placement.weeklyHours && (
                        <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 mt-1">
                          <p className="text-sm font-medium text-green-700">
                            ~£
                            {(
                              placement.hourlyRate * placement.weeklyHours
                            ).toFixed(0)}
                            /week
                          </p>
                          <p className="text-xs text-green-600">
                            Estimated weekly pay
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Schedule table — days × time blocks */}
                    {placement.positionFormData &&
                      (() => {
                        const fd = placement.positionFormData;
                        const weeklyRoster =
                          (fd.weekly_roster as string[]) || [];
                        if (weeklyRoster.length === 0) return null;
                        const sortedDays = DAY_OPTIONS.filter((d) =>
                          weeklyRoster.includes(d),
                        );
                        return (
                          <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                              Schedule
                            </p>
                            <div className="overflow-x-auto -mx-2">
                              <table className="w-full text-sm min-w-[300px]">
                                <thead>
                                  <tr>
                                    <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-slate-500 uppercase" />
                                    {TIME_BLOCKS.map((block) => (
                                      <th
                                        key={block.key}
                                        className="px-1 py-1.5 text-center"
                                      >
                                        <p className="text-[11px] font-semibold text-slate-600">
                                          {block.label}
                                        </p>
                                        <p className="text-[9px] text-slate-400">
                                          {block.sub}
                                        </p>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedDays.map((day) => {
                                    const rosterField = DAY_ROSTER_FIELD[day];
                                    const dayTimes =
                                      (fd[rosterField] as
                                        | string[]
                                        | undefined) ?? [];
                                    return (
                                      <tr
                                        key={day}
                                        className="border-t border-slate-100"
                                      >
                                        <td className="py-2 pr-2 font-medium text-slate-700 text-sm whitespace-nowrap">
                                          {DAY_SHORT[day]}
                                        </td>
                                        {TIME_BLOCKS.map((block) => {
                                          const isActive = dayTimes.includes(
                                            block.key,
                                          );
                                          return (
                                            <td
                                              key={block.key}
                                              className="px-1 py-2 text-center"
                                            >
                                              <span
                                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                                                  isActive
                                                    ? "bg-violet-100 text-violet-600"
                                                    : "bg-slate-50 text-slate-300"
                                                }`}
                                              >
                                                {isActive ? "✓" : "–"}
                                              </span>
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {/* Roster details text box */}
                            {popupEditing ? (
                              <textarea
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                                rows={2}
                                placeholder="Add roster details — exact days and times..."
                                value={rosterNotesValue}
                                onChange={(e) =>
                                  setRosterNotesValue(e.target.value)
                                }
                              />
                            ) : (
                              (() => {
                                const text =
                                  rosterNotesValue || placement.rosterNotes;
                                if (!text) return null;
                                const lines = text.split("\n");
                                const needsTruncate = lines.length > 4;
                                const displayText =
                                  needsTruncate && !rosterExpanded
                                    ? lines.slice(0, 4).join("\n")
                                    : text;
                                return (
                                  <div>
                                    <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                                      {displayText}
                                    </p>
                                    {needsTruncate && (
                                      <button
                                        onClick={() =>
                                          setRosterExpanded((p) => !p)
                                        }
                                        className="text-xs text-violet-600 hover:text-violet-700 mt-1"
                                      >
                                        {rosterExpanded
                                          ? "Show less"
                                          : "See more"}
                                      </button>
                                    )}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        );
                      })()}

                    {/* Role details from position */}
                    {placement.positionFormData &&
                      (() => {
                        const fd = placement.positionFormData;
                        const items: { label: string; value: string }[] = [];
                        if (fd.schedule_type)
                          items.push({
                            label: "Arrangement",
                            value: fd.schedule_type as string,
                          });
                        if (fd.reason_for_nanny)
                          items.push({
                            label: "Primary role",
                            value: fd.reason_for_nanny as string,
                          });
                        if (fd.focus_type)
                          items.push({
                            label: "Focus",
                            value: fd.focus_type as string,
                          });
                        if (fd.placement_length) {
                          const dur = fd.placement_duration
                            ? ` (${fd.placement_duration})`
                            : "";
                          items.push({
                            label: "Duration",
                            value: `${fd.placement_length}${dur}`,
                          });
                        }
                        if (items.length === 0) return null;
                        return (
                          <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                              Role Details
                            </p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              {items.map((item) => (
                                <div key={item.label}>
                                  <p className="text-[11px] text-slate-400">
                                    {item.label}
                                  </p>
                                  <p className="text-sm text-slate-700">
                                    {item.value}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                    {/* Logistics */}
                    {placement.positionFormData &&
                      (() => {
                        const fd = placement.positionFormData;
                        const hasPets = fd.has_pets === "Yes";
                        if (!hasPets) return null;
                        return (
                          <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                              Logistics
                            </p>
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <PawPrint className="h-4 w-4 text-slate-400" />
                              Pets in home
                              {fd.has_pets_details
                                ? `: ${fd.has_pets_details}`
                                : ""}
                            </div>
                          </div>
                        );
                      })()}

                    {/* Contact */}
                    <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Contact
                      </p>
                      <p className="text-sm font-medium text-slate-700">
                        {placement.parentName}
                      </p>
                      {placement.parentPhone && (
                        <a
                          href={`tel:${placement.parentPhone}`}
                          className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-700"
                        >
                          <Phone className="h-4 w-4" />
                          {placement.parentPhone}
                        </a>
                      )}
                      {placement.parentEmail && (
                        <a
                          href={`mailto:${placement.parentEmail}`}
                          className="flex items-center gap-2 text-sm text-violet-600 hover:text-violet-700"
                        >
                          <Mail className="h-4 w-4" />
                          {placement.parentEmail}
                        </a>
                      )}
                    </div>

                    {/* End Placement — at bottom */}
                    <div className="mt-6 pt-4 border-t border-slate-100">
                      {removeStep === "none" && (
                        <button
                          className="text-sm text-red-400 hover:text-red-500 transition-colors cursor-pointer"
                          onClick={() => setRemoveStep("confirm")}
                        >
                          I&apos;m no longer working with the{" "}
                          {placement.parentLastName ||
                            placement.parentName.split(" ").pop()}{" "}
                          family
                        </button>
                      )}

                      {removeStep === "confirm" && (
                        <div className="space-y-3">
                          <div className="rounded-lg bg-red-50 border border-red-100 p-4 space-y-2">
                            <p className="text-sm font-medium text-slate-700">
                              We&apos;re sorry to hear that
                            </p>
                            <p className="text-sm text-slate-600">
                              We completely understand — sometimes things change
                              and that&apos;s perfectly okay. Ending this
                              placement will let both you and the{" "}
                              {placement.parentName.split(" ")[0]} family move
                              forward. We&apos;re here to help you find your
                              next great family.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="flex-1"
                              onClick={() => setRemoveStep("none")}
                            >
                              Never mind
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => setRemoveStep("reason")}
                            >
                              Continue
                            </Button>
                          </div>
                        </div>
                      )}

                      {removeStep === "reason" && (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-slate-700">
                            Could you let us know what happened?
                          </p>
                          <p className="text-xs text-slate-500">
                            This helps us improve our support for nannies like
                            you.
                          </p>
                          <div className="space-y-1.5">
                            {[
                              {
                                value: "parent_no_longer_needs",
                                label: "The family no longer needs me",
                              },
                              {
                                value: "nanny_left",
                                label: "I found another position",
                              },
                              {
                                value: "mutual_agreement",
                                label: "It was a mutual decision",
                              },
                              { value: "relocation", label: "I'm relocating" },
                              {
                                value: "child_aged_out",
                                label: "The children no longer need a nanny",
                              },
                              { value: "other", label: "Other reason" },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setRemoveReason(opt.value)}
                                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg border transition-colors ${
                                  removeReason === opt.value
                                    ? "border-red-300 bg-red-50 text-red-700 font-medium"
                                    : "border-slate-200 text-slate-600 hover:border-red-200 hover:bg-red-50/50"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          {removeReason && (
                            <div className="space-y-2">
                              <textarea
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400 resize-none"
                                rows={2}
                                placeholder="Anything else you'd like to share? (optional)"
                                value={removeNotes}
                                onChange={(e) => setRemoveNotes(e.target.value)}
                              />
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="flex-1"
                              onClick={() => {
                                setRemoveStep("confirm");
                                setRemoveReason(null);
                                setRemoveNotes("");
                              }}
                            >
                              Back
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                              disabled={!removeReason || removing}
                              onClick={handleEndPlacement}
                            >
                              {removing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : null}
                              End placement
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            ))}
          </div>
        )}

        {/* ── Intro Requests ── */}
        {introRequests.length > 0 && (
          <div
            className={`${active.length > 0 ? "mt-5 pt-5 border-t border-slate-100" : ""}`}
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Meet Requests ({introRequests.length})
            </p>
            <div className="grid gap-3">
              {introRequests.map((intro) => (
                <Card
                  key={intro.connectionId}
                  className="relative border-amber-200 bg-amber-50/50 cursor-pointer hover:bg-amber-50 hover:border-amber-300 transition-colors"
                  onClick={() => setSelectedIntro(intro)}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {intro.otherPartyPhoto ? (
                          <img
                            src={intro.otherPartyPhoto}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                            <span className="text-sm font-semibold text-amber-600">
                              {intro.otherPartyName.charAt(0)}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {intro.otherPartyName}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {intro.otherPartySuburb && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {intro.otherPartySuburb}
                              </span>
                            )}
                            {intro.position?.hoursPerWeek && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {intro.position.hoursPerWeek}h/wk
                              </span>
                            )}
                            {intro.position?.hourlyRate && (
                              <span className="flex items-center gap-1">
                                <PoundSterling className="h-3 w-3" />£
                                {intro.position.hourlyRate}/hr
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-700">
                          New Request
                        </span>
                        <ChevronRight className="h-4 w-4 text-amber-300" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Matched Families ── */}
        <div
          className={`${active.length > 0 || introRequests.length > 0 ? "mt-5 pt-5 border-t border-slate-100" : ""}`}
        >
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Matched Families
            {dfyNotifications.length > 0 ? ` (${dfyNotifications.length})` : ""}
          </p>

          {!shareUnlocked ? (
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4 text-center space-y-2">
              <p className="text-sm text-slate-600">Your profile is live</p>
              <p className="text-sm text-slate-600">
                Share your profile to appear in parent matchmaking results
              </p>
              <Button
                asChild
                size="sm"
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Link href="/nanny/share">
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Be seen in parents&apos; matchmaking
                </Link>
              </Button>
            </div>
          ) : dfyNotifications.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400">
                When families match with you, they&apos;ll appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {dfyNotifications.map((notification) => {
                const score = Math.round(
                  50 + (notification.matchScore / 100) * 50,
                );
                const isResponding = dfyRespondingId === notification.id;
                const isLocallyInterested = dfyInterestedId === notification.id;
                const isPending = notification.status === "interested";
                const parentSurname = notification.parent.lastName;

                return (
                  <Card
                    key={notification.id}
                    className="relative border-violet-200 bg-violet-50/30"
                  >
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {notification.parent.profilePicUrl ? (
                            <img
                              src={notification.parent.profilePicUrl}
                              alt=""
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                              <span className="text-sm font-semibold text-violet-600">
                                {notification.parent.firstName.charAt(0)}
                              </span>
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {notification.parent.firstName}{" "}
                              {notification.parent.lastName}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              {notification.position.suburb && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {notification.position.suburb}
                                  {notification.distanceKm != null &&
                                    ` (${notification.distanceKm.toFixed(1)}km)`}
                                </span>
                              )}
                              {notification.position.hourlyRate && (
                                <span className="flex items-center gap-1">
                                  <PoundSterling className="h-3 w-3" />£
                                  {notification.position.hourlyRate}/hr
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                            score >= 90
                              ? "bg-green-100 text-green-700"
                              : score >= 75
                                ? "bg-violet-100 text-violet-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {score}%{" "}
                          {notification.dfyTier === "standard"
                            ? "Logistical Score"
                            : "Match"}
                        </span>
                      </div>

                      {/* Context message */}
                      {!isPending && !isLocallyInterested && (
                        <p className="text-xs text-slate-600">
                          The {parentSurname} family would love to speak to you
                          about working with their children.
                        </p>
                      )}

                      {/* Full position details accordion */}
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <PositionAccordion
                        position={notification.position as any}
                      />

                      {/* ── Pending state (already responded) — clickable if connection exists ── */}
                      {isPending &&
                        (() => {
                          const matchingIntro = dfyIntroMap.get(
                            notification.positionId,
                          );
                          if (matchingIntro) {
                            const badge = getStageBadge(
                              matchingIntro.connectionStage,
                              matchingIntro.fillInitiatedBy,
                              matchingIntro.trialDate,
                            );
                            return (
                              <div
                                className="flex items-center justify-between gap-3 rounded-lg border border-violet-200 bg-white p-3 cursor-pointer hover:bg-violet-50 transition-colors"
                                onClick={() =>
                                  setSelectedDfyIntro(matchingIntro)
                                }
                              >
                                <div className="flex items-center gap-2 text-sm text-slate-700">
                                  <span className="font-medium">
                                    View connection progress
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${badge.color}`}
                                  >
                                    {badge.label}
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-slate-300" />
                                </div>
                              </div>
                            );
                          }
                          return (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              Interest sent — awaiting the family&apos;s
                              response.
                            </p>
                          );
                        })()}

                      {/* ── Step 1: "I'm interested" button ── */}
                      {!isPending && !isLocallyInterested && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setDfyInterestedId(notification.id);
                            if (notification.status === "notified") {
                              markDfyNotificationViewed(notification.id);
                            }
                          }}
                          className="bg-violet-600 hover:bg-violet-700 w-full"
                        >
                          <Heart className="w-3.5 h-3.5 mr-1.5" />
                          I&apos;m interested
                        </Button>
                      )}

                      {/* ── Step 2: Inline AvailabilityGrid (same as regular connections) ── */}
                      {!isPending && isLocallyInterested && (
                        <AvailabilityGrid
                          submitting={isResponding}
                          onBack={() => setDfyInterestedId(null)}
                          onConfirm={(slots) =>
                            handleDfyRespond(notification.id, slots)
                          }
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Connections ── */}
        {activeConnections.length > 0 && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Connections ({activeConnections.length})
            </p>
            <div className="space-y-3">
              {activeConnections.map((intro) => {
                const badge = getStageBadge(
                  intro.connectionStage,
                  intro.fillInitiatedBy,
                  intro.trialDate,
                );

                return (
                  <div
                    key={intro.connectionId}
                    className="relative rounded-lg border border-slate-100 bg-white p-3 cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors"
                    onClick={() => setSelectedIntro(intro)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {intro.otherPartyPhoto ? (
                          <img
                            src={intro.otherPartyPhoto}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                            <span className="text-sm font-semibold text-violet-600">
                              {intro.otherPartyName.charAt(0)}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {intro.otherPartyName}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {intro.otherPartySuburb && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {intro.otherPartySuburb}
                              </span>
                            )}
                            {intro.startDate &&
                              intro.connectionStage >=
                                CONNECTION_STAGE.OFFERED && (
                                <span className="flex items-center gap-1 text-green-600">
                                  <Calendar className="h-3 w-3" />
                                  {formatStartWeekDisplay(intro.startDate)}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Applications ── */}
        {nannyAppliedIntros.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Applications ({nannyAppliedIntros.length})
            </p>
            <div className="space-y-2">
              {nannyAppliedIntros.map((intro) => (
                <div
                  key={intro.connectionId}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-3 cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors"
                  onClick={() => setSelectedIntro(intro)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {intro.otherPartyPhoto ? (
                      <img
                        src={intro.otherPartyPhoto}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 shrink-0">
                        <span className="text-xs font-semibold text-violet-600">
                          {intro.otherPartyName.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {intro.otherPartyName}
                      </p>
                      {intro.otherPartySuburb && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3 w-3" />
                          {intro.otherPartySuburb}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="rounded-full bg-violet-100 text-violet-700 px-2.5 py-1 text-xs font-medium">
                      Applied
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* ═══ END UNIFIED CARD ═══ */}

      {/* DFY success toast */}
      {dfySuccess && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 z-50 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle className="w-4 h-4" />
          Interest sent! The family will schedule a meet and greet.
        </div>
      )}

      {/* DFY error toast */}
      {dfyError && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 z-50 animate-in fade-in slide-in-from-bottom-4">
          <XCircle className="w-4 h-4" />
          {dfyError}
        </div>
      )}

      {/* Ended Connections */}
      {endedConnections.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-500">Updates</h2>
          <div className="grid gap-3">
            {endedConnections.map((intro) => (
              <Card
                key={intro.connectionId}
                className="border-slate-200 bg-slate-50/50"
              >
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {intro.otherPartyPhoto ? (
                        <img
                          src={intro.otherPartyPhoto}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover opacity-75"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                          <span className="text-sm font-semibold text-slate-400">
                            {intro.otherPartyName.charAt(0)}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-slate-700">
                          {intro.otherPartyName}
                        </p>
                        {intro.otherPartySuburb && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <MapPin className="h-3 w-3" />
                            {intro.otherPartySuburb}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-slate-600 h-8 w-8 p-0"
                      disabled={dismissing === intro.connectionId}
                      onClick={() => handleDismiss(intro.connectionId)}
                    >
                      {dismissing === intro.connectionId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  <p className="text-sm text-slate-600">
                    The {intro.otherPartyName.split(" ")[0]} family has decided
                    to go in a different direction. This is completely normal
                    and happens often — the right family is out there for you!
                  </p>

                  <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Heart className="h-4 w-4 text-violet-500 shrink-0" />
                      <p className="text-sm text-violet-700 font-medium">
                        Get help connecting with more families
                      </p>
                    </div>
                    <p className="text-xs text-violet-500 mt-1 ml-6">
                      We&apos;re here to help you find the perfect match. More
                      features coming soon.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Past Positions */}
      {past.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-500">
            Past ({past.length})
          </h2>
          <div className="grid gap-3">
            {past.map((placement) => (
              <PlacementCard
                key={placement.id}
                placement={placement}
                onDismiss={handleDismissPlacement}
              />
            ))}
          </div>
        </section>
      )}

      {/* Connection Detail Popup */}
      <ConnectionDetailPopup
        intro={selectedIntro}
        open={selectedIntro !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedIntro(null);
            router.refresh();
          }
        }}
        role="nanny"
        onIntroOutcome={handleIntroOutcome}
        onTrialOutcome={handleTrialOutcome}
        onConfirmPosition={handleConfirmPosition}
        onDismissConnection={async (connectionId) => {
          const result = await nannyDismissConnection(connectionId);
          if (result.success) router.refresh();
          return result;
        }}
        onRemoveConnection={async (connectionId) => {
          const result = await cancelConnectionRequest(connectionId);
          if (result.success) router.refresh();
          return result;
        }}
      />

      {/* DFY Connection Detail Popup */}
      {(() => {
        const selectedDfyNotification = dfyNotifications.find(
          (n) => n.positionId === selectedDfyIntro?.positionId,
        );
        return (
          <ConnectionDetailPopup
            intro={selectedDfyIntro}
            open={selectedDfyIntro !== null}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedDfyIntro(null);
                router.refresh();
              }
            }}
            role="nanny"
            matchData={
              selectedDfyNotification
                ? {
                    matchScore: selectedDfyNotification.matchScore,
                    distanceKm: selectedDfyNotification.distanceKm,
                    breakdown: null,
                    nannySchedule: null,
                    aiHeadline: null,
                    tier: selectedDfyNotification.dfyTier,
                  }
                : null
            }
            onIntroOutcome={handleIntroOutcome}
            onTrialOutcome={handleTrialOutcome}
            onConfirmPosition={handleConfirmPosition}
            onDismissConnection={async (connectionId) => {
              const result = await nannyDismissConnection(connectionId);
              if (result.success) router.refresh();
              return result;
            }}
            onRemoveConnection={async (connectionId) => {
              const result = await cancelConnectionRequest(connectionId);
              if (result.success) router.refresh();
              return result;
            }}
          />
        );
      })()}
    </div>
  );
}

function PlacementCard({
  placement,
  isActive,
  onDismiss,
}: {
  placement: Placement;
  isActive?: boolean;
  onDismiss?: (id: string) => void;
}) {
  const [dismissingThis, setDismissingThis] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  return (
    <Card
      className={isActive ? "border-green-200" : "border-slate-100 opacity-75"}
    >
      <CardContent className="py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div>
              <p className="text-base font-semibold text-slate-900">
                {placement.parentLastName
                  ? `${placement.parentLastName} Family`
                  : placement.parentName}
              </p>
              {placement.parentSuburb && (
                <p className="flex items-center gap-1 text-sm text-slate-500">
                  <MapPin className="h-3 w-3" />
                  {placement.parentSuburb}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              {placement.weeklyHours && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {placement.weeklyHours}hrs/week
                </span>
              )}
              {placement.hourlyRate && (
                <span className="flex items-center gap-1">
                  <PoundSterling className="h-3.5 w-3.5 text-slate-400" />£
                  {placement.hourlyRate}/hr
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                Since {formatLondonDate(placement.hiredAt)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                isActive
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {isActive ? "Active" : "Position ended"}
            </span>
            {!isActive && onDismiss && (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu((p) => !p);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {dismissingThis ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </button>
                {showMenu && (
                  <div className="absolute right-0 mt-1 w-36 rounded-lg border border-slate-200 bg-white shadow-lg z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        setDismissingThis(true);
                        onDismiss(placement.id);
                      }}
                      disabled={dismissingThis}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
