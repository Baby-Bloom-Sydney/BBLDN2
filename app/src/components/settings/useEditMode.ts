"use client";

/**
 * Edit mode's lifecycle, shared by every editable Settings page (06b-3 rework, ledger B06 §9.1 R1):
 *
 * - `begin` → fields in place, focus on the first; `cancel` discards, focus back on Edit.
 * - `refuse(fields)` (the page's own check) and a server refusal by field: "Please check the details marked below.",
 *   each message under its field, focus on the first; nothing she typed is lost.
 * - `save(run)`: one at a time (a ref: React 18 batches state, so two submits can both start before a re-render).
 *   - saved → back to view once the refreshed page has arrived (the refresh runs in a transition, so the old values
 *     never flash), focus on Edit;
 *   - stale → back to view showing the latest: "These details were changed elsewhere. The latest are now showing.";
 *   - no answer within `SAVE_WAIT_MS`, or a throw (offline, a stale deploy) → "We couldn't save that. Please try
 *     again.", still editing, and the view underneath refreshed (06b-3 round-2 L1: a save that lands late must not
 *     leave the page showing what it replaced);
 *   - any other refusal → its plain message, still editing.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useCallback, useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { EDIT_MESSAGES } from "@/lib/settings/edit-messages";
import type { Notice } from "./EditNotice";

/** How long a save may take before the page gives up on its answer. */
export const SAVE_WAIT_MS = 30_000;

export type SaveOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "fields"; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: "stale" }
  | { readonly kind: "refused"; readonly message: string };

export interface EditMode {
  readonly editing: boolean;
  readonly saving: boolean;
  readonly notice: Notice | null;
  readonly errors: Readonly<Record<string, string>>;
  readonly editRef: RefObject<HTMLButtonElement>;
  readonly formRef: RefObject<HTMLFormElement>;
  readonly begin: () => void;
  readonly cancel: () => void;
  readonly refuse: (fields: Readonly<Record<string, string>>) => void;
  readonly save: (run: () => Promise<SaveOutcome>) => Promise<void>;
}

/** The outcome, or null when it throws or gives no answer within `SAVE_WAIT_MS`. */
async function withGiveUp(run: () => Promise<SaveOutcome>): Promise<SaveOutcome | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SAVE_WAIT_MS);
  });
  try {
    return await Promise.race([run(), gaveUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const FIELD = "input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])";
const NO_ERRORS: Readonly<Record<string, string>> = Object.freeze({});

/** Focus on the first field when editing starts, on Edit when it ends, on the first marked field after a refusal. */
function useEditFocus(editing: boolean, errors: Readonly<Record<string, string>>, formRef: RefObject<HTMLFormElement>, editRef: RefObject<HTMLButtonElement>) {
  const was = useRef(editing);
  useEffect(() => {
    if (editing && !was.current) formRef.current?.querySelector<HTMLElement>(FIELD)?.focus();
    if (!editing && was.current) editRef.current?.focus();
    was.current = editing;
  }, [editing, formRef, editRef]);
  useEffect(() => {
    if (Object.keys(errors).length > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, formRef]);
}

export function useEditMode(): EditMode {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>(NO_ERRORS);
  const inFlight = useRef(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEditFocus(editing, errors, formRef, editRef);

  const begin = useCallback(() => { setNotice(null); setErrors(NO_ERRORS); setEditing(true); }, []);
  const cancel = useCallback(() => { setNotice(null); setErrors(NO_ERRORS); setEditing(false); }, []);
  const refuse = useCallback((fields: Readonly<Record<string, string>>) => {
    setErrors(fields);
    setNotice({ tone: "alert", text: EDIT_MESSAGES.checkMarked });
  }, []);

  const finish = useCallback((outcome: SaveOutcome | null) => {
    if (outcome === null) { setNotice({ tone: "alert", text: EDIT_MESSAGES.gaveUp }); router.refresh(); return; }
    if (outcome.kind === "fields") { refuse(outcome.fields); return; }
    if (outcome.kind === "refused") { setNotice({ tone: "alert", text: outcome.message }); return; }
    setErrors(NO_ERRORS);
    if (outcome.kind === "stale") { setNotice({ tone: "status", text: EDIT_MESSAGES.stale }); setEditing(false); router.refresh(); return; }
    startRefresh(() => { setEditing(false); router.refresh(); });
  }, [refuse, router]);

  const save = useCallback(async (run: () => Promise<SaveOutcome>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      finish(await withGiveUp(run));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [finish]);

  return { editing, saving: saving || refreshing, notice, errors, editRef, formRef, begin, cancel, refuse, save };
}
