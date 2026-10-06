"use client";

import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

type BadgeVariant = "pending" | "processing" | "verified" | "failed" | "review" | "rejected" | "saved";

const BADGE_CONFIG: Record<BadgeVariant, { icon: React.ReactNode; label: string; className: string }> = {
  pending: {
    icon: <Clock className="h-4 w-4" />,
    label: "Pending",
    className: "bg-slate-100 text-slate-600",
  },
  processing: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    label: "Verifying...",
    className: "bg-violet-100 text-violet-700",
  },
  verified: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    label: "Verified",
    className: "bg-green-100 text-green-700",
  },
  failed: {
    icon: <XCircle className="h-4 w-4" />,
    label: "Action needed",
    className: "bg-red-100 text-red-700",
  },
  review: {
    icon: <AlertTriangle className="h-4 w-4" />,
    label: "Under review",
    className: "bg-amber-100 text-amber-700",
  },
  rejected: {
    icon: <XCircle className="h-4 w-4" />,
    label: "Rejected",
    className: "bg-red-100 text-red-700",
  },
  saved: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    label: "Verified",
    className: "bg-green-100 text-green-700",
  },
};

export function SectionStatusBadge({
  status,
  customLabel,
}: {
  status: BadgeVariant;
  customLabel?: string;
}) {
  const config = BADGE_CONFIG[status] ?? BADGE_CONFIG.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${config.className}`}>
      {config.icon}
      {customLabel ?? config.label}
    </span>
  );
}
