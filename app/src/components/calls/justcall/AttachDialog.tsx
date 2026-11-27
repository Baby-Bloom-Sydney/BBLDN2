"use client";

/**
 * Attach to family (plan 05 §5 B4; brief §0.9, §3 admin 7). BB-wave2-231126/05-build. A `Dialog` (the
 * `/admin/cohorts` families dialog's): the call's number and London time; a search by name or mobile (the server
 * returns parents only, the top 10); pick one; then **Attach to <name>**. One press per action (an in-flight guard);
 * refusals in one `role="alert"` line. The dialog's state starts afresh for each call.
 *
 * After the React review: it can't be closed while an attach is in flight (so a result is never lost); it keeps the
 * last call's words while it closes; the number found is announced, the choices are a labelled group, and the "type at
 * least 2" hint is tied to the field; it scrolls within a phone's screen; after an attach, focus goes where the page
 * says (`focusAfterAttach`), not to an Attach button that has left the table.
 */

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
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
  /** Where focus goes once the dialog has closed after an attach. */
  readonly focusAfterAttach?: () => void;
}

/** One press at a time; a throw is the generic refusal. */
function useOnce(onBusy: (busy: boolean) => void) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => onBusy(busy), [busy, onBusy]);
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
  if (results.length === 0) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-xs text-slate-500">{JUSTCALL_COPY.chooseFamily}</legend>
      {results.map((r) => (
        <label key={r.parentUserId} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50">
          <input type="radio" name={name} value={r.parentUserId} checked={picked === r.parentUserId} onChange={() => onPick(r.parentUserId)} className="shrink-0 accent-violet-600" />
          {r.mobile === null ? r.name : `${r.name} · ${r.mobile}`}
        </label>
      ))}
    </fieldset>
  );
}

function SearchForm({ busy, onSearch }: { readonly busy: boolean; readonly onSearch: (query: string) => void }) {
  const inputId = useId();
  const hintId = useId();
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tooShort = query.trim().length < 2;
    setHint(tooShort);
    if (!tooShort) onSearch(query);
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <label htmlFor={inputId} className="block text-xs text-slate-500">
        {JUSTCALL_COPY.attachSearchLabel}
      </label>
      <div className="flex gap-2">
        <Input id={inputId} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} autoComplete="off" className="min-w-0"
          aria-invalid={hint || undefined} aria-describedby={hint ? hintId : undefined} />
        <Button type="submit" variant="outline" disabled={busy}>
          {JUSTCALL_COPY.search}
        </Button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-amber-700">
          {JUSTCALL_COPY.searchHint}
        </p>
      )}
    </form>
  );
}

function AttachBody({ call, onAttached, onBusy }: { readonly call: UnmatchedCallView; readonly onAttached: () => void; readonly onBusy: (busy: boolean) => void }) {
  const [results, setResults] = useState<readonly ParentChoice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, once } = useOnce(onBusy);
  const failed = () => setError(justcallErrorLine("error"));
  const search = (query: string) =>
    void once(async () => {
      setError(null);
      setPicked(null);
      const found = await searchFamiliesForCallAction({ query });
      setResults(found.ok ? found.value : null);
      if (!found.ok) setError(justcallErrorLine(found.error));
    }, failed);
  const pick = (id: string) => {
    setPicked(id);
    setError(null);
  };
  const attach = () =>
    void once(async () => {
      if (picked === null) return;
      setError(null);
      const attached = await attachJustCallAction({ callSid: call.callSid, parentUserId: picked });
      if (attached.ok) onAttached();
      else setError(justcallErrorLine(attached.error));
    }, failed);
  const chosen = results?.find((r) => r.parentUserId === picked) ?? null;
  return (
    <div className="space-y-3">
      <SearchForm busy={busy} onSearch={search} />
      <p role="status" className={results === null ? "sr-only" : "text-xs text-slate-600"}>
        {results === null ? "" : results.length === 0 ? JUSTCALL_COPY.noFamilyFound : JUSTCALL_COPY.familiesFound(results.length)}
      </p>
      {results !== null && <Choices results={results} picked={picked} onPick={pick} />}
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

export function AttachDialog({ call, onClose, onAttached, focusAfterAttach }: AttachDialogProps) {
  const last = useRef<UnmatchedCallView | null>(call);
  if (call !== null) last.current = call;
  const shown = call ?? last.current;
  const [busy, setBusy] = useState(false);
  const didAttach = useRef(false);
  const attached = () => {
    didAttach.current = true;
    onAttached();
  };
  const closeFocus = (event: Event) => {
    if (!didAttach.current) return;
    didAttach.current = false;
    event.preventDefault();
    focusAfterAttach?.();
  };
  return (
    <Dialog open={call !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto" onCloseAutoFocus={closeFocus}>
        {shown && (
          <>
            <DialogHeader>
              <DialogTitle>{JUSTCALL_COPY.attachTitle}</DialogTitle>
              <DialogDescription>{`${shown.number} · ${shown.when}`}</DialogDescription>
            </DialogHeader>
            <AttachBody key={shown.callSid} call={shown} onAttached={attached} onBusy={setBusy} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
