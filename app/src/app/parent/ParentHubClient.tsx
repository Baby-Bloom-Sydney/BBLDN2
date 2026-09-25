"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PositionDetailView } from "../parent/request/renderers/PositionDetailView";
import { PositionWithChildren, closePosition } from "@/lib/actions/parent";
import {
  AlertTriangle,
  ClipboardList,
  MapPin,
  Clock,
  Calendar,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  UserCheck,
  Users,
  XCircle,
  Search,
  ShieldCheck,
  Phone,
  MoreVertical,
  ArrowRight,
  Check,
  DollarSign,
  Mail,
  Sparkles,
  Baby,
  ShoppingCart,
  User,
  Star,
  Globe,
  AlertCircle,
  X,
  Plus,
  Lock,
} from "lucide-react";
import Link from "next/link";
import {
  CONNECTION_STAGE,
  CONNECTION_STAGE_LABELS,
} from "@/lib/position/constants";
import type { ConnectionStage } from "@/lib/position/constants";
import {
  parentInitiateFill,
  confirmPlacement,
  reportParentOutcome,
  rejectHiredClaim,
  revertToAwaiting,
  closePositionWithReason,
  scheduleIntroTime,
  updateConnectionStartWeek,
  removeNannyPlacement,
  updateParentPlacementRate,
  updateParentPlacementHours,
  confirmTrialArrangement,
  declineTrialArrangement,
} from "@/lib/actions/position-funnel";
import type { UpcomingIntro } from "@/lib/actions/position-funnel";
import { ConnectionDetailPopup } from "@/components/position/ConnectionDetailPopup";
import { cancelConnectionRequest } from "@/lib/actions/connection";
import {
  cancelBabysittingRequest,
  parentAcceptNanny,
  type BabysittingRequestWithSlots,
  type RequestingNanny,
} from "@/lib/actions/babysitting";
import {
  getDfyConnections,
  declineDfyConnection,
} from "@/lib/actions/matching";
import type { DfyConnection } from "@/lib/actions/matching";
import { getScoreBadgeStyle, calcAge } from "@/components/match/match-helpers";
import { ScheduleTimeGrid } from "@/components/position/ScheduleTimeGrid";
import type { TypeformFormData } from "../parent/request/questions";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { BrowseNanniesTab } from "@/components/parent/BrowseNanniesTab";
import { MyChildcareTab } from "@/components/parent/MyChildcareTab";
import { ParentAvatarEditor } from "@/components/parent/ParentAvatarEditor";
import { ChildCardGrid } from "@/components/bapp/ChildCardGrid";
import { PendingInvitesSection } from "@/components/bapp/PendingInvitesSection";
import type { PendingInviteCard } from "@/types/bapp";
import type { ChildClient } from "@/types/bapp";

interface ConfirmedNanny {
  connectionId: string;
  nannyId: string;
  nannyName: string;
  nannySuburb: string;
  nannyPhoto: string | null;
  connectionStage: number;
  confirmedTime: string | null;
}

interface PlacementData {
  id: string;
  nannyId: string;
  nannyName: string;
  nannySuburb: string;
  nannyPhoto: string | null;
  nannyDateOfBirth: string | null;
  weeklyHours: number | null;
  hourlyRate: number | null;
  hiredAt: string;
  startDate: string | null;
  nannyEmail: string | null;
  nannyPhone: string | null;
  totalExperienceYears: number | null;
  nannyExperienceYears: number | null;
  highestQualification: string | null;
  certifications: string[];
  wwccVerified: boolean;
  wwccExpiry: string | null;
  vaccinationStatus: boolean;
  nannyHourlyRate: number | null;
}

interface ParentHubClientProps {
  position: PositionWithChildren | null;
  placement?: PlacementData | null;
  confirmedNannies?: ConfirmedNanny[];
  showFillButton?: boolean;
  upcomingIntros?: UpcomingIntro[];
  dfyTier?: "standard" | "priority" | null;
  dfyExpiresAt?: string | null;
  dfyActivated?: boolean;
  babysittingRequests?: BabysittingRequestWithSlots[];
  parentVerified?: boolean;
  initialTab?: string;
  initialSub?: string;
  initialView?: string;
  educationChildren?: ChildClient[];
  pendingInvites?: PendingInviteCard[];
}

function bsrFormatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function bsrFormatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function formatStartWeekLabel(d: Date): string {
  return `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

function getStartWeekOptionsFill(): {
  label: string;
  value: string;
  display: string;
}[] {
  const now = new Date();
  const day = now.getDay();
  const getMonday = (weeksAhead: number) => {
    const d = new Date(now);
    const diff = (day === 0 ? -6 : 1 - day) + weeksAhead * 7;
    d.setDate(now.getDate() + diff);
    return d;
  };
  const thisMon = getMonday(0);
  const nextMon = getMonday(1);
  const in2Mon = getMonday(2);
  return [
    {
      label: "This week",
      value: thisMon.toISOString().split("T")[0],
      display: formatStartWeekLabel(thisMon),
    },
    {
      label: "Next week",
      value: nextMon.toISOString().split("T")[0],
      display: formatStartWeekLabel(nextMon),
    },
    {
      label: "In 2 weeks",
      value: in2Mon.toISOString().split("T")[0],
      display: formatStartWeekLabel(in2Mon),
    },
    { label: "Different date", value: "custom", display: "" },
    { label: "To be confirmed", value: "tbc", display: "" },
  ];
}

function getParentStageBadge(
  stage: number,
  fillInitiatedBy?: string | null,
  trialDate?: string | null,
): { label: string; color: string } {
  switch (stage) {
    case CONNECTION_STAGE.REQUEST_SENT:
      return { label: "Request Sent", color: "bg-slate-100 text-slate-600" };
    case CONNECTION_STAGE.ACCEPTED:
      return { label: "Pick a Time", color: "bg-amber-100 text-amber-700" };
    case CONNECTION_STAGE.INTRO_SCHEDULED:
      return {
        label: "Meet Scheduled",
        color: "bg-violet-100 text-violet-700",
      };
    case CONNECTION_STAGE.INTRO_COMPLETE:
      return { label: "Meet Done", color: "bg-green-100 text-green-700" };
    case CONNECTION_STAGE.AWAITING_RESPONSE:
      return { label: "In Progress", color: "bg-amber-100 text-amber-700" };
    case CONNECTION_STAGE.TRIAL_ARRANGED: {
      if (fillInitiatedBy === "nanny")
        return { label: "Confirm Trial", color: "bg-amber-100 text-amber-700" };
      const today = new Date().toISOString().split("T")[0];
      if (trialDate && trialDate < today)
        return { label: "Trial Done", color: "bg-cyan-100 text-cyan-700" };
      return { label: "Trial Arranged", color: "bg-cyan-100 text-cyan-700" };
    }
    case CONNECTION_STAGE.TRIAL_COMPLETE:
      return { label: "Trial Done", color: "bg-cyan-100 text-cyan-700" };
    case CONNECTION_STAGE.OFFERED:
      return fillInitiatedBy === "nanny"
        ? { label: "Confirm Placement", color: "bg-green-100 text-green-700" }
        : {
            label: "Awaiting Confirmation",
            color: "bg-amber-100 text-amber-700",
          };
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

// ── Verification Modal ──
function VerificationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
            <Lock className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Verify your account
            </h3>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
              You must verify your account to gain full access to childcare and
              babysitting.
            </p>
          </div>
          <div className="flex w-full gap-2 mt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Later
            </Button>
            <Button
              asChild
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              <Link href="/parent/verification">
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                Verify Now
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab definitions ──
//
// `"children"` was previously named `"education"` (amendment A-02). The
// tab shows the children the parent is connected with — not educational
// content. The internal id matches the visible label. Old `?t=education`
// URLs are aliased at the parse site below so deep links keep working.
// Tab order — Children leftmost (per user spec 2026-05-07): the
// connected-children list is the parent's most-used surface, so it
// reads top-of-mind. Childcare and Babysitting follow as secondary
// surfaces.
const TABS = [
  { id: "children" as const, label: "Children" },
  { id: "childcare" as const, label: "Childcare" },
  { id: "babysitting" as const, label: "Babysitting" },
];
type TabId = (typeof TABS)[number]["id"];

/** Tab id aliases for backwards compatibility with bookmarked or emailed
 *  deep-links that predate the A-02 rename. Add new entries here as
 *  tabs are renamed; remove an entry once the old URL has been out of
 *  circulation long enough to be safe to retire. */
const TAB_ID_ALIASES: Record<string, TabId> = {
  // 2026-05-06 — A-02 rename
  education: "children",
};

/** Returns either a known TabId (alias hit) or the raw input (alias miss).
 *  Caller should still pass the result through `isTabId` before using —
 *  the alias map only catches known-old names, not arbitrary garbage. */
function resolveTabAlias(raw: string | undefined): TabId | string | undefined {
  if (raw === undefined) return undefined;
  return TAB_ID_ALIASES[raw] ?? raw;
}

const VALID_TAB_IDS = TABS.map((t) => t.id) as readonly TabId[];

function isTabId(value: unknown): value is TabId {
  return (
    typeof value === "string" &&
    (VALID_TAB_IDS as readonly string[]).includes(value)
  );
}

export function ParentHubClient({
  position,
  placement,
  confirmedNannies = [],
  showFillButton = false,
  upcomingIntros = [],
  dfyTier = null,
  dfyExpiresAt = null,
  dfyActivated = false,
  babysittingRequests = [],
  parentVerified = false,
  initialTab,
  initialSub,
  initialView,
  educationChildren = [],
  pendingInvites = [],
}: ParentHubClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile } = useAuth();

  // Resolve initial state from URL params. `aliasedInitialTab` runs the
  // raw `?t=` value through the rename-alias table so old `?t=education`
  // URLs land on the renamed `"children"` tab without a redirect (A-02).
  // `isTabId` is the type-predicate guard that lets us drop the
  // previous `as TabId` cast — the validation is still real, but
  // TypeScript narrows correctly through the guard.
  const validSubs = ["connections", "nannies", "childcare"] as const;
  const aliasedInitialTab = resolveTabAlias(initialTab);
  const resolvedTab: TabId = isTabId(aliasedInitialTab)
    ? aliasedInitialTab
    : "childcare";
  // A-04 init-time guard: `?s=nannies` is suppressed when the parent
  // already has an active placement. Without this, a stale bookmark or
  // the inline "see all nannies" link clicked before placement existed
  // would mount the keep-alive BrowseNanniesTab on a hub where the
  // tab itself is hidden (incoherent state — content visible, no
  // highlighted tab). Falls back to "childcare" which is the natural
  // default for a settled parent.
  const rawSub = (validSubs as readonly string[]).includes(initialSub ?? "")
    ? (initialSub as "connections" | "nannies" | "childcare")
    : "childcare";
  const resolvedSub: "connections" | "nannies" | "childcare" =
    rawSub === "nannies" && placement ? "childcare" : rawSub;
  const resolvedView = initialView === "matches" ? "matches" : "all";

  const [activeTab, setActiveTabState] = useState<TabId>(resolvedTab);
  const [nannySubTab, setNannySubTabState] = useState<
    "connections" | "nannies" | "childcare"
  >(resolvedSub);
  const [browseView, setBrowseViewState] = useState<"all" | "matches">(
    resolvedView,
  );

  // Build URL params and replace
  const syncUrl = useCallback(
    (t: TabId, s: string, v: string) => {
      const params = new URLSearchParams();
      params.set("t", t);
      if (t === "childcare") {
        params.set("s", s);
        if (s === "nannies") params.set("v", v);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  // Wrapped setters that sync URL
  const setActiveTab = useCallback(
    (t: TabId) => {
      setActiveTabState(t);
      const sub = t === "childcare" ? nannySubTab : "";
      const view =
        t === "childcare" && nannySubTab === "nannies" ? browseView : "all";
      syncUrl(t, sub, view);
    },
    [nannySubTab, browseView, syncUrl],
  );

  const setNannySubTab = useCallback(
    (s: "connections" | "nannies" | "childcare") => {
      setNannySubTabState(s);
      const view = s === "nannies" ? browseView : "all";
      syncUrl("childcare", s, view);
    },
    [browseView, syncUrl],
  );

  const setBrowseView = useCallback(
    (v: "all" | "matches") => {
      setBrowseViewState(v);
      syncUrl("childcare", "nannies", v);
    },
    [syncUrl],
  );

  // Track which sub-tabs have been activated (for keep-alive rendering)
  const [activatedSubs, setActivatedSubs] = useState<Set<string>>(
    () => new Set([resolvedSub]),
  );
  const prevSetNannySubTab = setNannySubTab;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setNannySubTabTracked = useCallback(
    (s: "connections" | "nannies" | "childcare") => {
      setActivatedSubs((prev) => {
        if (prev.has(s)) return prev;
        const next = new Set(prev);
        next.add(s);
        return next;
      });
      prevSetNannySubTab(s);
    },
    [prevSetNannySubTab],
  );

  // ── All state (same as PositionPageClient) ──
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showFillModal, setShowFillModal] = useState(false);
  const [fillingNannyId, setFillingNannyId] = useState<string | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillSuccess, setFillSuccess] = useState(false);
  const [selectedIntro, setSelectedIntro] = useState<UpcomingIntro | null>(
    null,
  );
  const [closeReason, setCloseReason] = useState<
    "found_elsewhere" | "no_longer_needed" | null
  >(null);
  const [closingReason, setClosingReason] = useState(false);
  const [fillStartWeek, setFillStartWeek] = useState<string | null>(null);
  const [fillCustomDate, setFillCustomDate] = useState("");
  const [fillSelectedNanny, setFillSelectedNanny] = useState<string | null>(
    null,
  );
  const [showNannyPopup, setShowNannyPopup] = useState(false);
  const [removeStep, setRemoveStep] = useState<"none" | "confirm" | "reason">(
    "none",
  );
  const [removeReason, setRemoveReason] = useState<string | null>(null);
  const [removeNotes, setRemoveNotes] = useState("");
  const [removing, setRemoving] = useState(false);
  const [positionExpanded, setPositionExpanded] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [editRateValue, setEditRateValue] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [editHoursValue, setEditHoursValue] = useState("");
  const [savingHours, setSavingHours] = useState(false);
  const [positionEditing, setPositionEditing] = useState(false);
  const [showPositionMenu, setShowPositionMenu] = useState(false);
  const [showContactPopup, setShowContactPopup] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [dfyConnections, setDfyConnections] = useState<DfyConnection[]>([]);
  const [dfyLoading, setDfyLoading] = useState(false);
  const [dfyLoaded, setDfyLoaded] = useState(false);
  const [schedulingDfyId, setSchedulingDfyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [schedulingDfy, setSchedulingDfy] = useState(false);
  const [selectedDfyIntro, setSelectedDfyIntro] =
    useState<UpcomingIntro | null>(null);
  const [selectedBsr, setSelectedBsr] =
    useState<BabysittingRequestWithSlots | null>(null);
  const [showBsrPast, setShowBsrPast] = useState(false);
  const [bsrSelectedNanny, setBsrSelectedNanny] =
    useState<RequestingNanny | null>(null);
  const [bsrAccepting, setBsrAccepting] = useState(false);
  const [bsrCancelling, setBsrCancelling] = useState(false);
  const [bsrConfirmedInfo, setBsrConfirmedInfo] = useState<{
    phone?: string;
    firstName?: string;
  } | null>(null);
  const [bsrError, setBsrError] = useState<string | null>(null);

  // ── Computed values ──
  const hasDfy =
    position &&
    (position as PositionWithChildren & { dfy_activated_at?: string | null })
      .dfy_activated_at;
  const dfyIntros = upcomingIntros.filter((i) => i.source === "dfy");

  const loadDfyConnections = async () => {
    if (!position || dfyLoading) return;
    setDfyLoading(true);
    const result = await getDfyConnections(position.id);
    if (result.data) setDfyConnections(result.data);
    setDfyLoading(false);
    setDfyLoaded(true);
  };

  if (hasDfy && !dfyLoaded && !dfyLoading) {
    loadDfyConnections();
  }

  // ── Handlers (same as PositionPageClient) ──
  const handleApproveDfy = async (connectionId: string, isoTime: string) => {
    setSchedulingDfy(true);
    const result = await scheduleIntroTime(connectionId, isoTime);
    setSchedulingDfy(false);
    if (result.success) {
      setSchedulingDfyId(null);
      setDfyConnections((prev) =>
        prev.map((c) =>
          c.connectionId === connectionId
            ? {
                ...c,
                connectionStage: CONNECTION_STAGE.INTRO_SCHEDULED,
                confirmedTime: isoTime,
              }
            : c,
        ),
      );
      router.refresh();
    }
  };

  const handleDeclineDfy = async (connectionId: string) => {
    setDecliningId(connectionId);
    const result = await declineDfyConnection(connectionId);
    setDecliningId(null);
    if (result.success) {
      setDfyConnections((prev) =>
        prev.filter((c) => c.connectionId !== connectionId),
      );
    }
  };

  const handleFillPosition = async (nannyId: string, startWeek?: string) => {
    if (!position) return;
    setFillingNannyId(nannyId);
    setFillError(null);
    const result = await parentInitiateFill(
      nannyId,
      position.id,
      startWeek || undefined,
    );
    setFillingNannyId(null);
    if (!result.success) {
      setFillError(result.error || "Something went wrong.");
    } else {
      setFillSuccess(true);
      setTimeout(() => {
        setShowFillModal(false);
        setFillSuccess(false);
        setFillStartWeek(null);
        setFillCustomDate("");
        setFillSelectedNanny(null);
        router.refresh();
      }, 2000);
    }
  };

  const handleClosePosition = async () => {
    if (!position) return;
    setClosing(true);
    const result = await closePosition(position.id);
    setClosing(false);
    if (result.success) {
      setShowCloseConfirm(false);
      router.refresh();
    }
  };

  const handleCloseWithReason = async () => {
    if (!closeReason) return;
    setClosingReason(true);
    const result = await closePositionWithReason(closeReason);
    setClosingReason(false);
    if (result.success) {
      setCloseReason(null);
      router.refresh();
    }
  };

  const handleConfirmPlacement = async (
    connectionId: string,
    startWeek?: string,
  ) => {
    const result = await confirmPlacement(connectionId, startWeek);
    if (result.success) router.refresh();
    return result;
  };

  const handleParentOutcome = async (
    connectionId: string,
    outcome: "hired" | "not_hired" | "awaiting" | "trial",
    dateValue?: string,
  ) => {
    const result = await reportParentOutcome(connectionId, outcome, dateValue);
    if (result.success) router.refresh();
    return result;
  };

  const handleRejectHiredClaim = async (connectionId: string) => {
    const result = await rejectHiredClaim(connectionId);
    if (result.success) router.refresh();
    return result;
  };

  const handleUpdateStartWeek = async (
    connectionId: string,
    startDate: string,
  ) => {
    const result = await updateConnectionStartWeek(connectionId, startDate);
    if (result.success) router.refresh();
    return result;
  };

  const handleRevertToAwaiting = async (connectionId: string) => {
    const result = await revertToAwaiting(connectionId);
    if (result.success) router.refresh();
    return result;
  };

  const handleScheduleTime = async (connectionId: string, isoTime: string) => {
    const result = await scheduleIntroTime(connectionId, isoTime);
    if (result.success) router.refresh();
    return result;
  };

  const handleRemoveNanny = async () => {
    if (!placement || !removeReason) return;
    setRemoving(true);
    const result = await removeNannyPlacement(
      placement.id,
      removeReason,
      removeNotes || undefined,
    );
    setRemoving(false);
    if (result.success) {
      setShowNannyPopup(false);
      setRemoveStep("none");
      setRemoveReason(null);
      setRemoveNotes("");
      router.refresh();
    }
  };

  const handleSaveRate = async () => {
    if (!placement) return;
    const rate = parseFloat(editRateValue);
    if (isNaN(rate) || rate <= 0) return;
    setSavingRate(true);
    const result = await updateParentPlacementRate(placement.id, rate);
    setSavingRate(false);
    if (result.success) {
      setEditingRate(false);
      router.refresh();
    }
  };

  const handleSaveHours = async () => {
    if (!placement) return;
    const hours = parseFloat(editHoursValue);
    if (isNaN(hours) || hours <= 0) return;
    setSavingHours(true);
    const result = await updateParentPlacementHours(placement.id, hours);
    setSavingHours(false);
    if (result.success) {
      setEditingHours(false);
      router.refresh();
    }
  };

  // ── BSR categorization ──
  const bsrSortBySlot = (
    a: BabysittingRequestWithSlots,
    b: BabysittingRequestWithSlots,
  ) => {
    const aSlot = a.slots?.[0]?.slot_date || "";
    const bSlot = b.slots?.[0]?.slot_date || "";
    return aSlot.localeCompare(bSlot);
  };
  const bsrPendingPayment = babysittingRequests
    .filter((r) => r.status === "pending_payment")
    .sort(bsrSortBySlot);
  const bsrActive = babysittingRequests
    .filter((r) => r.status === "open")
    .sort(bsrSortBySlot);
  const bsrFilled = babysittingRequests
    .filter((r) => r.status === "filled")
    .sort(bsrSortBySlot);
  const bsrPast = babysittingRequests
    .filter((r) =>
      ["expired", "cancelled", "nanny_cancelled", "completed"].includes(
        r.status,
      ),
    )
    .sort(bsrSortBySlot);
  const bsrHasActive =
    bsrPendingPayment.length > 0 ||
    bsrActive.length > 0 ||
    bsrFilled.length > 0;

  const handleBsrCancel = async (bsrId: string) => {
    setBsrCancelling(true);
    setBsrError(null);
    const result = await cancelBabysittingRequest(bsrId);
    setBsrCancelling(false);
    if (result.success) {
      setSelectedBsr(null);
      router.refresh();
    } else {
      setBsrError(result.error || "Failed to cancel");
    }
  };

  const handleBsrAcceptNanny = async (bsrId: string, nannyId: string) => {
    setBsrAccepting(true);
    setBsrError(null);
    const result = await parentAcceptNanny(bsrId, nannyId);
    setBsrAccepting(false);
    if (result.success) {
      setBsrConfirmedInfo({
        phone: result.nannyPhone,
        firstName: result.nannyFirstName,
      });
      setBsrSelectedNanny(null);
    } else {
      setBsrError(result.error || "Failed to accept");
    }
  };

  // ── Matchmaking computed ──
  const isMatchmakingActive =
    dfyActivated && dfyExpiresAt
      ? new Date(dfyExpiresAt).getTime() > Date.now()
      : false;
  const hasMatchedNannies = dfyConnections.length > 0;
  const matchmakingTimeRemaining = (() => {
    if (!dfyExpiresAt) return null;
    const diff = new Date(dfyExpiresAt).getTime() - Date.now();
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return "<1h";
  })();

  const details = position
    ? (position.details as Record<string, unknown> | null)
    : null;
  const formData = (details?.form_data ?? {}) as Partial<TypeformFormData>;
  const hasPosition = !!position;
  const hasFormData = !!details?.form_data;

  const firstName = profile?.first_name || "Parent";
  const profilePic = profile?.profile_picture_url;

  // A-04: hide the "Nannies" browse sub-tab when an active placement
  // exists. Discoverability is preserved via the inline "see all
  // nannies" link rendered under the PlacementCard on the position
  // page. Placement-end (status flips off `active`) makes `placement`
  // null again and the tab returns naturally.
  const subTabs = placement
    ? [
        { id: "childcare" as const, label: "My childcare" },
        { id: "connections" as const, label: "My Nanny" },
      ]
    : [
        { id: "childcare" as const, label: "My childcare" },
        { id: "nannies" as const, label: "Nannies" },
        { id: "connections" as const, label: "Connections" },
      ];

  // Show verify banner when unverified AND has any responses that would be locked
  const hasLockedCards =
    !parentVerified &&
    (dfyConnections.length > 0 ||
      upcomingIntros.length > 0 ||
      bsrActive.length > 0 ||
      bsrFilled.length > 0 ||
      bsrPendingPayment.length > 0);

  return (
    <>
      {/* T-039 Slice E-prime — no-position banner; primary nudge to `/parent/request`.
          Takes precedence over the verification banner: a parent without a
          position can't yet have locked verification-gated content in a
          user-actionable way, so we render the more actionable nudge alone. */}
      {!hasPosition && (
        <aside
          role="region"
          aria-label="Position incomplete notice"
          className="sticky top-16 z-30 -mt-4 lg:-mt-6 mb-4 lg:mb-6"
          style={{
            marginLeft: "calc(-50vw + 50%)",
            marginRight: "calc(-50vw + 50%)",
            width: "100vw",
          }}
        >
          <div className="border-b border-violet-100 bg-violet-50 px-4 lg:px-6 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs sm:text-sm text-violet-900">
                <ClipboardList
                  aria-hidden="true"
                  className="inline h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-1.5 -mt-0.5 text-violet-600"
                />
                Complete your position to connect with nannies
              </p>
              <Button
                asChild
                size="sm"
                className="shrink-0 bg-violet-600 hover:bg-violet-700 text-xs h-8 px-3"
              >
                <Link
                  href="/parent/request"
                  aria-label="Complete your position"
                >
                  Complete
                </Link>
              </Button>
            </div>
          </div>
        </aside>
      )}

      {/* Sticky verification banner — full viewport width. Suppressed when the
          no-position banner above is showing (avoids stacking the two sticky
          regions; the no-position state is the more actionable nudge). */}
      {hasLockedCards && hasPosition && (
        <aside
          role="region"
          aria-label="Verification required notice"
          className="sticky top-16 z-30 -mt-4 lg:-mt-6 mb-4 lg:mb-6"
          style={{
            marginLeft: "calc(-50vw + 50%)",
            marginRight: "calc(-50vw + 50%)",
            width: "100vw",
          }}
        >
          <div className="border-b border-emerald-100 bg-emerald-50 px-4 lg:px-6 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs sm:text-sm text-emerald-800">
                <ShieldCheck
                  aria-hidden="true"
                  className="inline h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 sm:mr-1.5 -mt-0.5 text-emerald-600"
                />
                Verify your account to be matched with a professional childcare
                provider
              </p>
              <Button
                asChild
                size="sm"
                className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-xs h-8 px-3"
              >
                <Link
                  href="/parent/verification"
                  aria-label="Verify your account now"
                >
                  Verify Now
                </Link>
              </Button>
            </div>
          </div>
        </aside>
      )}

      {/* ═══════════════════════════════════════════════════
          HERO CARD — profile + "My Childcare" accordion
         ═══════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Gradient header strip */}
        <div className="h-16 bg-gradient-to-br from-violet-50 to-violet-100/50" />

        <div className="px-5 pb-5">
          {/* Photo + Name — overlaps the header strip. Avatar is now
              click-to-edit per amendment A-05. The component preserves
              the prior visual (h-24 w-24, white border, violet bg) so
              the hero layout doesn't shift. */}
          <div className="flex items-end gap-4 -mt-10">
            <div className="relative shrink-0">
              <ParentAvatarEditor
                currentUrl={profilePic ?? null}
                firstName={firstName}
              />
            </div>

            <div className="flex-1 min-w-0 pb-1">
              <h1 className="text-2xl font-bold text-slate-900">{firstName}</h1>
            </div>
          </div>

          {/* ── Tab Bar ── */}
          <div className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                    isActive
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          TAB CONTENT — NANNIES
         ═══════════════════════════════════════════════════ */}
      <div style={{ display: activeTab === "childcare" ? undefined : "none" }}>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Sub-tab toggle */}
          <div className="px-4 pt-3 pb-0">
            <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {subTabs.map((tab) => {
                const isActive = nannySubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setNannySubTabTracked(tab.id)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      isActive
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-slate-600",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-tab: Connections */}
          {nannySubTab === "connections" &&
            (!hasPosition ? (
              /* No position — single CTA to create one */
              <div className="p-5">
                <div className="text-center py-6 space-y-4">
                  <Button asChild className="bg-violet-600 hover:bg-violet-700">
                    <Link href="/parent/request">I need a nanny</Link>
                  </Button>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Let us connect you with an amazing nanny tailored to your
                    family&apos;s needs
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-0">
                {/* My Nanny — placement card */}
                {placement && (
                  <>
                    <div>
                      <div className="px-5 py-4">
                        <div className="flex items-start gap-4 relative">
                          {/* Photo */}
                          <div className="shrink-0">
                            {placement.nannyPhoto ? (
                              <img
                                src={placement.nannyPhoto}
                                alt=""
                                className="w-20 h-20 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-20 h-20 rounded-full bg-violet-100 flex items-center justify-center">
                                <span className="text-2xl font-semibold text-violet-500">
                                  {placement.nannyName.charAt(0)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <h3 className="font-bold text-xl text-slate-900 truncate">
                                {placement.nannyName.split(" ")[0]}
                              </h3>
                              {placement.nannyDateOfBirth && (
                                <span className="text-base text-slate-400 shrink-0">
                                  {(() => {
                                    const birth = new Date(
                                      placement.nannyDateOfBirth,
                                    );
                                    const now = new Date();
                                    let age =
                                      now.getFullYear() - birth.getFullYear();
                                    const m = now.getMonth() - birth.getMonth();
                                    if (
                                      m < 0 ||
                                      (m === 0 &&
                                        now.getDate() < birth.getDate())
                                    )
                                      age--;
                                    return age;
                                  })()}
                                </span>
                              )}
                            </div>

                            {placement.nannySuburb && (
                              <div className="flex items-center gap-1 text-sm text-slate-400 mt-0.5">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                {placement.nannySuburb}
                              </div>
                            )}

                            {placement.wwccVerified && (
                              <div className="flex items-center gap-1 text-green-600 text-xs font-medium mt-1">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Verified
                              </div>
                            )}
                          </div>

                          {/* Right column — pay, hours, start date */}
                          <div className="shrink-0 text-right space-y-1.5 mr-14">
                            {editingRate ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-xs text-slate-400">
                                  $
                                </span>
                                <input
                                  type="number"
                                  step="0.50"
                                  min="0"
                                  className="w-16 text-sm border border-violet-300 rounded-md px-1.5 py-0.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-violet-400"
                                  value={editRateValue}
                                  onChange={(e) =>
                                    setEditRateValue(e.target.value)
                                  }
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      setEditingRate(false);
                                      setEditingHours(false);
                                    }
                                  }}
                                />
                                <span className="text-xs text-slate-400">
                                  /hr
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <DollarSign className="h-3.5 w-3.5 text-slate-400" />
                                <span className="text-sm text-slate-600 font-medium">
                                  {placement.hourlyRate
                                    ? `$${placement.hourlyRate}/hr`
                                    : placement.nannyHourlyRate
                                      ? `$${placement.nannyHourlyRate}/hr`
                                      : "Rate not set"}
                                </span>
                              </div>
                            )}

                            {editingHours ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  max="168"
                                  className="w-12 text-sm border border-violet-300 rounded-md px-1.5 py-0.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-violet-400"
                                  value={editHoursValue}
                                  onChange={(e) =>
                                    setEditHoursValue(e.target.value)
                                  }
                                  autoFocus={!editingRate}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      setEditingRate(false);
                                      setEditingHours(false);
                                    }
                                  }}
                                />
                                <span className="text-xs text-slate-400">
                                  hrs/wk
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                <span className="text-sm text-slate-600">
                                  {placement.weeklyHours
                                    ? `${placement.weeklyHours}hrs/wk`
                                    : "Hours not set"}
                                </span>
                              </div>
                            )}

                            {placement.startDate &&
                              placement.startDate !== "tbc" &&
                              (() => {
                                const startMon = new Date(
                                  placement.startDate + "T00:00:00",
                                );
                                const isPast = startMon <= new Date();
                                const label = startMon.toLocaleDateString(
                                  "en-GB",
                                  { day: "numeric", month: "short" },
                                );
                                return (
                                  <div className="flex items-center justify-end gap-1 text-sm text-slate-500">
                                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                    {isPast
                                      ? `Started ${label}`
                                      : `Starting ${label}`}
                                  </div>
                                );
                              })()}
                            {placement.startDate === "tbc" && (
                              <div className="flex items-center justify-end gap-1 text-sm text-amber-600">
                                <Calendar className="h-3.5 w-3.5" />
                                Start TBC
                              </div>
                            )}
                          </div>

                          {/* 3-dot menu + green tick — top right */}
                          <div className="absolute top-0 right-0 flex items-center gap-0.5">
                            {(editingRate || editingHours) && (
                              <button
                                onClick={async () => {
                                  if (editRateValue) await handleSaveRate();
                                  if (editHoursValue) await handleSaveHours();
                                  setEditingRate(false);
                                  setEditingHours(false);
                                }}
                                disabled={savingRate || savingHours}
                                className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                              >
                                {savingRate || savingHours ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setShowNannyPopup((p) => !p)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                              {showNannyPopup && (
                                <div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-10">
                                  <button
                                    onClick={() => {
                                      setShowNannyPopup(false);
                                      setEditingRate(true);
                                      setEditRateValue(
                                        placement.hourlyRate?.toString() ||
                                          placement.nannyHourlyRate?.toString() ||
                                          "",
                                      );
                                      setEditingHours(true);
                                      setEditHoursValue(
                                        placement.weeklyHours?.toString() || "",
                                      );
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-t-lg transition-colors"
                                  >
                                    Edit pay &amp; hours
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowNannyPopup(false);
                                      setShowContactPopup(true);
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                  >
                                    Contact
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowNannyPopup(false);
                                      setRemoveStep("confirm");
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-b-lg transition-colors"
                                  >
                                    Remove nanny
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* View Profile button */}
                        <div className="mt-4">
                          <Button asChild variant="outline" className="w-full">
                            <Link href={`/nannies/${placement.nannyId}`}>
                              View Profile
                              <ArrowRight className="ml-1.5 w-4 h-4" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Remove Nanny Dialog */}
                    <Dialog
                      open={removeStep !== "none"}
                      onOpenChange={(open) => {
                        if (!open) {
                          setRemoveStep("none");
                          setRemoveReason(null);
                          setRemoveNotes("");
                        }
                      }}
                    >
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>
                            Remove {placement.nannyName.split(" ")[0]} as your
                            nanny
                          </DialogTitle>
                        </DialogHeader>

                        {removeStep === "confirm" && (
                          <div className="space-y-3">
                            <div className="rounded-lg bg-red-50 border border-red-100 p-4 space-y-2">
                              <p className="text-sm font-medium text-slate-700">
                                We&apos;re really sorry to hear things
                                haven&apos;t worked out
                              </p>
                              <p className="text-sm text-slate-600">
                                We completely understand that sometimes it just
                                isn&apos;t the right fit, and that&apos;s okay.
                                Removing {placement.nannyName.split(" ")[0]}{" "}
                                will end your current placement, but your
                                childcare position will stay active so we can
                                continue helping you find the right match.
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
                              This helps us improve our matching and support for
                              families like yours.
                            </p>
                            <div className="space-y-1.5">
                              {[
                                {
                                  value: "parent_no_longer_needs",
                                  label: "We no longer need a nanny",
                                },
                                {
                                  value: "nanny_left",
                                  label: `${placement.nannyName.split(" ")[0]} is no longer available`,
                                },
                                {
                                  value: "mutual_agreement",
                                  label: "It was a mutual decision",
                                },
                                {
                                  value: "relocation",
                                  label: "We or the nanny are relocating",
                                },
                                {
                                  value: "child_aged_out",
                                  label: "Our children no longer need a nanny",
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
                                  onChange={(e) =>
                                    setRemoveNotes(e.target.value)
                                  }
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
                                onClick={handleRemoveNanny}
                              >
                                {removing ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : null}
                                Remove nanny
                              </Button>
                            </div>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>

                    {/* Contact Popup */}
                    <Dialog
                      open={showContactPopup}
                      onOpenChange={setShowContactPopup}
                    >
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>
                            Contact {placement.nannyName.split(" ")[0]}
                          </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          {placement.nannyPhone && (
                            <a
                              href={`tel:${placement.nannyPhone}`}
                              className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 hover:bg-violet-50 hover:border-violet-200 transition-colors"
                            >
                              <Phone className="h-4 w-4 text-violet-500" />
                              {placement.nannyPhone}
                            </a>
                          )}
                          {placement.nannyEmail && (
                            <a
                              href={`mailto:${placement.nannyEmail}`}
                              className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 hover:bg-violet-50 hover:border-violet-200 transition-colors"
                            >
                              <Mail className="h-4 w-4 text-violet-500" />
                              {placement.nannyEmail}
                            </a>
                          )}
                          {!placement.nannyPhone && !placement.nannyEmail && (
                            <p className="text-sm text-slate-500 text-center py-2">
                              No contact details available
                            </p>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </>
                )}

                {/* Nannies — combined matched nannies + connections */}
                {!placement &&
                  (() => {
                    const nonDfyIntros = upcomingIntros.filter(
                      (i) => i.source !== "dfy",
                    );
                    return (
                      <div className="px-5 pb-5 pt-2">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            Matched Nannies
                            {dfyConnections.length > 0
                              ? ` (${dfyConnections.length})`
                              : ""}
                          </p>
                          <div className="flex items-center gap-3">
                            {isMatchmakingActive && matchmakingTimeRemaining ? (
                              <div className="rounded-full bg-green-50 border border-green-100 px-3 py-1">
                                <p className="text-xs font-medium text-green-700">
                                  You have{" "}
                                  {dfyTier === "priority"
                                    ? "Priority"
                                    : "Standard"}{" "}
                                  matchmaking for the next{" "}
                                  {matchmakingTimeRemaining}!
                                </p>
                              </div>
                            ) : !isMatchmakingActive && hasMatchedNannies ? (
                              <Link
                                href="/parent/matchmaking"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors"
                              >
                                <Sparkles className="w-3 h-3" />
                                Find my perfect nanny
                              </Link>
                            ) : null}
                            {showFillButton && (
                              <button
                                onClick={() => setShowFillModal(true)}
                                className="text-sm font-semibold text-violet-600 hover:text-violet-800 transition-colors"
                              >
                                I have made my decision
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Matchmaking CTA (when no active DFY, or DFY expired with no responses) */}
                        {(!hasDfy ||
                          (!isMatchmakingActive &&
                            dfyConnections.length === 0)) && (
                          <div className="text-center py-4 space-y-3">
                            <div className="flex items-center justify-center gap-4">
                              <Button
                                asChild
                                className="bg-violet-600 hover:bg-violet-700"
                              >
                                <Link href="/parent/matchmaking">
                                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                  Find my nanny for me
                                </Link>
                              </Button>
                              <Link
                                href="/parent?t=childcare&s=nannies"
                                className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                Browse nannies
                                <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                            <p className="text-xs text-slate-400 max-w-md mx-auto">
                              Let us do all the heavy lifting! We will use our
                              AI matchmaking algorithm to connect you with the
                              best nannies for your specific childcare needs
                            </p>
                          </div>
                        )}

                        {/* Matched Nannies (only when actively matching or has responses) */}
                        {(isMatchmakingActive || dfyConnections.length > 0) && (
                          <div className="mb-2">
                            {/* DFY loading / awaiting */}
                            {dfyConnections.length === 0 && (
                              <div className="text-center py-4">
                                {!dfyLoaded ? (
                                  <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading...
                                  </div>
                                ) : isMatchmakingActive ? (
                                  <p className="text-sm text-slate-500">
                                    We&apos;re reaching out to your top matches
                                    — awaiting responses
                                  </p>
                                ) : (
                                  <p className="text-sm text-slate-400">
                                    No responses yet
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Matched nanny cards */}
                            {dfyConnections.length > 0 && (
                              <div className="space-y-3">
                                {dfyConnections.map((conn) => {
                                  const score = Math.round(
                                    50 + (conn.matchScore / 100) * 50,
                                  );
                                  const nannyAge = calcAge(
                                    conn.nanny.dateOfBirth,
                                  );
                                  const isDeclining =
                                    decliningId === conn.connectionId;
                                  const isScheduling =
                                    schedulingDfyId === conn.connectionId;
                                  const isScheduled =
                                    conn.connectionStage >=
                                    CONNECTION_STAGE.INTRO_SCHEDULED;
                                  const matchingIntro = dfyIntros.find(
                                    (i) => i.connectionId === conn.connectionId,
                                  );
                                  const badge = isScheduled
                                    ? getParentStageBadge(
                                        conn.connectionStage,
                                        matchingIntro?.fillInitiatedBy ?? null,
                                        matchingIntro?.trialDate ?? null,
                                      )
                                    : null;

                                  const isLocked = !parentVerified;

                                  return (
                                    <div
                                      key={conn.connectionId}
                                      className={`relative rounded-lg border border-slate-100 bg-white p-3 space-y-3 ${isScheduled && !isLocked ? "cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors" : ""} ${isLocked ? "cursor-pointer" : ""}`}
                                      onClick={
                                        isLocked
                                          ? () => setShowVerifyModal(true)
                                          : isScheduled && matchingIntro
                                            ? () =>
                                                setSelectedDfyIntro(
                                                  matchingIntro,
                                                )
                                            : undefined
                                      }
                                    >
                                      {isLocked && (
                                        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 shadow-sm">
                                            <Lock className="h-4 w-4 text-slate-400" />
                                          </div>
                                        </div>
                                      )}
                                      <div
                                        className={`flex items-center gap-3 ${!isLocked && !isScheduled && matchingIntro ? "cursor-pointer" : ""}`}
                                        onClick={
                                          !isLocked &&
                                          !isScheduled &&
                                          matchingIntro
                                            ? (e) => {
                                                e.stopPropagation();
                                                setSelectedDfyIntro(
                                                  matchingIntro,
                                                );
                                              }
                                            : undefined
                                        }
                                      >
                                        <div className="relative shrink-0">
                                          {conn.nanny.profilePicUrl ? (
                                            <img
                                              src={conn.nanny.profilePicUrl}
                                              alt={conn.nanny.firstName}
                                              className="w-10 h-10 rounded-full object-cover"
                                            />
                                          ) : (
                                            <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                                              <span className="text-sm font-semibold text-violet-500">
                                                {conn.nanny.firstName[0]}
                                                {conn.nanny.lastName[0]}
                                              </span>
                                            </div>
                                          )}
                                          {conn.nanny.wwccVerified && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                                              <ShieldCheck className="w-3 h-3 text-green-500" />
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-baseline gap-1.5">
                                            <span className="text-sm font-medium text-slate-900 truncate">
                                              {conn.nanny.firstName}
                                            </span>
                                            {nannyAge && (
                                              <span className="text-xs text-slate-400">
                                                {nannyAge}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 text-xs text-slate-400">
                                            {conn.nanny.suburb && (
                                              <span className="flex items-center gap-1">
                                                <MapPin className="w-2.5 h-2.5" />
                                                {conn.nanny.suburb}
                                                {conn.distanceKm != null &&
                                                  ` (${conn.distanceKm < 1 ? "<1" : conn.distanceKm.toFixed(0)} km)`}
                                              </span>
                                            )}
                                            {conn.nanny.hourlyRateMin && (
                                              <span className="flex items-center gap-1">
                                                <DollarSign className="w-2.5 h-2.5" />
                                                ${conn.nanny.hourlyRateMin}/hr
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <div
                                            className={`rounded-lg border px-2 py-0.5 font-semibold text-xs ${getScoreBadgeStyle(score)}`}
                                          >
                                            {score}%{" "}
                                            {dfyTier === "standard"
                                              ? "Logistical Score"
                                              : "Match"}
                                          </div>
                                          {isScheduled && badge && (
                                            <span
                                              className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${badge.color}`}
                                            >
                                              {badge.label}
                                            </span>
                                          )}
                                          {isScheduled && (
                                            <ChevronRight className="h-4 w-4 text-slate-300" />
                                          )}
                                        </div>
                                      </div>

                                      {isScheduling && conn.proposedTimes && (
                                        <ScheduleTimeGrid
                                          proposedTimes={conn.proposedTimes}
                                          otherPartyName={`${conn.nanny.firstName} ${conn.nanny.lastName}`}
                                          submitting={schedulingDfy}
                                          onBack={() =>
                                            setSchedulingDfyId(null)
                                          }
                                          onConfirm={(isoTime) =>
                                            handleApproveDfy(
                                              conn.connectionId,
                                              isoTime,
                                            )
                                          }
                                        />
                                      )}

                                      {!isLocked &&
                                        !isScheduled &&
                                        !isScheduling && (
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSchedulingDfyId(
                                                  conn.connectionId,
                                                );
                                              }}
                                              disabled={isDeclining}
                                              className="flex-1 bg-violet-600 hover:bg-violet-700 text-xs"
                                            >
                                              <CheckCircle className="w-3.5 h-3.5 mr-1" />
                                              Approve
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeclineDfy(
                                                  conn.connectionId,
                                                );
                                              }}
                                              disabled={isDeclining}
                                              className="flex-1 text-xs"
                                            >
                                              {isDeclining ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                              ) : (
                                                <XCircle className="w-3.5 h-3.5 mr-1" />
                                              )}
                                              Decline
                                            </Button>
                                          </div>
                                        )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Find more — when DFY expired but has responses */}
                            {!isMatchmakingActive &&
                              dfyConnections.length > 0 && (
                                <div className="text-center pt-3">
                                  <Link
                                    href="/parent/matchmaking"
                                    className="inline-flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 transition-colors"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Find more matches for me
                                  </Link>
                                </div>
                              )}
                          </div>
                        )}

                        {/* Connections */}
                        <div className="mt-5 pt-5 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              Connections
                              {nonDfyIntros.length > 0
                                ? ` (${nonDfyIntros.length})`
                                : ""}
                            </p>
                            {nonDfyIntros.length > 0 && (
                              <Link
                                href="/parent?t=childcare&s=nannies"
                                className="inline-flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                Browse nannies
                                <ChevronRight className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                          {nonDfyIntros.length === 0 ? (
                            <div className="text-center py-4">
                              <p className="text-sm text-slate-400">
                                No connections yet
                              </p>
                              <Link
                                href="/parent?t=childcare&s=nannies"
                                className="inline-flex items-center gap-1 mt-2 text-sm text-violet-600 hover:text-violet-700 transition-colors"
                              >
                                Browse nannies
                                <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {nonDfyIntros.map((intro) => {
                                const badge = getParentStageBadge(
                                  intro.connectionStage,
                                  intro.fillInitiatedBy,
                                  intro.trialDate,
                                );
                                const isLocked = !parentVerified;
                                return (
                                  <div
                                    key={intro.connectionId}
                                    className="relative flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors"
                                    onClick={
                                      isLocked
                                        ? () => setShowVerifyModal(true)
                                        : () => setSelectedIntro(intro)
                                    }
                                  >
                                    {isLocked && (
                                      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 shadow-sm">
                                          <Lock className="h-4 w-4 text-slate-400" />
                                        </div>
                                      </div>
                                    )}
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
                                                {intro.startDate === "tbc"
                                                  ? "Start week to be confirmed"
                                                  : `Starting ${formatStartWeekLabel(new Date(intro.startDate + "T00:00:00")).replace("Week", "week")}`}
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
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
              </div>
            ))}

          {/* Sub-tab: Nannies (keep mounted once activated). A-04
              defensive `!placement` guard: even with the init-time
              `?s=nannies` redirect above, future code paths that
              mutate nannySubTab while a placement is live shouldn't
              be able to mount the BrowseNanniesTab. */}
          {activatedSubs.has("nannies") && !placement && (
            <div
              style={{
                display: nannySubTab === "nannies" ? undefined : "none",
              }}
            >
              <BrowseNanniesTab
                initialView={browseView}
                onViewChange={setBrowseView}
              />
            </div>
          )}

          {/* Sub-tab: My childcare */}
          {nannySubTab === "childcare" && (
            <MyChildcareTab
              position={position}
              hasActivePlacement={!!placement}
            />
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          TAB CONTENT — BABYSITTING
         ═══════════════════════════════════════════════════ */}
      <div
        style={{ display: activeTab === "babysitting" ? undefined : "none" }}
      >
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-end px-5 py-4">
            {bsrHasActive && (
              <Button
                asChild
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-xs h-8 px-3"
              >
                <Link href="/parent/babysitting">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Find Babysitter
                </Link>
              </Button>
            )}
          </div>
          <div className="px-5 pb-5">
            {!bsrHasActive ? (
              <div className="text-center py-4 space-y-4">
                <Button asChild className="bg-violet-600 hover:bg-violet-700">
                  <Link href="/parent/babysitting">
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Find Babysitter
                  </Link>
                </Button>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Need a sitter? We&apos;ll find you verified childcare
                  professionals in your area
                </p>

                {bsrPast.length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setShowBsrPast(!showBsrPast)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-slate-600 transition-colors"
                    >
                      {showBsrPast ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      Past ({bsrPast.length})
                    </button>
                    {showBsrPast && (
                      <div className="space-y-2 mt-2 text-left">
                        {bsrPast.map((req) => (
                          <BsrTileInline
                            key={req.id}
                            request={req}
                            locked={!parentVerified}
                            onLockedClick={() => setShowVerifyModal(true)}
                            onClick={() => setSelectedBsr(req)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Pending Payment */}
                {bsrPendingPayment.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide flex items-center gap-1.5">
                      <ShoppingCart className="h-3.5 w-3.5" />
                      Cart ({bsrPendingPayment.length})
                    </p>
                    <div className="space-y-2">
                      {bsrPendingPayment.map((req) => {
                        const firstSlot = req.slots?.[0];
                        const isLocked = !parentVerified;
                        return (
                          <div
                            key={req.id}
                            className="relative flex items-center justify-between gap-3 rounded-lg border border-violet-200 bg-white p-3 cursor-pointer hover:bg-violet-50 transition-colors"
                            onClick={
                              isLocked
                                ? () => setShowVerifyModal(true)
                                : () => {
                                    window.location.href = `/parent/babysitting/${req.id}/payment`;
                                  }
                            }
                          >
                            {isLocked && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 shadow-sm">
                                  <Lock className="h-4 w-4 text-slate-400" />
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100">
                                <ShoppingCart className="h-4 w-4 text-violet-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-800">
                                  {firstSlot
                                    ? bsrFormatSlotDate(firstSlot.slot_date)
                                    : "Babysitting Request"}
                                  {firstSlot &&
                                    ` · ${bsrFormatTime(firstSlot.start_time)}`}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {req.suburb}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                                Checkout
                              </span>
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Active — awaiting nanny responses */}
                {bsrActive.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Awaiting Response ({bsrActive.length})
                    </p>
                    <div className="space-y-2">
                      {bsrActive.map((req) => (
                        <BsrTileInline
                          key={req.id}
                          request={req}
                          locked={!parentVerified}
                          onLockedClick={() => setShowVerifyModal(true)}
                          onClick={() => setSelectedBsr(req)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Filled — confirmed bookings */}
                {bsrFilled.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-green-600 uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Bookings ({bsrFilled.length})
                    </p>
                    <div className="space-y-2">
                      {bsrFilled.map((req) => (
                        <BsrTileInline
                          key={req.id}
                          request={req}
                          locked={!parentVerified}
                          onLockedClick={() => setShowVerifyModal(true)}
                          onClick={() => setSelectedBsr(req)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Past (collapsible) */}
                {bsrPast.length > 0 && (
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowBsrPast(!showBsrPast)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-slate-600 transition-colors"
                    >
                      {showBsrPast ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      Past ({bsrPast.length})
                    </button>
                    {showBsrPast && (
                      <div className="space-y-2">
                        {bsrPast.map((req) => (
                          <BsrTileInline
                            key={req.id}
                            request={req}
                            locked={!parentVerified}
                            onLockedClick={() => setShowVerifyModal(true)}
                            onClick={() => setSelectedBsr(req)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          TAB CONTENT — EDUCATION
         ═══════════════════════════════════════════════════ */}
      <div style={{ display: activeTab === "children" ? undefined : "none" }}>
        <PendingInvitesSection initialInvites={pendingInvites} />
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* eslint-disable-next-line react/no-children-prop -- `children` here is the data prop name of ChildCardGrid, not React children */}
          <ChildCardGrid children={educationChildren} role="parent" />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          MODALS — BSR Detail, Connection Popups, etc.
         ═══════════════════════════════════════════════════ */}

      {/* Verification Modal */}
      <VerificationModal
        open={showVerifyModal}
        onClose={() => setShowVerifyModal(false)}
      />

      {/* BSR Detail Modal */}
      {selectedBsr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {selectedBsr.status === "filled"
                    ? "Babysitting Booking"
                    : "Babysitting Request"}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedBsr(null);
                    setBsrError(null);
                    setBsrSelectedNanny(null);
                    setBsrConfirmedInfo(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status badge */}
              {selectedBsr.status === "open" && (
                <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  Awaiting Babysitters
                </span>
              )}
              {selectedBsr.status === "filled" && (
                <span className="inline-block rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                  Confirmed
                </span>
              )}
              {[
                "expired",
                "cancelled",
                "nanny_cancelled",
                "completed",
              ].includes(selectedBsr.status) && (
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
                    selectedBsr.status === "completed"
                      ? "bg-green-100 text-green-700"
                      : selectedBsr.status === "expired"
                        ? "bg-amber-100 text-amber-800"
                        : selectedBsr.status === "nanny_cancelled"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {selectedBsr.status === "completed"
                    ? "Completed"
                    : selectedBsr.status === "expired"
                      ? "Expired"
                      : selectedBsr.status === "nanny_cancelled"
                        ? "Nanny Cancelled"
                        : "Cancelled"}
                </span>
              )}

              {/* Requesting Nannies */}
              {selectedBsr.status === "open" &&
                selectedBsr.requestingNannies.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      Nannies Requesting ({selectedBsr.requestingNannies.length}
                      )
                    </p>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                      {selectedBsr.requestingNannies.map((nanny) => (
                        <button
                          key={nanny.nannyId}
                          onClick={() => setBsrSelectedNanny(nanny)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          {nanny.profilePicUrl ? (
                            <img
                              src={nanny.profilePicUrl}
                              alt=""
                              className="h-9 w-9 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 flex-shrink-0">
                              <span className="text-xs font-semibold text-violet-600">
                                {nanny.firstName[0]}
                              </span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {nanny.firstName}
                              {calcAge(nanny.dateOfBirth) !== null
                                ? `, ${calcAge(nanny.dateOfBirth)}`
                                : ""}
                            </p>
                            <p className="text-xs text-slate-500">
                              {nanny.distanceKm !== null && (
                                <span>
                                  {nanny.distanceKm < 1
                                    ? "<1"
                                    : nanny.distanceKm}{" "}
                                  km
                                </span>
                              )}
                              {nanny.experienceYears && (
                                <span> · {nanny.experienceYears}yr exp</span>
                              )}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Nanny Mini Popup */}
              {bsrSelectedNanny && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                  <Card className="w-full max-w-sm">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Nanny Profile
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setBsrSelectedNanny(null);
                            setBsrError(null);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        {bsrSelectedNanny.profilePicUrl ? (
                          <img
                            src={bsrSelectedNanny.profilePicUrl}
                            alt=""
                            className="h-14 w-14 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
                            <span className="text-lg font-semibold text-violet-600">
                              {bsrSelectedNanny.firstName[0]}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="text-base font-semibold text-slate-900">
                            {bsrSelectedNanny.firstName}
                            {calcAge(bsrSelectedNanny.dateOfBirth) !== null
                              ? `, ${calcAge(bsrSelectedNanny.dateOfBirth)}`
                              : ""}
                          </p>
                          {bsrSelectedNanny.suburb && (
                            <p className="text-sm text-slate-500">
                              {bsrSelectedNanny.suburb}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 text-sm text-slate-600">
                        {bsrSelectedNanny.distanceKm !== null && (
                          <p className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-slate-400" />
                            {bsrSelectedNanny.distanceKm < 1
                              ? "<1"
                              : bsrSelectedNanny.distanceKm}{" "}
                            km away
                          </p>
                        )}
                        {bsrSelectedNanny.experienceYears && (
                          <p className="flex items-center gap-1.5">
                            <Star className="h-3.5 w-3.5 text-slate-400" />
                            {bsrSelectedNanny.experienceYears} years experience
                          </p>
                        )}
                        {bsrSelectedNanny.languages &&
                          bsrSelectedNanny.languages.length > 0 && (
                            <p className="flex items-center gap-1.5">
                              <Globe className="h-3.5 w-3.5 text-slate-400" />
                              {bsrSelectedNanny.languages.join(", ")}
                            </p>
                          )}
                      </div>
                      {bsrSelectedNanny.aiHeadline && (
                        <p className="text-sm text-slate-500 italic line-clamp-3">
                          {bsrSelectedNanny.aiHeadline.replace(/<[^>]*>/g, "")}
                        </p>
                      )}
                      {bsrError && (
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          {bsrError}
                        </div>
                      )}
                      <div className="space-y-2">
                        <Button
                          className="w-full bg-violet-500 hover:bg-violet-600"
                          disabled={bsrAccepting}
                          onClick={() =>
                            handleBsrAcceptNanny(
                              selectedBsr.id,
                              bsrSelectedNanny.nannyId,
                            )
                          }
                        >
                          {bsrAccepting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="mr-2 h-4 w-4" />
                          )}
                          Accept Babysitter
                        </Button>
                        <a
                          href={`/nannies/${bsrSelectedNanny.nannyId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full text-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          View Full Profile
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Confirmed nanny info popup */}
              {bsrConfirmedInfo && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                  <Card className="w-full max-w-sm">
                    <CardContent className="pt-6 space-y-4 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                        <CheckCircle className="h-6 w-6 text-green-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        Babysitter Confirmed!
                      </h3>
                      {bsrConfirmedInfo.firstName && (
                        <p className="text-slate-600">
                          {bsrConfirmedInfo.firstName} has been confirmed for
                          your babysitting job.
                        </p>
                      )}
                      {bsrConfirmedInfo.phone && (
                        <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 space-y-2">
                          <p className="text-sm font-medium text-slate-700 flex items-center justify-center gap-2">
                            <Phone className="h-4 w-4 text-violet-500" />
                            {bsrConfirmedInfo.phone}
                          </p>
                        </div>
                      )}
                      <p className="text-sm text-slate-500">
                        Please contact your babysitter directly to confirm all
                        the details.
                      </p>
                      <Button
                        className="w-full bg-violet-500 hover:bg-violet-600"
                        onClick={() => {
                          setBsrConfirmedInfo(null);
                          setSelectedBsr(null);
                          router.refresh();
                        }}
                      >
                        Done
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Accepted nanny details for filled BSR */}
              {selectedBsr.status === "filled" && selectedBsr.acceptedNanny && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
                    {selectedBsr.acceptedNanny.profilePicUrl ? (
                      <img
                        src={selectedBsr.acceptedNanny.profilePicUrl}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-200">
                        <UserCheck className="h-5 w-5 text-green-700" />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900">
                        {selectedBsr.acceptedNanny.firstName}
                        {calcAge(selectedBsr.acceptedNanny.dateOfBirth) !== null
                          ? `, ${calcAge(selectedBsr.acceptedNanny.dateOfBirth)}`
                          : ""}
                      </p>
                      {selectedBsr.acceptedNanny.distanceKm !== null && (
                        <p className="text-xs text-green-700">
                          {selectedBsr.acceptedNanny.distanceKm < 1
                            ? "<1 km"
                            : `${selectedBsr.acceptedNanny.distanceKm} km`}{" "}
                          away
                        </p>
                      )}
                    </div>
                    <a
                      href={`/nannies/${selectedBsr.accepted_nanny_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-green-700 hover:text-green-900 transition-colors"
                    >
                      View Profile
                    </a>
                  </div>
                  <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
                    <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
                      <Phone className="h-4 w-4 text-violet-500" />
                      {selectedBsr.acceptedNanny.phone ?? "Phone not available"}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Please contact your babysitter directly to confirm all
                      details.
                    </p>
                  </div>
                </div>
              )}

              {/* Time slots */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                {selectedBsr.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between px-3 py-2.5"
                  >
                    <span className="text-sm text-slate-700">
                      {bsrFormatSlotDate(slot.slot_date)}
                    </span>
                    <span className="text-sm text-slate-500">
                      {bsrFormatTime(slot.start_time)} –{" "}
                      {bsrFormatTime(slot.end_time)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>
                    {selectedBsr.address && <>{selectedBsr.address}, </>}
                    {selectedBsr.suburb} {selectedBsr.postcode}
                  </span>
                </div>
                {(() => {
                  let mins = 0;
                  for (const s of selectedBsr.slots) {
                    if (s.start_time && s.end_time) {
                      const [sh, sm] = s.start_time.split(":").map(Number);
                      const [eh, em] = s.end_time.split(":").map(Number);
                      mins += eh * 60 + em - (sh * 60 + sm);
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
                {selectedBsr.hourly_rate && (
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-3.5 w-3.5" />$
                    {selectedBsr.hourly_rate}/hr
                    {(() => {
                      let mins = 0;
                      for (const s of selectedBsr.slots) {
                        if (s.start_time && s.end_time) {
                          const [sh, sm] = s.start_time.split(":").map(Number);
                          const [eh, em] = s.end_time.split(":").map(Number);
                          mins += eh * 60 + em - (sh * 60 + sm);
                        }
                      }
                      const hrs = Math.round((mins / 60) * 10) / 10;
                      const est = Math.round(hrs * selectedBsr.hourly_rate!);
                      return hrs > 0 ? <span> (est. ${est})</span> : null;
                    })()}
                  </div>
                )}
                {selectedBsr.special_requirements && (
                  <p className="text-sm text-slate-600 italic">
                    &ldquo;{selectedBsr.special_requirements}&rdquo;
                  </p>
                )}
              </div>

              {bsrError && !bsrSelectedNanny && (
                <p className="text-sm text-red-600">{bsrError}</p>
              )}

              {/* Cancel button */}
              {(selectedBsr.status === "open" ||
                selectedBsr.status === "filled") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-500"
                  disabled={bsrCancelling}
                  onClick={() => handleBsrCancel(selectedBsr.id)}
                >
                  {bsrCancelling ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <X className="mr-1 h-3 w-3" />
                  )}
                  {selectedBsr.status === "filled"
                    ? "Cancel Booking"
                    : "Cancel Request"}
                </Button>
              )}

              <p className="text-xs text-slate-400">
                Created{" "}
                {new Date(selectedBsr.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </CardContent>
          </Card>
        </div>
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
        role="parent"
        onConfirmPlacement={handleConfirmPlacement}
        onParentOutcome={handleParentOutcome}
        onRejectHiredClaim={handleRejectHiredClaim}
        onRevertToAwaiting={handleRevertToAwaiting}
        onScheduleTime={handleScheduleTime}
        onUpdateStartWeek={handleUpdateStartWeek}
        onConfirmTrial={async (connectionId, trialDate) => {
          const result = await confirmTrialArrangement(connectionId, trialDate);
          if (result.success) router.refresh();
          return result;
        }}
        onDeclineTrial={async (connectionId) => {
          const result = await declineTrialArrangement(connectionId);
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
        const selectedDfyConn = dfyConnections.find(
          (c) => c.connectionId === selectedDfyIntro?.connectionId,
        );
        return (
          <ConnectionDetailPopup
            intro={selectedDfyIntro}
            open={selectedDfyIntro !== null}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedDfyIntro(null);
                router.refresh();
                loadDfyConnections();
              }
            }}
            role="parent"
            matchData={
              selectedDfyConn
                ? {
                    matchScore: selectedDfyConn.matchScore,
                    distanceKm: selectedDfyConn.distanceKm,
                    breakdown: selectedDfyConn.breakdown,
                    nannySchedule: selectedDfyConn.nanny.schedule,
                    aiHeadline: selectedDfyConn.nanny.aiHeadline,
                    tier: (dfyTier as "standard" | "priority") || "standard",
                    nannyId: selectedDfyConn.nannyId,
                    overQualifiedBonuses: selectedDfyConn.overQualifiedBonuses,
                    unmetRequirements: selectedDfyConn.unmetRequirements,
                  }
                : null
            }
            onConfirmPlacement={handleConfirmPlacement}
            onParentOutcome={handleParentOutcome}
            onRejectHiredClaim={handleRejectHiredClaim}
            onRevertToAwaiting={handleRevertToAwaiting}
            onScheduleTime={handleScheduleTime}
            onUpdateStartWeek={handleUpdateStartWeek}
            onConfirmTrial={async (connectionId, trialDate) => {
              const result = await confirmTrialArrangement(
                connectionId,
                trialDate,
              );
              if (result.success) router.refresh();
              return result;
            }}
            onDeclineTrial={async (connectionId) => {
              const result = await declineTrialArrangement(connectionId);
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

      {/* Close Position Confirmation */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Close Position?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-slate-600">
                Are you sure you want to close this childcare position? This
                will:
              </p>
              <ul className="list-disc list-inside text-sm text-slate-600 space-y-1">
                <li>Remove your position from matching</li>
                <li>Cancel any pending interview requests</li>
                <li>Allow you to create a new position</li>
              </ul>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleClosePosition}
                  disabled={closing}
                >
                  {closing ? "Closing..." : "Close Position"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Close with Reason Confirmation */}
      {closeReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-700">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {closeReason === "found_elsewhere"
                  ? "Found a nanny elsewhere?"
                  : "No longer need a nanny?"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                {closeReason === "found_elsewhere"
                  ? "This will end your current nanny connections. Your position will remain on file so we can help you in the future."
                  : "This will end your current nanny connections. Your position will remain on file in case you change your mind."}
              </p>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCloseReason(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCloseWithReason}
                  disabled={closingReason}
                >
                  {closingReason ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  Confirm
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Path B: Select Nanny Modal */}
      {showFillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-center justify-between">
                {fillSelectedNanny ? (
                  (() => {
                    const selectedNanny = confirmedNannies.find(
                      (n) => n.nannyId === fillSelectedNanny,
                    );
                    return (
                      <div className="flex items-center gap-3">
                        {selectedNanny?.nannyPhoto ? (
                          <img
                            src={selectedNanny.nannyPhoto}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                            <span className="text-sm font-semibold text-violet-600">
                              {selectedNanny?.nannyName.charAt(0)}
                            </span>
                          </div>
                        )}
                        <div>
                          <CardTitle className="text-base">
                            {selectedNanny?.nannyName}
                          </CardTitle>
                          {selectedNanny?.nannySuburb && (
                            <p className="text-xs text-slate-500">
                              {selectedNanny.nannySuburb}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <CardTitle className="text-base">
                    Which nanny did you choose?
                  </CardTitle>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowFillModal(false);
                    setFillError(null);
                    setFillSuccess(false);
                    setFillStartWeek(null);
                    setFillCustomDate("");
                    setFillSelectedNanny(null);
                  }}
                >
                  <span className="text-lg">&times;</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {fillSuccess ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-green-800">
                    We&apos;ve reached out to the nanny to confirm the details.
                  </p>
                </div>
              ) : fillSelectedNanny ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">
                    When would you like{" "}
                    {
                      confirmedNannies
                        .find((n) => n.nannyId === fillSelectedNanny)
                        ?.nannyName.split(" ")[0]
                    }{" "}
                    to start?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {getStartWeekOptionsFill().map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setFillStartWeek(opt.value);
                          if (opt.value !== "custom") setFillCustomDate("");
                        }}
                        className={`px-3 py-2.5 text-sm rounded-lg border transition-colors text-left ${
                          fillStartWeek === opt.value
                            ? "border-violet-500 bg-violet-50 text-violet-700 font-medium"
                            : "border-slate-200 text-slate-600 hover:border-violet-300"
                        }`}
                      >
                        <span className="block">{opt.label}</span>
                        {opt.display && (
                          <span className="block text-xs opacity-70">
                            {opt.display}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {fillStartWeek === "custom" && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      <input
                        type="date"
                        value={fillCustomDate}
                        onChange={(e) => setFillCustomDate(e.target.value)}
                        className="flex-1 text-sm border rounded-lg px-3 py-1.5 text-slate-700"
                      />
                    </div>
                  )}
                  {fillError && (
                    <p className="text-sm text-red-600">{fillError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setFillSelectedNanny(null);
                        setFillStartWeek(null);
                        setFillCustomDate("");
                      }}
                      disabled={fillingNannyId !== null}
                    >
                      Back
                    </Button>
                    <Button
                      className="flex-1 bg-violet-600 hover:bg-violet-700"
                      disabled={
                        !fillStartWeek ||
                        (fillStartWeek === "custom" && !fillCustomDate) ||
                        fillingNannyId !== null
                      }
                      onClick={() => {
                        const startVal =
                          fillStartWeek === "custom"
                            ? fillCustomDate
                            : (fillStartWeek ?? undefined);
                        handleFillPosition(fillSelectedNanny!, startVal);
                      }}
                    >
                      {fillingNannyId ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : null}
                      Confirm
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">
                    Select the nanny you&apos;ve decided to hire.
                  </p>
                  {fillError && (
                    <p className="text-sm text-red-600">{fillError}</p>
                  )}
                  <div className="space-y-2">
                    {confirmedNannies.map((nanny) => (
                      <button
                        key={nanny.nannyId}
                        onClick={() => setFillSelectedNanny(nanny.nannyId)}
                        disabled={fillingNannyId !== null}
                        className="w-full text-left rounded-lg border border-slate-200 bg-white p-4 hover:bg-violet-50 hover:border-violet-300 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {nanny.nannyPhoto ? (
                              <img
                                src={nanny.nannyPhoto}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                                <span className="text-sm font-semibold text-violet-600">
                                  {nanny.nannyName.charAt(0)}
                                </span>
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {nanny.nannyName}
                              </p>
                              {nanny.nannySuburb && (
                                <p className="text-xs text-slate-500">
                                  {nanny.nannySuburb}
                                </p>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="border-t pt-3 mt-3 space-y-2">
                    <p className="text-xs text-slate-400">
                      Or close this position:
                    </p>
                    <button
                      onClick={() => {
                        setShowFillModal(false);
                        setCloseReason("found_elsewhere");
                      }}
                      className="w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 hover:text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <Search className="h-4 w-4" />I found a nanny elsewhere
                    </button>
                    <button
                      onClick={() => {
                        setShowFillModal(false);
                        setCloseReason("no_longer_needed");
                      }}
                      className="w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 hover:text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <XCircle className="h-4 w-4" />I no longer need a nanny
                    </button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

// ── BSR Tile (compact inline version for hub) ──

function BsrTileInline({
  request,
  onClick,
  locked,
  onLockedClick,
}: {
  request: BabysittingRequestWithSlots;
  onClick: () => void;
  locked?: boolean;
  onLockedClick?: () => void;
}) {
  const isOpen = request.status === "open";
  const isFilled = request.status === "filled";
  const isPast = [
    "expired",
    "cancelled",
    "nanny_cancelled",
    "completed",
  ].includes(request.status);
  const borderColor = isOpen
    ? "border-amber-200"
    : isFilled
      ? "border-green-200"
      : "border-slate-200";

  const statusConfig: Record<string, { label: string; style: string }> = {
    completed: { label: "Completed", style: "bg-green-100 text-green-700" },
    expired: { label: "Expired", style: "bg-amber-100 text-amber-800" },
    cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-600" },
    nanny_cancelled: {
      label: "Nanny Cancelled",
      style: "bg-red-100 text-red-700",
    },
  };

  const firstSlot = request.slots?.[0];

  return (
    <button
      onClick={locked ? onLockedClick : onClick}
      className={`relative w-full text-left rounded-lg border ${borderColor} bg-white p-3 hover:bg-slate-50 transition-colors cursor-pointer ${isPast ? "opacity-75" : ""}`}
    >
      {locked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 shadow-sm">
            <Lock className="h-4 w-4 text-slate-400" />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            {isFilled && request.acceptedNanny ? (
              <div className="flex items-center gap-2">
                {request.acceptedNanny.profilePicUrl ? (
                  <img
                    src={request.acceptedNanny.profilePicUrl}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100">
                    <span className="text-xs font-semibold text-green-600">
                      {request.acceptedNanny.firstName[0]}
                    </span>
                  </div>
                )}
                <p className="text-sm font-medium text-slate-900">
                  {request.acceptedNanny.firstName}
                  {calcAge(request.acceptedNanny.dateOfBirth) !== null
                    ? `, ${calcAge(request.acceptedNanny.dateOfBirth)}`
                    : ""}
                </p>
              </div>
            ) : (
              firstSlot && (
                <p className="text-sm font-medium text-slate-900">
                  {bsrFormatSlotDate(firstSlot.slot_date)}
                  {request.slots.length > 1 && (
                    <span className="text-slate-400">
                      {" "}
                      +{request.slots.length - 1} more
                    </span>
                  )}
                </p>
              )
            )}
          </div>
          {firstSlot && (
            <p className="text-xs text-slate-500">
              {isFilled && bsrFormatSlotDate(firstSlot.slot_date)}
              {isFilled && " · "}
              {bsrFormatTime(firstSlot.start_time)} –{" "}
              {bsrFormatTime(firstSlot.end_time)}
              {request.suburb && <span> · {request.suburb}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOpen && request.requestingNannies.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              <User className="h-3 w-3" />
              {request.requestingNannies.length}
            </span>
          )}
          {isFilled && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <CheckCircle className="h-3 w-3" />
              Confirmed
            </span>
          )}
          {isPast && statusConfig[request.status] && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig[request.status].style}`}
            >
              {statusConfig[request.status].label}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}
