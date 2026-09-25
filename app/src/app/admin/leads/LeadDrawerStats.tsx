"use client";

// T-032 — Quick-stats strip in drawer header (8 mini stats).
// Total-contacts + responded are editable inline (offset + override flags).

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { overrideResponded, updateContactsOffset } from "./actions";

interface LeadDrawerStatsProps {
  detail: LeadDetail;
  onLocalPatch: (next: LeadDetail) => void;
}

import { formatLeadDateTime, formatLeadDate } from "@/lib/leads/format";

interface StatProps {
  label: string;
  value: React.ReactNode;
  edit?: React.ReactNode;
}

function Stat({ label, value, edit }: StatProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {edit}
      </div>
      <div className="mt-0.5 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

export function LeadDrawerStats({
  detail,
  onLocalPatch,
}: LeadDrawerStatsProps) {
  const cs = detail.contact_state;
  const totalContactsDerived =
    detail.contacts.length + (cs?.total_contacts_manual_offset ?? 0);
  const inboundExists = detail.contacts.some((c) => c.direction === "inbound");
  const respondedDerived = cs?.responded_ever_override ?? inboundExists;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <Stat
        label="Signed up"
        value={formatLeadDateTime(detail.nanny?.created_at)}
      />
      <Stat
        label="Level"
        value={`Lv ${detail.nanny?.verification_level ?? 0}`}
      />
      <Stat
        label="Children"
        value={(() => {
          const total = detail.children_linked.length;
          const linked = detail.children_linked.filter(
            (c) => c.parent_connected,
          ).length;
          if (total === 0) return 0;
          return `${total}${linked < total ? ` (${linked} linked)` : ""}`;
        })()}
      />
      <Stat
        label="Contributions"
        value={(() => {
          const tsSet =
            detail.nanny?.bonus_program_completed_at !== null &&
            detail.nanny?.bonus_program_completed_at !== undefined;
          const bonusInviteCount = detail.children_linked.filter(
            (c) => c.bonus_program,
          ).length;
          const complete = tsSet || bonusInviteCount > 0;
          return (
            <span
              className={complete ? "text-green-700" : "text-slate-500"}
              title={
                tsSet
                  ? `bonus_program_completed_at: ${detail.nanny?.bonus_program_completed_at}`
                  : bonusInviteCount > 0
                    ? `${bonusInviteCount} bonus invite(s) found (timestamp not set)`
                    : "No bonus contributions detected"
              }
            >
              {complete ? "Complete" : "Incomplete"}
            </span>
          );
        })()}
      />
      <Stat
        label="Contacts"
        value={totalContactsDerived}
        edit={<EditOffset detail={detail} onLocalPatch={onLocalPatch} />}
      />
      <Stat
        label="Responded"
        value={
          respondedDerived ? (
            <span className="text-teal-700">Yes</span>
          ) : (
            <span className="text-slate-500">No</span>
          )
        }
        edit={<OverrideResponded detail={detail} onLocalPatch={onLocalPatch} />}
      />
      <Stat
        label="Last contact"
        value={formatLeadDateTime(cs?.last_contact_at)}
      />
      <Stat label="Next action" value={formatLeadDate(cs?.next_action_at)} />
    </div>
  );
}

function EditOffset({
  detail,
  onLocalPatch,
}: {
  detail: LeadDetail;
  onLocalPatch: (n: LeadDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(
    String(detail.contact_state?.total_contacts_manual_offset ?? 0),
  );
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return;
    startTransition(async () => {
      const result = await updateContactsOffset({
        nanny_user_id: detail.nanny_user_id,
        offset: n,
      });
      if (result.success) {
        onLocalPatch({
          ...detail,
          contact_state: detail.contact_state
            ? { ...detail.contact_state, total_contacts_manual_offset: n }
            : null,
        });
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          aria-label="Edit total contacts offset"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit total-contacts offset</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Add manual offset for contacts logged before this page existed.
          Auto-counted log entries are added on top.
        </p>
        <Input
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverrideResponded({
  detail,
  onLocalPatch,
}: {
  detail: LeadDetail;
  onLocalPatch: (n: LeadDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = detail.contact_state?.responded_ever_override ?? null;
  const [isPending, startTransition] = useTransition();

  const choose = (value: boolean | null) => {
    startTransition(async () => {
      const result = await overrideResponded({
        nanny_user_id: detail.nanny_user_id,
        value,
      });
      if (result.success) {
        onLocalPatch({
          ...detail,
          contact_state: detail.contact_state
            ? { ...detail.contact_state, responded_ever_override: value }
            : null,
        });
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          aria-label="Override responded value"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override responded value</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Derived from inbound log entries. Override if the system value is
          wrong.
        </p>
        <div className="flex gap-2">
          <Button
            variant={current === null ? "default" : "outline"}
            disabled={isPending}
            onClick={() => choose(null)}
          >
            Use derived
          </Button>
          <Button
            variant={current === true ? "default" : "outline"}
            disabled={isPending}
            onClick={() => choose(true)}
          >
            Yes
          </Button>
          <Button
            variant={current === false ? "default" : "outline"}
            disabled={isPending}
            onClick={() => choose(false)}
          >
            No
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
