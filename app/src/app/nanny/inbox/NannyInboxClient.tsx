"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ConnectionRequestWithDetails,
} from "@/lib/actions/connection";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { InboxMessage, markAsRead, markAllAsRead } from "@/lib/actions/inbox";
import { formatLondonDate } from "@/lib/timezone";
import {
  Bell,
  Loader2,
  Check,
  X,
  AlertTriangle,
  ChevronRight,
  UserCheck,
} from "lucide-react";

// ── Helpers ──

const SKIP_INTRO_WAIT = process.env.NEXT_PUBLIC_SKIP_INTRO_WAIT === 'true';

function isIntroPast(request: ConnectionRequestWithDetails): boolean {
  if (!request.confirmed_time) return false;
  if (SKIP_INTRO_WAIT) return true;
  return new Date(request.confirmed_time).getTime() < Date.now();
}

function isPostIntro(request: ConnectionRequestWithDetails): boolean {
  const stage = request.connection_stage;
  if (stage == null) return false;
  return ([
    CONNECTION_STAGE.INTRO_COMPLETE,
    CONNECTION_STAGE.INTRO_INCOMPLETE,
    CONNECTION_STAGE.AWAITING_RESPONSE,
    CONNECTION_STAGE.TRIAL_ARRANGED,
    CONNECTION_STAGE.TRIAL_COMPLETE,
    CONNECTION_STAGE.OFFERED,
    CONNECTION_STAGE.CONFIRMED,
    CONNECTION_STAGE.ACTIVE,
  ] as number[]).includes(stage);
}

// ── Notification Item ──

function NotificationItem({
  message,
  onMarkRead,
}: {
  message: InboxMessage;
  onMarkRead: (id: string) => void;
}) {
  const getIcon = () => {
    switch (message.type) {
      case "connection_confirmed_nanny":
      case "connection_confirmed":
        return <Check className="h-4 w-4 text-green-600" />;
      case "connection_accepted_nanny":
      case "connection_accepted":
        return <UserCheck className="h-4 w-4 text-blue-600" />;
      case "connection_expired":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "connection_cancelled":
        return <X className="h-4 w-4 text-slate-500" />;
      default:
        return <Bell className="h-4 w-4 text-violet-500" />;
    }
  };

  return (
    <div
      onClick={() => !message.is_read && onMarkRead(message.id)}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        message.is_read
          ? "border-slate-100 bg-white"
          : "border-violet-200 bg-violet-50"
      }`}
    >
      <div className="mt-0.5 flex-shrink-0">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm ${
            message.is_read ? "text-slate-600" : "font-medium text-slate-900"
          }`}
        >
          {message.title}
        </p>
        {message.body && (
          <p className="mt-0.5 text-sm text-slate-500 line-clamp-2">
            {message.body}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {formatLondonDate(message.created_at)}
        </p>
      </div>
      {!message.is_read && (
        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-violet-500" />
      )}
    </div>
  );
}

// ── Past Connection Card ──

function PastConnectionCard({
  request,
}: {
  request: ConnectionRequestWithDetails;
}) {
  const statusConfig: Record<string, { label: string; style: string }> = {
    confirmed: { label: "Confirmed", style: "bg-green-100 text-green-800" },
    declined: { label: "Declined", style: "bg-red-100 text-red-800" },
    cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-600" },
    expired: { label: "Expired", style: "bg-amber-100 text-amber-800" },
  };
  const config = statusConfig[request.status] || {
    label: request.status,
    style: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="rounded-lg border border-slate-100 bg-white opacity-75">
      <div className="flex items-center justify-between py-4 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
            <span className="text-xs font-medium text-slate-500">
              {request.parent?.first_name?.[0]}
              {request.parent?.last_name?.[0]}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">
              {request.parent?.first_name} {request.parent?.last_name?.[0]}.
            </p>
            <p className="text-xs text-slate-400">
              {formatLondonDate(request.created_at)}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${config.style}`}
        >
          {config.label}
        </span>
      </div>
    </div>
  );
}

// ── Main Client Component ──

interface NannyInboxClientProps {
  pendingRequests: ConnectionRequestWithDetails[];
  notifications: InboxMessage[];
  pastConnections: ConnectionRequestWithDetails[];
}

export function NannyInboxClient({
  pendingRequests,
  notifications,
  pastConnections,
}: NannyInboxClientProps) {
  const router = useRouter();
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Check for post-intro connections that need attention in My Positions
  const allConfirmedOrCompleted = pendingRequests.filter(
    (r) => r.status === "confirmed" || r.status === "completed"
  );
  const postIntroConnections = allConfirmedOrCompleted.filter(
    (r) => isPostIntro(r) || (r.status === "confirmed" && isIntroPast(r))
  );

  // Also count pending requests that need attention in My Positions
  const pendingInMyPositions = pendingRequests.filter(
    (r) => r.status === "pending" || r.status === "accepted"
  );
  const needsAttentionCount = postIntroConnections.length + pendingInMyPositions.length;

  const handleMarkRead = async (id: string) => {
    await markAsRead(id);
    router.refresh();
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    await markAllAsRead();
    setMarkingAllRead(false);
    router.refresh();
  };

  return (
    <div className="space-y-8">
      {/* Banner: connections in My Positions */}
      {needsAttentionCount > 0 && (
        <a
          href="/nanny/positions"
          className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 hover:bg-violet-100 transition-colors"
        >
          <p className="text-sm font-medium text-violet-800">
            {needsAttentionCount} connection{needsAttentionCount > 1 ? "s" : ""} need{needsAttentionCount === 1 ? "s" : ""} your attention
          </p>
          <span className="flex items-center gap-1 text-sm font-medium text-violet-600">
            Go to My Positions
            <ChevronRight className="h-4 w-4" />
          </span>
        </a>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                disabled={markingAllRead}
              >
                {markingAllRead ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Mark all read
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {notifications.map((msg) => (
              <NotificationItem
                key={msg.id}
                message={msg}
                onMarkRead={handleMarkRead}
              />
            ))}
          </div>
        </section>
      )}

      {/* Past Connections */}
      {pastConnections.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-700">
            Past Intros
          </h2>
          <div className="grid gap-2">
            {pastConnections.map((req) => (
              <PastConnectionCard key={req.id} request={req} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {notifications.length === 0 && pastConnections.length === 0 && needsAttentionCount === 0 && (
        <div className="text-center py-12">
          <Bell className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No notifications yet</p>
        </div>
      )}
    </div>
  );
}
