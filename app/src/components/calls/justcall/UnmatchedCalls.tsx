"use client";

/**
 * Unmatched JustCall calls, at the end of /admin/calls' Calls tab (plan 05 §5 B4; brief §0.9, §3 admin 7, §7).
 * BB-wave2-231126/05-build.
 *
 * "Unmatched JustCall calls (3)": a captioned table, as 04's lists — number, London time, direction, result, length,
 * why it is Unmatched (`StatusBadge`: the result answered green / no answer slate; no family grey, more than one
 * amber) — with **Attach to family** (a dialog: search, pick, confirm) and **Dismiss** (asked once: Dismiss or Keep).
 * The table scrolls sideways on a narrow screen. A change refreshes the page (`onChanged`); its outcome is one status
 * or alert line. Only calls with a result are listed, the newest 100 (the server's rule).
 */

import { useId, useRef, useState } from "react";
import { dismissJustCallAction } from "@/app/admin/calls/justcall-actions";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { resultLabel } from "@/lib/calls/outcomes";
import type { UnmatchedCallView, UnmatchedList } from "@/lib/justcall/types";
import { JUSTCALL_COPY, justcallErrorLine, unmatchedHeading } from "@/lib/justcall/words";
import { AttachDialog } from "./AttachDialog";

export interface UnmatchedCallsProps {
  /** Null: the list couldn't be read (the section says so). */
  readonly list: UnmatchedList | null;
  readonly onChanged: () => void;
}

const COLUMNS = [
  JUSTCALL_COPY.colNumber,
  JUSTCALL_COPY.colWhen,
  JUSTCALL_COPY.colDirection,
  JUSTCALL_COPY.colResult,
  JUSTCALL_COPY.colLength,
  JUSTCALL_COPY.colReason,
] as const;

const resultTone = (result: string) => (result === resultLabel("answered") ? "active" : "unattempted");
const reasonTone = (reason: string) => (reason === JUSTCALL_COPY.reasonSeveral ? "pending" : "inactive");

interface RowActionsProps {
  readonly call: UnmatchedCallView;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly onAttach: () => void;
  readonly onAsk: () => void;
  readonly onKeep: () => void;
  readonly onDismiss: () => void;
}

function RowActions({ call, confirming, busy, onAttach, onAsk, onKeep, onDismiss }: RowActionsProps) {
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-700">{JUSTCALL_COPY.dismissConfirm}</span>
        <Button type="button" size="sm" variant="destructive" onClick={onDismiss} disabled={busy}>
          {JUSTCALL_COPY.dismiss}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onKeep} disabled={busy}>
          {JUSTCALL_COPY.keep}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onAttach} aria-label={`${JUSTCALL_COPY.attach}: ${call.number}`}>
        {JUSTCALL_COPY.attach}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onAsk} aria-label={`${JUSTCALL_COPY.dismiss}: ${call.number}`}>
        {JUSTCALL_COPY.dismiss}
      </Button>
    </div>
  );
}

/** Dismiss, one at a time: ask, then the action; the outcome as one line. */
function useDismiss(onChanged: () => void) {
  const inFlight = useRef(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dismiss = async (callSid: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const done = await dismissJustCallAction({ callSid });
      if (!done.ok) return setError(justcallErrorLine(done.error));
      setConfirming(null);
      setStatus(JUSTCALL_COPY.dismissed);
      onChanged();
    } catch {
      setError(justcallErrorLine("error"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { confirming, setConfirming, busy, status, setStatus, error, dismiss };
}

function CallsTable({ calls, d, onAttach }: { readonly calls: readonly UnmatchedCallView[]; readonly d: ReturnType<typeof useDismiss>; readonly onAttach: (call: UnmatchedCallView) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableCaption className="sr-only">{JUSTCALL_COPY.unmatchedTitle}</TableCaption>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
            <TableHead>
              <span className="sr-only">{JUSTCALL_COPY.colActions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c) => (
            <TableRow key={c.callSid} className="align-top">
              <TableCell className="whitespace-nowrap font-medium text-slate-900">{c.number}</TableCell>
              <TableCell className="whitespace-nowrap text-slate-700">{c.when}</TableCell>
              <TableCell className="text-slate-700">{c.direction}</TableCell>
              <TableCell>
                <StatusBadge variant={resultTone(c.result)}>{c.result}</StatusBadge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-slate-700">{c.duration}</TableCell>
              <TableCell>
                <StatusBadge variant={reasonTone(c.reason)}>{c.reason}</StatusBadge>
              </TableCell>
              <TableCell>
                <RowActions
                  call={c}
                  confirming={d.confirming === c.callSid}
                  busy={d.busy}
                  onAttach={() => onAttach(c)}
                  onAsk={() => d.setConfirming(c.callSid)}
                  onKeep={() => d.setConfirming(null)}
                  onDismiss={() => void d.dismiss(c.callSid)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function UnmatchedCalls({ list, onChanged }: UnmatchedCallsProps) {
  const headingId = useId();
  const d = useDismiss(onChanged);
  const [attaching, setAttaching] = useState<UnmatchedCallView | null>(null);
  const attached = () => {
    setAttaching(null);
    d.setStatus(JUSTCALL_COPY.attached);
    onChanged();
  };
  return (
    <section aria-labelledby={headingId} className="mt-6 space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-slate-900">
        {unmatchedHeading(list?.total ?? 0)}
      </h2>
      {list === null ? (
        <p role="alert" className="text-sm text-amber-700">
          {JUSTCALL_COPY.unmatchedFailed}
        </p>
      ) : list.calls.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{ADMIN_COPY.sectionEmpty}</p>
      ) : (
        <CallsTable calls={list.calls} d={d} onAttach={setAttaching} />
      )}
      {list !== null && list.total > list.calls.length && <p className="text-xs text-slate-500">{JUSTCALL_COPY.unmatchedMore}</p>}
      {d.error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {d.error}
        </p>
      )}
      <p role="status" className={d.status ? "text-xs text-green-700" : "sr-only"}>
        {d.status}
      </p>
      <AttachDialog call={attaching} onClose={() => setAttaching(null)} onAttached={attached} />
    </section>
  );
}
