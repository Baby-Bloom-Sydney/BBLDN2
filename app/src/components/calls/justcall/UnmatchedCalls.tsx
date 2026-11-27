"use client";

/**
 * Unmatched JustCall calls, at the end of /admin/calls' Calls tab (plan 05 §5 B4; brief §0.9, §3 admin 7, §7).
 * BB-wave2-231126/05-build.
 *
 * "Unmatched JustCall calls (3)": a captioned table, as 04's lists — number, London time, direction, result, length,
 * why it is Unmatched (`StatusBadge`, toned from the codes: answered green, no answer slate; no family grey, more than
 * one amber) — with **Attach to family** (a dialog: search, pick, confirm) and **Dismiss** (asked once: Dismiss or Keep).
 * The table scrolls sideways on a narrow screen. Only calls with a result are listed, the newest 100 (the server's rule).
 *
 * After the React review: focus goes to the question's Dismiss when it is asked, back to the row's Dismiss on Keep, and
 * to the heading once a call is dismissed or attached (its row leaves the table at once, before the refresh lands);
 * while one change is in flight every row's buttons wait; a new change clears the last one's line.
 */

import { useEffect, useId, useRef, useState } from "react";
import { dismissJustCallAction } from "@/app/admin/calls/justcall-actions";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_COPY } from "@/lib/calls/copy";
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

interface RowActionsProps {
  readonly call: UnmatchedCallView;
  readonly confirming: boolean;
  /** Focus this row's Dismiss when it is drawn (after Keep). */
  readonly refocus: boolean;
  readonly busy: boolean;
  readonly onAttach: () => void;
  readonly onAsk: () => void;
  readonly onKeep: () => void;
  readonly onDismiss: () => void;
}

function DismissQuestion({ call, busy, onDismiss, onKeep }: Pick<RowActionsProps, "call" | "busy" | "onDismiss" | "onKeep">) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <div role="group" aria-label={`${JUSTCALL_COPY.dismissConfirm}: ${call.number}`} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-700">{JUSTCALL_COPY.dismissConfirm}</span>
      <Button ref={yes} type="button" size="sm" variant="destructive" onClick={onDismiss} disabled={busy}>
        {JUSTCALL_COPY.dismiss}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onKeep} disabled={busy}>
        {JUSTCALL_COPY.keep}
      </Button>
    </div>
  );
}

function RowActions({ call, confirming, refocus, busy, onAttach, onAsk, onKeep, onDismiss }: RowActionsProps) {
  const dismissButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refocus && !confirming) dismissButton.current?.focus();
  }, [refocus, confirming]);
  if (confirming) return <DismissQuestion call={call} busy={busy} onDismiss={onDismiss} onKeep={onKeep} />;
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onAttach} disabled={busy} aria-label={`${JUSTCALL_COPY.attach}: ${call.number}`}>
        {JUSTCALL_COPY.attach}
      </Button>
      <Button ref={dismissButton} type="button" size="sm" variant="ghost" onClick={onAsk} disabled={busy} aria-label={`${JUSTCALL_COPY.dismiss}: ${call.number}`}>
        {JUSTCALL_COPY.dismiss}
      </Button>
    </div>
  );
}

/** The list's changes: one at a time, their outcome as one line, a call gone from the table once it is handled. */
function useUnmatchedChanges(onChanged: () => void, focusHeading: () => void) {
  const inFlight = useRef(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setError(null);
    setStatus("");
  };
  const handled = (callSid: string, line: string) => {
    setGone((before) => new Set([...before, callSid]));
    setStatus(line);
    onChanged();
  };
  const ask = (callSid: string) => {
    start();
    setRefocus(null);
    setConfirming(callSid);
  };
  const keep = () => {
    setRefocus(confirming);
    setConfirming(null);
  };
  const dismiss = async (callSid: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    start();
    try {
      const done = await dismissJustCallAction({ callSid });
      if (!done.ok) return setError(justcallErrorLine(done.error));
      setConfirming(null);
      handled(callSid, JUSTCALL_COPY.dismissed);
      focusHeading();
    } catch {
      setError(justcallErrorLine("error"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { confirming, refocus, gone, busy, status, error, start, handled, ask, keep, dismiss };
}

type Changes = ReturnType<typeof useUnmatchedChanges>;

function CallsTable({ calls, c, onAttach }: { readonly calls: readonly UnmatchedCallView[]; readonly c: Changes; readonly onAttach: (call: UnmatchedCallView) => void }) {
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
          {calls.map((call) => (
            <TableRow key={call.callSid} className="align-top">
              <TableCell className="whitespace-nowrap font-medium text-slate-900">{call.number}</TableCell>
              <TableCell className="whitespace-nowrap text-slate-700">{call.when}</TableCell>
              <TableCell className="text-slate-700">{call.direction}</TableCell>
              <TableCell>
                <StatusBadge variant={call.resultCode === "answered" ? "active" : "unattempted"}>{call.result}</StatusBadge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-slate-700">{call.duration}</TableCell>
              <TableCell>
                <StatusBadge variant={call.matchNote === "several" ? "pending" : "inactive"}>{call.reason}</StatusBadge>
              </TableCell>
              <TableCell>
                <RowActions
                  call={call}
                  confirming={c.confirming === call.callSid}
                  refocus={c.refocus === call.callSid}
                  busy={c.busy}
                  onAttach={() => onAttach(call)}
                  onAsk={() => c.ask(call.callSid)}
                  onKeep={c.keep}
                  onDismiss={() => void c.dismiss(call.callSid)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Body({ list, c, onAttach }: { readonly list: UnmatchedList | null; readonly c: Changes; readonly onAttach: (call: UnmatchedCallView) => void }) {
  if (list === null) {
    return (
      <p role="alert" className="text-sm text-amber-700">
        {JUSTCALL_COPY.unmatchedFailed}
      </p>
    );
  }
  const calls = list.calls.filter((call) => !c.gone.has(call.callSid));
  if (calls.length === 0) return <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{ADMIN_COPY.sectionEmpty}</p>;
  return <CallsTable calls={calls} c={c} onAttach={onAttach} />;
}

export function UnmatchedCalls({ list, onChanged }: UnmatchedCallsProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const c = useUnmatchedChanges(onChanged, () => heading.current?.focus());
  const [attaching, setAttaching] = useState<UnmatchedCallView | null>(null);
  const hiddenHere = list === null ? 0 : list.calls.filter((call) => c.gone.has(call.callSid)).length;
  const attach = (call: UnmatchedCallView) => {
    c.start();
    setAttaching(call);
  };
  const attached = () => {
    if (attaching !== null) c.handled(attaching.callSid, JUSTCALL_COPY.attached);
    setAttaching(null);
  };
  return (
    <section aria-labelledby={headingId} className="mt-6 space-y-2">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        {list === null ? JUSTCALL_COPY.unmatchedTitle : unmatchedHeading(Math.max(0, list.total - hiddenHere))}
      </h2>
      <Body list={list} c={c} onAttach={attach} />
      {list !== null && list.total > list.calls.length && <p className="text-xs text-slate-500">{JUSTCALL_COPY.unmatchedMore}</p>}
      {c.error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {c.error}
        </p>
      )}
      <p role="status" className={c.status ? "text-xs text-green-700" : "sr-only"}>
        {c.status}
      </p>
      <AttachDialog call={attaching} onClose={() => setAttaching(null)} onAttached={attached} focusAfterAttach={() => heading.current?.focus()} />
    </section>
  );
}
