"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { G1, G2 } from "@/config/offer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { findGuaranteeFamily, recordGuarantee, type GuaranteeFamily } from "./actions";
import { formatDay, formatDayTime, formatPence } from "./format";
import { PROMISES, g4DisabledReason, g4Enabled, promiseLabel, type GuaranteePromise } from "./rules";
import type { GuaranteeListRow } from "./types";

/**
 * /admin/guarantees client: the record form (email lookup → promise, condition, outcome, paid out, notes) and the
 * ledger list. Windows are information, never a block (offer §4 "one call with us first"); G4 is disabled with its
 * reason until the business has made enough placements (config). BB-LDN-4e-151026.
 */

const ERROR_COPY: Record<string, string> = {
  not_authorized: "Admins only.",
  invalid_email: "Enter the family's email address.",
  not_found: "No account with that email.",
  ambiguous: "More than one account matches — check the email.",
  not_a_family: "That account is not a parent.",
  lookup_failed: "Lookup failed — try again.",
  invalid_input: "Check the form.",
  invalid_family: "Look the family up first.",
  invalid_promise: "Pick a promise.",
  invalid_condition: "Say whether the condition was met.",
  outcome_required: "Say what was done.",
  outcome_too_long: "The outcome is too long.",
  invalid_amount: "Enter the amount paid out in pounds and pence (0 if nothing).",
  notes_too_long: "The notes are too long.",
  g4_not_enabled: `G4 is not offered yet — ${g4DisabledReason().toLowerCase()}.`,
  already_recorded: "This promise is already recorded for this family — G1 to G4 are once per family.",
  save_failed: "Could not save — try again.",
};

const errorText = (code: string) => ERROR_COPY[code] ?? "Something went wrong.";

export function GuaranteesClient({ rows, placementCount }: { rows: GuaranteeListRow[]; placementCount: number }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <RecordForm placementCount={placementCount} />
      <LedgerList rows={rows} />
    </div>
  );
}

function RecordForm({ placementCount }: { placementCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [family, setFamily] = useState<GuaranteeFamily | null>(null);
  const [promise, setPromise] = useState<GuaranteePromise>("G1");
  const [conditionMet, setConditionMet] = useState(true);
  const [outcome, setOutcome] = useState("");
  const [paidOut, setPaidOut] = useState("0");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const g4On = g4Enabled(placementCount);

  const lookup = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await findGuaranteeFamily(email);
      setFamily(r.ok ? r.family : null);
      if (!r.ok) setMessage({ tone: "error", text: errorText(r.error) });
    });

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await recordGuarantee({
        parentUserId: family?.parentUserId ?? "",
        promise,
        conditionMet,
        outcome,
        paidOutPounds: paidOut,
        notes,
      });
      if (!r.ok) {
        setMessage({ tone: "error", text: errorText(r.error) });
        return;
      }
      setMessage({ tone: "ok", text: `${promise} recorded.` });
      setFamily((f) => (f ? { ...f, recorded: [...f.recorded, promise] } : f));
      setOutcome("");
      setNotes("");
      setPaidOut("0");
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Record a guarantee</h2>
        <div className="space-y-1.5">
          <Label htmlFor="g-email">Family email</Label>
          <div className="flex gap-2">
            <Input id="g-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="button" variant="outline" onClick={lookup} disabled={pending || !email.trim()}>
              Find
            </Button>
          </div>
        </div>

        {family && <FamilyPanel family={family} />}

        <fieldset className="space-y-1.5" disabled={!family || pending}>
          <legend className="text-sm font-medium text-slate-700">Promise</legend>
          {PROMISES.map((p) => {
            const off = p === "G4" && !g4On;
            return (
              <label key={p} className={`flex items-start gap-2 text-sm ${off ? "text-slate-400" : "text-slate-700"}`}>
                <input
                  type="radio"
                  name="promise"
                  value={p}
                  className="mt-1"
                  checked={promise === p}
                  disabled={off}
                  onChange={() => setPromise(p)}
                />
                <span>
                  {promiseLabel(p)}
                  {off && <span className="ml-1 text-xs">({g4DisabledReason()})</span>}
                  {family?.recorded.includes(p) && p !== "G5" && (
                    <span className="ml-1 text-xs text-amber-700">already recorded</span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="space-y-3" disabled={!family || pending}>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={conditionMet} onChange={(e) => setConditionMet(e.target.checked)} />
            Condition met
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="g-outcome">Outcome — what was done</Label>
            <Input id="g-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-paid">Paid out (£)</Label>
            <Input id="g-paid" inputMode="decimal" value={paidOut} onChange={(e) => setPaidOut(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-notes">Notes</Label>
            <Textarea id="g-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="button" onClick={save} disabled={!family || pending} className="w-full">
            Record
          </Button>
        </fieldset>

        {message && (
          <p role="status" className={`text-sm ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyPanel({ family }: { family: GuaranteeFamily }) {
  const g2 = { open: "open", closed: "closed", unknown: "no first day recorded" }[family.g2Window];
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm text-slate-700">
      <p className="font-medium text-slate-900">{family.name || "(no name)"}</p>
      <p className="text-slate-500">{family.email}</p>
      <p className="mt-2">
        G1 window: {G1.windowDays} days from our call · placed {formatDay(family.placedAt)}
      </p>
      <p>
        G2 window: {G2.windowDays} days from the first day · ends {formatDay(family.satisfactionWindowEndsAt)} ({g2})
      </p>
      <p className="mt-1 text-xs text-slate-500">Windows are for information — you decide after the call.</p>
    </div>
  );
}

function LedgerList({ rows }: { rows: GuaranteeListRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-slate-500">No guarantees recorded yet.</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Family</th>
              <th className="px-4 py-2">Promise</th>
              <th className="px-4 py-2">Condition</th>
              <th className="px-4 py-2">Outcome</th>
              <th className="px-4 py-2 text-right">Paid out</th>
              <th className="px-4 py-2">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-4 py-2">
                  <p className="font-medium text-slate-900">{r.familyName || "(no name)"}</p>
                  <p className="text-xs text-slate-500">{r.familyEmail ?? "no email"}</p>
                </td>
                <td className="px-4 py-2 font-semibold text-violet-700">{r.promise}</td>
                <td className="px-4 py-2">{r.conditionMet ? "Met" : "Not met"}</td>
                <td className="px-4 py-2">
                  {r.outcome}
                  {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPence(r.paidOutPence)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {r.recordedBy}
                  <br />
                  {formatDayTime(r.recordedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
