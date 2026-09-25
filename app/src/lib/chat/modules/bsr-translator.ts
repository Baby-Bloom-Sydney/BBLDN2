/**
 * BSR translator — plain-English mappers for babysitting request state.
 *
 * Hard rules (from system/APP/BLOOMBOT/modules/bsr/katie-scope.md):
 *   1. Never expose raw `status` values, internal timestamps, or
 *      field names. Always translate before Katie speaks.
 *   2. Expiry is always pre-rendered (e.g. "4h 12m left"). Don't let
 *      Katie re-do the math.
 *   3. Distance: values < 1km render as the string "<1". Numbers
 *      rendered to one decimal place.
 *   4. Time slots render in London-local 24h format ("Sat 3 May —
 *      18:00 to 22:00").
 */

import { APP_TZ } from "@/lib/constants";
import { formatClockTime } from "@/lib/timezone";

/**
 * Categorise a nanny's notification into the plain-English bucket
 * Katie uses when reading back the inbox.
 */
export function nannyJobBucket(
  notification: {
    requestedAt: string | null;
    acceptedAt: string | null;
    declinedAt: string | null;
    notifiedFilled: boolean;
  },
  jobStatus: string,
): "available" | "requested" | "accepted" | "past" {
  if (notification.acceptedAt) return "accepted";
  if (
    notification.declinedAt ||
    notification.notifiedFilled ||
    jobStatus === "expired" ||
    jobStatus === "cancelled" ||
    jobStatus === "completed" ||
    jobStatus === "nanny_cancelled"
  ) {
    return "past";
  }
  if (notification.requestedAt) return "requested";
  return "available";
}

/**
 * Parent-side bucket for their own requests.
 */
export function parentRequestBucket(
  status: string,
): "pending_payment" | "awaiting_requesters" | "booked" | "past" {
  if (status === "pending_payment") return "pending_payment";
  if (status === "accepted" || status === "confirmed") return "booked";
  if (
    status === "expired" ||
    status === "cancelled" ||
    status === "completed" ||
    status === "nanny_cancelled"
  ) {
    return "past";
  }
  // "active", "awaiting_parent_choice" etc. fall through to awaiting_requesters
  return "awaiting_requesters";
}

/**
 * Plain-English headline per bucket. Different text for nanny vs
 * parent; same bucket name, different audience.
 */
export function bucketHeadline(
  bucket: string,
  role: "nanny" | "parent",
): string {
  if (role === "nanny") {
    switch (bucket) {
      case "available":
        return "Available — you can still request this job.";
      case "requested":
        return "Request sent — the family is deciding.";
      case "accepted":
        return "Booked — you got the job.";
      case "past":
        return "Closed — no longer available.";
      default:
        return "";
    }
  }
  switch (bucket) {
    case "pending_payment":
      return "Waiting for payment to go through.";
    case "awaiting_requesters":
      return "Live — waiting for nannies to request.";
    case "booked":
      return "Booked — a nanny has been selected.";
    case "past":
      return "Closed.";
    default:
      return "";
  }
}

/**
 * Format a time-left string from an ISO expiry timestamp. Returns null
 * when the input is null, "Expired" when past.
 */
export function expiryText(expiresAt: string | null | undefined): {
  text: string | null;
  urgent: boolean;
} {
  if (!expiresAt) return { text: null, urgent: false };
  const now = Date.now();
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return { text: null, urgent: false };
  const diff = t - now;
  if (diff <= 0) return { text: "Expired", urgent: false };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const hoursAfter = hours - days * 24;
  const minutes = Math.floor((diff - hours * 60 * 60 * 1000) / (1000 * 60));
  // "Urgent" is <6h remaining.
  const urgent = diff <= 6 * 60 * 60 * 1000;
  if (days > 0) {
    return {
      text: hoursAfter > 0 ? `${days}d ${hoursAfter}h left` : `${days}d left`,
      urgent,
    };
  }
  if (hours > 0) {
    return {
      text: minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`,
      urgent,
    };
  }
  return { text: `${Math.max(1, minutes)}m left`, urgent: true };
}

export function distanceText(km: number | null): string {
  if (km == null || !Number.isFinite(km)) return "distance unknown";
  if (km < 1) return "<1 km";
  return `${km.toFixed(1)} km`;
}

/**
 * Format a babysitting time slot in London-local prose.
 * e.g. "Sat 3 May — 18:00 to 22:00".
 */
export function formatSlot(slot: {
  slot_date: string;
  start_time: string;
  end_time: string;
}): string {
  const d = new Date(slot.slot_date + "T00:00:00");
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: APP_TZ,
  });
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: APP_TZ,
  });
  const start = formatClockTime(slot.start_time);
  const end = formatClockTime(slot.end_time);
  return `${day} ${date} — ${start} to ${end}`;
}

/**
 * Bundle child ages + genders into a short human-readable summary.
 * e.g. "2 children (14 months, 3 years)".
 */
export function childrenSummary(
  children: Array<{ age_months: number; gender: string | null }>,
): string {
  if (children.length === 0) return "No child details";
  const parts = children.map((c) => {
    if (c.age_months < 12) {
      return `${c.age_months} month${c.age_months === 1 ? "" : "s"}`;
    }
    const years = Math.floor(c.age_months / 12);
    return `${years} year${years === 1 ? "" : "s"}`;
  });
  const noun =
    children.length === 1 ? "1 child" : `${children.length} children`;
  return `${noun} (${parts.join(", ")})`;
}

/**
 * Ban narration — "suspended until 12 July 2026" or null when not banned.
 * Never says "bsr_banned_until" or "3-strike".
 */
export function banText(banUntil: string | null): string | null {
  if (!banUntil) return null;
  const d = new Date(banUntil);
  if (!Number.isFinite(d.getTime())) return null;
  const until = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: APP_TZ,
  });
  return `You're currently not receiving babysitting job invitations until ${until}. This comes from the 3-cancellation rule — if you need more context you can contact support.`;
}
