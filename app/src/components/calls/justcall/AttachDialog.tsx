"use client";

/**
 * Attach to family (plan 05 §5 B4; brief §0.9, §3 admin 7). BB-wave2-231126/05-build. A `Dialog` (the
 * `/admin/cohorts` families dialog's): the call's number and London time; a search by name or mobile (the server
 * returns parents only, the top 10); pick one; then **Attach to <name>**. One press per action (an in-flight guard);
 * refusals in one `role="alert"` line. The dialog's state starts afresh for each call.
 */

import { type FormEvent, useId, useRef, useState } from "react";
import { attachJustCallAction, searchFamiliesForCallAction } from "@/app/admin/calls/justcall-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ParentChoice, UnmatchedCallView } from "@/lib/justcall/types";
import { JUSTCALL_COPY, justcallErrorLine } from "@/lib/justcall/words";

export interface AttachDialogProps {
  readonly call: UnmatchedCallView | null;
  readonly onClose: () => void;
  readonly onAttached: () => void;
}

/** One press at a time; a throw is the generic refusal. */
function useOnce() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const once = async (work: () => Promise<void>, onThrow: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      onThrow();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, once };
}

function Choices({ results, picked, onPick }: { readonly results: readonly ParentChoice[]; readonly picked: string | null; readonly onPick: (id: string) => void }) {
  const name = useId();
  if (results.length === 0) return <p className="text-sm text-slate-600">{JUSTCALL_COPY.noFamilyFound}</p>;
  return (
    <fieldset className="space-y-1">
      <legend className="sr-only">{JUSTCALL_COPY.attachTitle}</legend>
      {results.map((r) => (
        <label key={r.parentUserId} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50">
          <input type="radio" name={name} value={r.parentUserId} checked={picked === r.parentUserId} onChange={() => onPick(r.parentUserId)} className="accent-violet-600" />
          {r.mobile === null ? r.name : `${r.name} · ${r.mobile}`}
        </label>
      ))}
    </fieldset>
  );
}

function AttachBody({ call, onAttached }: { readonly call: UnmatchedCallView; readonly onAttached: () => void }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly ParentChoice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const { busy, once } = useOnce();
  const failed = () => setError(justcallErrorLine("error"));
  const search = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setHint(query.trim().length < 2);
    if (query.trim().length < 2) return;
    void once(async () => {
      const found = await searchFamiliesForCallAction({ query });
      setPicked(null);
      if (found.ok) {
        setResults(found.value);
        return;
      }
      setResults(null);
      setError(justcallErrorLine(found.error));
    }, failed);
  };
  const attach = () =>
    void once(async () => {
      if (picked === null) return;
      const attached = await attachJustCallAction({ callSid: call.callSid, parentUserId: picked });
      if (!attached.ok) return setError(justcallErrorLine(attached.error));
      onAttached();
    }, failed);
  const chosen = results?.find((r) => r.parentUserId === picked) ?? null;
  return (
    <div className="space-y-3">
      <form onSubmit={search} className="space-y-1">
        <label htmlFor={inputId} className="block text-xs text-slate-500">
          {JUSTCALL_COPY.attachSearchLabel}
        </label>
        <div className="flex gap-2">
          <Input id={inputId} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} autoComplete="off" />
          <Button type="submit" variant="outline" disabled={busy}>
            {JUSTCALL_COPY.search}
          </Button>
        </div>
        {hint && <p className="text-xs text-amber-700">{JUSTCALL_COPY.searchHint}</p>}
      </form>
      {results !== null && <Choices results={results} picked={picked} onPick={setPicked} />}
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}
      {chosen && (
        <div className="flex justify-end">
          <Button type="button" onClick={attach} disabled={busy}>
            {JUSTCALL_COPY.attachAction(chosen.name)}
          </Button>
        </div>
      )}
    </div>
  );
}

export function AttachDialog({ call, onClose, onAttached }: AttachDialogProps) {
  return (
    <Dialog open={call !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {call && (
          <>
            <DialogHeader>
              <DialogTitle>{JUSTCALL_COPY.attachTitle}</DialogTitle>
              <DialogDescription>{`${call.number} · ${call.when}`}</DialogDescription>
            </DialogHeader>
            <AttachBody key={call.callSid} call={call} onAttached={onAttached} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
