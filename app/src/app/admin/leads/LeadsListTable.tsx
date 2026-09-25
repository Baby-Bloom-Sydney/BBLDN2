"use client";

// T-032 — Compact single-line desktop list table.
//
// Each row is one line: avatar+name+phone · status · verification ·
// children · last contact · suburb · row-action buttons (Logs / Log).
// Click row → opens the full drawer. Click action buttons → opens a
// modal popup (preventDefault stops the row-click).
//
// Older fields (responded badge, level label, next-action date) moved
// into the drawer to keep the row scannable.

import { useState } from "react";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Users, Phone, History, MessageCirclePlus } from "lucide-react";
import type { LeadRow } from "@/lib/leads/types";
import { formatLeadDateTime } from "@/lib/leads/format";
import { LeadStatusPill } from "./LeadStatusPill";
import { VerificationMiniChip } from "./VerificationMiniChip";
import { LeadRecentLogsModal } from "./LeadRecentLogsModal";
import { LeadQuickLogModal } from "./LeadQuickLogModal";

interface LeadsListTableProps {
  rows: LeadRow[];
  onRowClick: (nannyUserId: string) => void;
  openLeadId: string | null;
  isPending?: boolean;
}

function fullName(row: LeadRow): string {
  const f = row.first_name ?? "";
  const l = row.last_name ?? "";
  const full = `${f} ${l}`.trim();
  return full.length > 0 ? full : (row.email ?? row.nanny_user_id.slice(0, 8));
}

type ModalState =
  | { kind: "none" }
  | { kind: "logs"; nannyUserId: string; nannyName: string }
  | { kind: "addlog"; nannyUserId: string; nannyName: string };

export function LeadsListTable({
  rows,
  onRowClick,
  openLeadId,
  isPending,
}: LeadsListTableProps) {
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8">
        <EmptyState
          icon={Users}
          title="No nannies match these filters"
          description="Try clearing filters or switching to the All tab."
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Nanny</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Verified</th>
            <th
              className="px-3 py-2 font-medium text-center"
              title="Children on the nanny's account / how many are linked to a Baby Bloom parent"
            >
              Kids
            </th>
            <th className="px-3 py-2 font-medium">Last contact</th>
            <th className="px-3 py-2 font-medium text-center">#</th>
            <th className="px-3 py-2 font-medium">Area</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody
          className={`divide-y divide-slate-100 ${isPending ? "opacity-50" : ""}`}
        >
          {rows.map((row) => {
            const isOpen = openLeadId === row.nanny_user_id;
            const status = row.contact_state?.lead_status ?? "untouched";
            const name = fullName(row);
            return (
              <tr
                key={row.nanny_user_id}
                onClick={() => onRowClick(row.nanny_user_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row.nanny_user_id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Open ${name}`}
                aria-current={isOpen ? "true" : undefined}
                className={`cursor-pointer transition hover:bg-slate-50 focus:bg-violet-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset ${isOpen ? "bg-violet-50/40" : ""}`}
              >
                {/* Nanny: avatar + name + phone inline */}
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <UserAvatar
                      name={name}
                      imageUrl={row.profile_picture_url ?? undefined}
                      className="h-7 w-7 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">
                        {name}
                      </div>
                      {row.mobile_number && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Phone className="h-2.5 w-2.5" />
                          <a
                            href={`tel:${row.mobile_number}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-violet-700"
                          >
                            {row.mobile_number}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Status */}
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LeadStatusPill status={status} />
                </td>

                {/* Verification chip */}
                <td className="whitespace-nowrap px-3 py-1.5">
                  <VerificationMiniChip verification={row.verification} />
                </td>

                {/* Kids: total / linked (with bonus star) */}
                <td className="whitespace-nowrap px-3 py-1.5 text-center text-sm">
                  <span className="text-slate-900">
                    {row.children_linked_count}
                  </span>
                  <span className="text-slate-400"> / </span>
                  <span className="text-slate-700">
                    {row.parent_linked_children_count}
                  </span>
                  {row.bonus_children_count > 0 && (
                    <span
                      className="ml-1 text-[10px] font-medium text-violet-600"
                      title="Linked via bonus program"
                    >
                      ★{row.bonus_children_count}
                    </span>
                  )}
                </td>

                {/* Last contact */}
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-600"
                  title={row.contact_state?.last_contact_at ?? "Never"}
                >
                  {row.contact_state?.last_contact_at ? (
                    formatLeadDateTime(row.contact_state.last_contact_at)
                  ) : (
                    <em className="text-slate-400">Never</em>
                  )}
                </td>

                {/* Total contacts count */}
                <td className="whitespace-nowrap px-3 py-1.5 text-center text-sm text-slate-600">
                  {row.total_contacts_derived}
                </td>

                {/* Suburb */}
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-600">
                  {row.suburb ?? "—"}
                </td>

                {/* Row actions */}
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({
                          kind: "logs",
                          nannyUserId: row.nanny_user_id,
                          nannyName: name,
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                      aria-label={`Recent logs for ${name}`}
                      title="Recent contact logs"
                    >
                      <History className="h-3 w-3" />
                      Logs
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({
                          kind: "addlog",
                          nannyUserId: row.nanny_user_id,
                          nannyName: name,
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-violet-700"
                      aria-label={`Log contact with ${name}`}
                      title="Log new contact"
                    >
                      <MessageCirclePlus className="h-3 w-3" />
                      Log
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Modals */}
      {modal.kind === "logs" && (
        <LeadRecentLogsModal
          open
          onOpenChange={(open) => !open && setModal({ kind: "none" })}
          nannyUserId={modal.nannyUserId}
          nannyName={modal.nannyName}
          onOpenDrawer={() => onRowClick(modal.nannyUserId)}
        />
      )}
      {modal.kind === "addlog" && (
        <LeadQuickLogModal
          open
          onOpenChange={(open) => !open && setModal({ kind: "none" })}
          nannyUserId={modal.nannyUserId}
          nannyName={modal.nannyName}
        />
      )}
    </div>
  );
}
