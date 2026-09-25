"use client";

import { useState, useTransition } from "react";
import { reviewProposal } from "./actions";

interface Proposal {
  id: string;
  kind: string;
  target: string;
  summary: string;
  details: string | null;
  suggested_diff: string | null;
  status: string;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface Props {
  proposal: Proposal;
}

const KIND_LABEL: Record<string, string> = {
  module_change: "Module",
  schema_change: "Schema",
  prompt_change: "Prompt",
  other: "Other",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  accepted: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
  implemented: "bg-slate-100 text-slate-700 border-slate-200",
};

export function ProposalCard({ proposal }: Props) {
  const [notes, setNotes] = useState(proposal.reviewer_notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isOpen = proposal.status === "open";

  function review(status: "accepted" | "rejected" | "implemented") {
    setMessage(null);
    startTransition(async () => {
      const res = await reviewProposal(proposal.id, status, notes);
      if (res.ok) {
        setMessage(`Marked as ${status}`);
      } else {
        setMessage(`Error: ${res.error}`);
      }
    });
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
              {KIND_LABEL[proposal.kind] ?? proposal.kind}
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                STATUS_COLOR[proposal.status] ?? STATUS_COLOR.open
              }`}
            >
              {proposal.status}
            </span>
            <code className="text-xs text-slate-400">{proposal.target}</code>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            {proposal.summary}
          </h3>
        </div>
        <time
          className="shrink-0 text-xs text-slate-400"
          dateTime={proposal.created_at}
        >
          {new Date(proposal.created_at).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </header>

      {proposal.details && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {proposal.details}
        </p>
      )}

      {proposal.suggested_diff && (
        <pre className="mt-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] leading-snug text-slate-800">
          <code>{proposal.suggested_diff}</code>
        </pre>
      )}

      <div className="mt-4 space-y-2">
        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
          Reviewer notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!isOpen || pending}
          rows={2}
          placeholder={
            isOpen ? "Optional — reason for the decision" : "(read only)"
          }
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>

      {isOpen && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => review("accepted")}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => review("rejected")}
            disabled={pending}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => review("implemented")}
            disabled={pending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Mark implemented
          </button>
        </div>
      )}

      {message && (
        <p className="mt-3 text-xs text-slate-500" role="status">
          {message}
        </p>
      )}
    </article>
  );
}
