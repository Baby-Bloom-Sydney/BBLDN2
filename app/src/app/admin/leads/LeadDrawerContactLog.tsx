"use client";

// T-032 — Chronological contact log with inline outcome / note / purpose edit.

import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import type { ContactOutcome } from "@/lib/leads/types";
import { CONTACT_OUTCOMES } from "@/lib/leads/types";
import { editLogEntry } from "./actions";

interface LeadDrawerContactLogProps {
  detail: LeadDetail;
  onLocalPatch: (next: LeadDetail) => void;
}

import { formatLeadDateTime } from "@/lib/leads/format";

const fmtDate = formatLeadDateTime;

export function LeadDrawerContactLog({
  detail,
  onLocalPatch,
}: LeadDrawerContactLogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (detail.contacts.length === 0) {
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contact log
        </h3>
        <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          No contacts logged yet.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Contact log{" "}
        <span className="font-normal text-slate-400">
          ({detail.contacts.length})
        </span>
      </h3>
      <ul className="space-y-2">
        {detail.contacts.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-slate-200 bg-white p-2 text-sm"
          >
            {editingId === c.id ? (
              <EditLogRow
                contact={c}
                onCancel={() => setEditingId(null)}
                onSaved={(patch) => {
                  onLocalPatch({
                    ...detail,
                    contacts: detail.contacts.map((row) =>
                      row.id === c.id ? { ...row, ...patch } : row,
                    ),
                  });
                  setEditingId(null);
                }}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                  <span className="font-medium text-slate-900">
                    {fmtDate(c.contacted_at)}
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
                  {c.updated_at && c.updated_at !== c.created_at && (
                    <span
                      className="text-[10px] text-slate-400"
                      title={`Edited by ${c.edited_by ?? "—"}`}
                    >
                      (edited)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(c.id)}
                    className="ml-auto rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Edit log entry"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                {c.note && (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {c.note}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface EditLogRowProps {
  contact: LeadDetail["contacts"][number];
  onCancel: () => void;
  onSaved: (patch: {
    outcome: ContactOutcome | null;
    purpose: string | null;
    note: string | null;
  }) => void;
}

function EditLogRow({ contact, onCancel, onSaved }: EditLogRowProps) {
  const [outcome, setOutcome] = useState<ContactOutcome | null>(
    contact.outcome,
  );
  const [purpose, setPurpose] = useState<string>(contact.purpose ?? "");
  const [note, setNote] = useState<string>(contact.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await editLogEntry({
        log_id: contact.id,
        outcome,
        purpose: purpose.trim() || null,
        note: note.trim() || null,
      });
      if (result.success) {
        onSaved({
          outcome,
          purpose: purpose.trim() || null,
          note: note.trim() || null,
        });
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="text-xs">
          <span className="mb-0.5 block text-slate-500">Outcome</span>
          <select
            value={outcome ?? ""}
            onChange={(e) =>
              setOutcome((e.target.value || null) as ContactOutcome | null)
            }
            className="h-8 rounded border border-slate-200 px-2 text-sm"
          >
            <option value="">—</option>
            {CONTACT_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs flex-1 min-w-[140px]">
          <span className="mb-0.5 block text-slate-500">Purpose</span>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        className="block w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm"
        placeholder="Note"
      />
      {error && (
        <p
          role="alert"
          className="rounded bg-red-50 px-2 py-1 text-xs text-red-700"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button size="sm" disabled={isPending} onClick={save}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
