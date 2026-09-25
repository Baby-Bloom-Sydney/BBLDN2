"use client";

// T-032 — Quick "Recent logs" popup launched from the list row's Logs
// button. Fetches the latest contact entries on open; doesn't replace
// the full drawer (the "Open full drawer" footer link offers that).

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchRecentLogs, type RecentLogEntry } from "./actions";
import { formatLeadDateTime } from "@/lib/leads/format";

interface LeadRecentLogsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nannyUserId: string;
  nannyName: string;
  onOpenDrawer: () => void;
}

export function LeadRecentLogsModal({
  open,
  onOpenChange,
  nannyUserId,
  nannyName,
  onOpenDrawer,
}: LeadRecentLogsModalProps) {
  const [logs, setLogs] = useState<RecentLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLogs(null);
    void fetchRecentLogs({ nanny_user_id: nannyUserId, limit: 15 })
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setLogs(result.data.logs);
        } else {
          setError(result.error ?? "Could not load logs.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, nannyUserId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Recent contact logs</DialogTitle>
          <DialogDescription>
            Last 15 entries for {nannyName}.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && error && (
          <p
            role="alert"
            className="rounded bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {!loading && !error && logs && logs.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            No contacts logged yet.
          </p>
        )}

        {!loading && !error && logs && logs.length > 0 && (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {logs.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-slate-200 bg-white p-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                  <span className="font-medium text-slate-900">
                    {formatLeadDateTime(c.contacted_at)}
                  </span>
                  <span className="rounded bg-slate-100 px-1 text-[10px]">
                    {c.method}
                  </span>
                  {c.direction === "outbound" ? (
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                  ) : (
                    <ArrowLeft className="h-3 w-3 text-teal-500" />
                  )}
                  {c.outcome && (
                    <span className="rounded bg-slate-100 px-1 text-[10px]">
                      {c.outcome}
                    </span>
                  )}
                  {c.purpose && (
                    <span className="rounded bg-violet-50 px-1 text-[10px] text-violet-700">
                      {c.purpose}
                    </span>
                  )}
                  <span className="text-slate-400">
                    · by {c.operator_handle}
                  </span>
                </div>
                {c.note && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {c.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onOpenDrawer();
            }}
            className="text-xs font-medium text-violet-700 hover:text-violet-900"
          >
            Open full drawer →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
