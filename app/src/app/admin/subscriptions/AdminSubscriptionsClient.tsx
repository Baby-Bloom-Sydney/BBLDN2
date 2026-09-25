"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, AlertCircle, Heart } from "lucide-react";
import { formatAuDate } from "@/lib/format/date";
import type { AdminSubscriptionRow } from "./types";

type Filter =
  | "all"
  | "needs_attention"
  | "active"
  | "trial"
  | "cancelled_lapsed";

interface Props {
  rows: AdminSubscriptionRow[];
  needsAttentionCount: number;
}

export function AdminSubscriptionsClient({ rows, needsAttentionCount }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (r: AdminSubscriptionRow): boolean => {
      if (!q) return true;
      const haystack = `${r.fullName} ${r.email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    };
    return rows
      .filter(matches)
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "needs_attention") return isNeedsAttention(r);
        if (filter === "active") {
          return r.status === "active_monthly" || r.status === "active_upfront";
        }
        if (filter === "trial") return r.status === "trial";
        if (filter === "cancelled_lapsed") {
          return r.status === "cancelled" || r.status === "lapsed";
        }
        return true;
      })
      .sort(sortByPriorityDesc);
  }, [rows, filter, query]);

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <FilterTab
          label="All"
          count={rows.length}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterTab
          label="Needs attention"
          count={needsAttentionCount}
          active={filter === "needs_attention"}
          onClick={() => setFilter("needs_attention")}
          tone="warn"
        />
        <FilterTab
          label="Active"
          count={rows.filter((r) => r.status.startsWith("active")).length}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <FilterTab
          label="Trial"
          count={rows.filter((r) => r.status === "trial").length}
          active={filter === "trial"}
          onClick={() => setFilter("trial")}
        />
        <FilterTab
          label="Cancelled / lapsed"
          count={
            rows.filter(
              (r) => r.status === "cancelled" || r.status === "lapsed",
            ).length
          }
          active={filter === "cancelled_lapsed"}
          onClick={() => setFilter("cancelled_lapsed")}
        />
        <div className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-md border border-slate-200 bg-white px-3">
          <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">No matching rows.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Parent</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Tenure</th>
                  <th className="px-4 py-2 text-right">Spent</th>
                  <th className="px-4 py-2">Next event</th>
                  <th className="px-4 py-2">Signals</th>
                  <th className="px-4 py-2 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => (
                  <Row key={row.parentUserId} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ row }: { row: AdminSubscriptionRow }) {
  const attention = isNeedsAttention(row);
  return (
    <tr
      className={
        attention ? "bg-amber-50/40 hover:bg-amber-50/70" : "hover:bg-slate-50"
      }
    >
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900">
          {row.fullName || row.email || row.parentUserId.slice(0, 8)}
        </p>
        {row.email && (
          <p className="truncate text-xs text-slate-500">{row.email}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={row.status} />
      </td>
      <td className="px-4 py-3 capitalize text-slate-700">{row.plan}</td>
      <td className="px-4 py-3">
        {row.tenureDays !== null ? (
          <div>
            <p className="font-medium text-slate-900">
              {row.tenureDays} day{row.tenureDays === 1 ? "" : "s"}
            </p>
            {row.subscriberSinceIso && (
              <p className="text-xs text-slate-500">
                since {formatAuDate(row.subscriberSinceIso)}
              </p>
            )}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <p className="font-medium text-slate-900">
          £{row.cumulativeSpendAud.toLocaleString("en-AU")}
        </p>
        {row.cycle > 1 && (
          <p className="text-xs text-slate-500">cycle {row.cycle}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {row.nextEventLabel}
        </p>
        {row.nextEventIso ? (
          <p className="text-sm text-slate-900">
            {formatAuDate(row.nextEventIso)}
          </p>
        ) : (
          <p className="text-sm text-slate-400">—</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {row.failedPayments > 0 && (
            <Chip
              icon={<AlertCircle className="h-3 w-3" aria-hidden="true" />}
              label={`${row.failedPayments} failed`}
              tone="warn"
            />
          )}
          {!row.hasNanny && <Chip label="No nanny" tone="muted" />}
          {row.cancellationReason && (
            <Chip
              icon={<Heart className="h-3 w-3" aria-hidden="true" />}
              label={row.cancellationReason.replace(/_/g, " ")}
              tone="muted"
            />
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/admin/users/${row.parentUserId}/subscription`}
          className="text-sm font-medium text-violet-700 hover:underline"
        >
          Detail →
        </Link>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: AdminSubscriptionRow["status"] }) {
  const map: Record<
    AdminSubscriptionRow["status"],
    { label: string; className: string }
  > = {
    active_monthly: {
      label: "Active",
      className: "bg-emerald-100 text-emerald-800",
    },
    active_upfront: {
      label: "Active",
      className: "bg-emerald-100 text-emerald-800",
    },
    trial: { label: "Trial", className: "bg-violet-100 text-violet-800" },
    past_due: {
      label: "Past due",
      className: "bg-amber-100 text-amber-800",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-slate-100 text-slate-700",
    },
    lapsed: { label: "Lapsed", className: "bg-slate-100 text-slate-500" },
  };
  const { label, className } = map[status];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "warn";
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors";
  const activeClass =
    tone === "warn" ? "bg-amber-600 text-white" : "bg-violet-600 text-white";
  const inactiveClass =
    tone === "warn"
      ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
      : "border border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeClass : inactiveClass}`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
          active ? "bg-white/20" : "bg-slate-100 text-slate-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  tone: "warn" | "muted";
}) {
  const className =
    tone === "warn"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}

function isNeedsAttention(row: AdminSubscriptionRow): boolean {
  if (row.status === "past_due") return true;
  if (row.failedPayments > 0 && row.status !== "active_monthly") return true;
  if (
    row.status === "trial" &&
    row.nextEventIso &&
    new Date(row.nextEventIso).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
  ) {
    return true;
  }
  return false;
}

// Priority sort: past_due → trial ending soon → trial → active → cancelled → lapsed.
function sortByPriorityDesc(
  a: AdminSubscriptionRow,
  b: AdminSubscriptionRow,
): number {
  const priority = (r: AdminSubscriptionRow): number => {
    if (r.status === "past_due") return 0;
    if (
      r.status === "trial" &&
      r.nextEventIso &&
      new Date(r.nextEventIso).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
    ) {
      return 1;
    }
    if (r.status === "trial") return 2;
    if (r.status === "active_monthly" || r.status === "active_upfront") {
      return 3;
    }
    if (r.status === "cancelled") return 4;
    return 5;
  };
  const pa = priority(a);
  const pb = priority(b);
  if (pa !== pb) return pa - pb;
  return b.updatedAtIso.localeCompare(a.updatedAtIso);
}
