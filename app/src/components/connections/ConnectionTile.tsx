"use client";

/**
 * Shared ConnectionTile — rendered on the connections list page AND
 * inline in Katie's chat deck.
 *
 * The architectural commitment (TileRegistry.tsx leading comment): for
 * INTERACTIVE tiles, both surfaces import the EXACT SAME component so
 * the chat view never drifts visually from the main page. This file is
 * the source of truth for that visual.
 *
 * Visual ported from the original `ConnectionTile` inlined inside
 * ParentConnectionsClient.tsx — preserved verbatim except for:
 *   - `viewerRole: "nanny" | "parent"` to read the right side of the
 *     connection (nanny sees parent's profile data, parent sees
 *     nanny's profile data).
 *   - `onClick` is optional — chat-side passes a navigation handler
 *     pointing at the relevant main-deck route; the parent-page side
 *     passes a modal-opener.
 *
 * Carve-out: the "Confirm Placement" cards in `ParentConnectionsClient`
 * (`awaitingConfirmation` section) intentionally render their own
 * layout because they need extra inline elements (legal terms blurb,
 * two action buttons). They are not expected to converge with this
 * component.
 *
 * Both call sites pass the same `ConnectionRequestWithDetails` shape
 * (returned by getNannyConnectionRequests / getParentConnectionRequests
 * server actions and exposed via /api/chat/connections/[id] for
 * Katie). No translation layer.
 */

import { Clock, Calendar, ChevronRight, PhoneCall } from "lucide-react";
import type { ConnectionRequestWithDetails } from "@/lib/actions/connection";
import { formatLondonDate } from "@/lib/timezone";

export type ViewerRole = "nanny" | "parent";

function formatTimeLeft(expiresAt: string | null): {
  text: string;
  urgent: boolean;
} {
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

export interface ConnectionTileProps {
  request: ConnectionRequestWithDetails;
  viewerRole: ViewerRole;
  onClick?: () => void;
}

export function ConnectionTile({
  request,
  viewerRole,
  onClick,
}: ConnectionTileProps) {
  // Pick the OTHER party — when viewer is parent, show the nanny;
  // when viewer is nanny, show the parent.
  const counterparty = viewerRole === "parent" ? request.nanny : request.parent;

  const { text: timeLeft, urgent } = formatTimeLeft(request.expires_at);
  const isPending = request.status === "pending";
  const isAccepted = request.status === "accepted";
  const isConfirmed = request.status === "confirmed";
  const isPast = ["declined", "cancelled", "expired"].includes(request.status);

  const borderColor = isPending
    ? "border-amber-200"
    : isAccepted
      ? "border-blue-200"
      : isConfirmed
        ? "border-green-200"
        : "border-slate-200";

  const statusConfig: Record<string, { label: string; style: string }> = {
    declined: { label: "Declined", style: "bg-red-100 text-red-800" },
    cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-600" },
    expired: { label: "Expired", style: "bg-amber-100 text-amber-800" },
  };

  const cpFirst = counterparty?.first_name ?? "";
  const cpLastInitial = counterparty?.last_name?.[0] ?? "";
  const cpPhoto: string | null =
    counterparty &&
    "profile_picture_url" in counterparty &&
    typeof counterparty.profile_picture_url === "string"
      ? counterparty.profile_picture_url
      : null;

  // Render the body once; the wrapper changes between <button> and <div>
  // depending on whether onClick is provided. Branching the wrapper at the
  // top level (rather than a dynamic intrinsic tag) lets us pass
  // `type="button"` on the button branch without a TS-fighting cast.
  const sharedClass = `w-full text-left rounded-lg border ${borderColor} bg-white p-4 transition-colors ${isPast ? "opacity-75" : ""}`;
  const interactiveClass =
    "hover:bg-slate-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2";

  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {cpPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cpPhoto}
            alt=""
            className="h-10 w-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
              isConfirmed
                ? "bg-green-100"
                : isAccepted
                  ? "bg-blue-100"
                  : "bg-violet-100"
            }`}
          >
            <span
              className={`text-sm font-semibold ${
                isConfirmed
                  ? "text-green-600"
                  : isAccepted
                    ? "text-blue-600"
                    : "text-violet-600"
              }`}
            >
              {cpFirst[0] ?? ""}
              {cpLastInitial}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {cpFirst} {cpLastInitial ? `${cpLastInitial}.` : ""}
          </p>
          {isConfirmed && request.confirmed_time && (
            <p className="flex items-center gap-1 text-xs text-green-600">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {formatLondonDate(request.confirmed_time)}
            </p>
          )}
          {isPending && (
            <p className="text-xs text-slate-500">Awaiting response</p>
          )}
          {isAccepted && <p className="text-xs text-blue-600">Pick a time</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isAccepted && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            Pick a Time
          </span>
        )}
        {(isPending || isAccepted) && timeLeft && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              urgent ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {timeLeft}
          </span>
        )}
        {isConfirmed && (
          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            <PhoneCall className="h-3 w-3" aria-hidden="true" />
            Confirmed
          </span>
        )}
        {isPast && statusConfig[request.status] && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              statusConfig[request.status].style
            }`}
          >
            {statusConfig[request.status].label}
          </span>
        )}
        {onClick && (
          <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${sharedClass} ${interactiveClass}`}
      >
        {body}
      </button>
    );
  }

  return <div className={sharedClass}>{body}</div>;
}
