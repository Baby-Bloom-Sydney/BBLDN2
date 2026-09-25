"use client";

// T-032 — Log new contact: outcome chip-row + inline note + purpose dropdown
// + optional next-action date.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import type {
  ContactDirection,
  ContactMethod,
  ContactOutcome,
} from "@/lib/leads/types";
import {
  CONTACT_DIRECTIONS,
  CONTACT_METHODS,
  CONTACT_PURPOSE_DEFAULTS,
} from "@/lib/leads/types";
import { logContact, setNextAction } from "./actions";
import { localToUTC } from "@/lib/timezone";

/** Snoozed follow-ups land at 09:00 in the app's home zone. */
const SNOOZE_ANCHOR_HOUR = 9;

interface LeadDrawerLogContactFormProps {
  detail: LeadDetail;
  onLocalPatch: (next: LeadDetail) => void;
}

const OUTCOME_CHIPS: { value: ContactOutcome; label: string; tone: string }[] =
  [
    {
      value: "answered",
      label: "Answered",
      tone: "bg-green-50 text-green-700 ring-green-200",
    },
    {
      value: "voicemail",
      label: "Voicemail",
      tone: "bg-amber-50 text-amber-700 ring-amber-200",
    },
    {
      value: "no_answer",
      label: "No answer",
      tone: "bg-slate-50 text-slate-600 ring-slate-200",
    },
    {
      value: "replied",
      label: "Replied",
      tone: "bg-teal-50 text-teal-700 ring-teal-200",
    },
    {
      value: "booked",
      label: "Booked",
      tone: "bg-violet-50 text-violet-700 ring-violet-200",
    },
    {
      value: "not_interested",
      label: "Not interested",
      tone: "bg-red-50 text-red-700 ring-red-200",
    },
  ];

export function LeadDrawerLogContactForm({
  detail,
  onLocalPatch,
}: LeadDrawerLogContactFormProps) {
  const [method, setMethod] = useState<ContactMethod>("call");
  const [direction, setDirection] = useState<ContactDirection>("outbound");
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [purpose, setPurpose] = useState<string>("general");
  const [note, setNote] = useState<string>("");
  const [nextActionDate, setNextActionDate] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOutcome(null);
    setNote("");
    setNextActionDate("");
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await logContact({
        nanny_user_id: detail.nanny_user_id,
        method,
        direction,
        outcome,
        purpose: purpose.trim() || null,
        note: note.trim() || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }

      if (nextActionDate) {
        // Anchor the snooze date to `APP_TZ` so a `next_action_at` entered as
        // "follow up on May 22" fires at 09:00 local on May 22 no matter where
        // the operator's machine is. `localToUTC` resolves the zone's real
        // offset for that date, so GMT and BST are both correct — this
        // replaces a hardcoded fixed offset that was wrong half the year.
        const iso = localToUTC(nextActionDate, SNOOZE_ANCHOR_HOUR, 0);
        const next = await setNextAction({
          nanny_user_id: detail.nanny_user_id,
          next_action_at: iso,
        });
        if (!next.success) {
          setError(next.error);
          return;
        }
        onLocalPatch({
          ...detail,
          contact_state: detail.contact_state
            ? { ...detail.contact_state, next_action_at: iso }
            : null,
        });
      }
      reset();
    });
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Log new contact
      </h3>

      {/* Outcome chips */}
      <div className="flex flex-wrap items-center gap-1">
        {OUTCOME_CHIPS.map((c) => {
          const active = outcome === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setOutcome(active ? null : c.value)}
              disabled={isPending}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${c.tone} ${
                active ? "ring-2" : ""
              } ${isPending ? "opacity-50" : ""}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Method + direction */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="mb-1 block text-slate-500">Method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ContactMethod)}
            disabled={isPending}
            className="h-8 w-full rounded border border-slate-200 px-2 text-sm"
          >
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-slate-500">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as ContactDirection)}
            disabled={isPending}
            className="h-8 w-full rounded border border-slate-200 px-2 text-sm"
          >
            {CONTACT_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Purpose */}
      <label className="mt-2 block text-xs">
        <span className="mb-1 block text-slate-500">Purpose</span>
        <Input
          list="t032-purpose-options"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          disabled={isPending}
          placeholder="e.g. upsell-kids"
        />
        <datalist id="t032-purpose-options">
          {CONTACT_PURPOSE_DEFAULTS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>

      {/* Note */}
      <label className="mt-2 block text-xs">
        <span className="mb-1 block text-slate-500">Note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isPending}
          rows={2}
          maxLength={2000}
          className="block w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm"
          placeholder="One line is fine. Anything you want to remember about this contact."
        />
      </label>

      {/* Next action */}
      <label className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-slate-500">Next action</span>
        <Input
          type="date"
          value={nextActionDate}
          onChange={(e) => setNextActionDate(e.target.value)}
          disabled={isPending}
          className="max-w-[180px]"
        />
        <span className="text-slate-400">or</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            const t = new Date();
            t.setDate(t.getDate() + 3);
            setNextActionDate(t.toISOString().slice(0, 10));
          }}
        >
          +3d
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            const t = new Date();
            t.setDate(t.getDate() + 7);
            setNextActionDate(t.toISOString().slice(0, 10));
          }}
        >
          +1w
        </Button>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reset}
          disabled={isPending}
        >
          Reset
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={isPending}>
          {isPending ? "Logging…" : "Log contact"}
        </Button>
      </div>
    </section>
  );
}
