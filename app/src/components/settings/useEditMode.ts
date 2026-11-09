"use client";

/**
 * Edit mode's lifecycle, shared by every editable Settings page (06b-3 rework, ledger B06 §9.1 R1):
 *
 * - `begin` → fields in place, focus on the first (the checked radio of a group); `cancel` discards, focus back on Edit.
 * - `refuse(fields)` (the page's own check) and a server refusal by field: "Please check the details marked below.",
 *   each message under its field, focus on the first — on a refusal only, never as she types (round 2 #1: with two
 *   marks, fixing one moved her to the next mid-word); nothing she typed is lost. `clearError` as she fixes a field;
 *   once she has fixed the last marked field the alert goes too, as it points at nothing (round 2, walk shot 2).
 * - `save(run)`: one at a time (a ref: React 18 batches state, so two submits can both start before a re-render).
 *   - saved → back to view once the refreshed page has arrived (the refresh runs in a transition, so the old values
 *     never flash), focus on Edit, "Saved" announced;
 *   - stale → back to view showing the latest (also in the transition): "These details were changed elsewhere. The
 *     latest are now showing." — set in the transition too, so it arrives with the latest, never over her form (round 2);
 *     "Saved" likewise;
 *   - no answer within `SAVE_WAIT_MS`, or a throw (offline, a stale deploy) → "We couldn't save that. Please try
 *     again.", still editing, the view underneath refreshed (06b-3 round-2 L1), focus back on Save;
 *   - any other refusal → its plain message, still editing, focus back on Save.
 * - While saving, "Saving…" is announced and Save stays focusable (`aria-disabled`, review round 1: a disabled button
 *   that has focus drops it to the page).
 * - `armed`: what the unsaved-changes guard watches — editing, and not yet saved or answered stale. It goes off as soon
 *   as the save lands, before the refreshed view arrives (round 2 #3: a link clicked just after Save never asks to
 *   discard what is already saved).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useCallback, useEffect, useRef, useState, useTransition, type Dispatch, type RefObject, type SetStateAction } from "react";
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
  /** Editing with nothing saved yet: off once a save lands or is answered stale (the guard watches this). */
  readonly armed: boolean;
  readonly saving: boolean;
  readonly notice: Notice | null;
  /** What a screen reader hears about the save: "Saving…", "Saved", or nothing. */
  readonly announcement: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly editRef: RefObject<HTMLButtonElement>;
  readonly saveRef: RefObject<HTMLButtonElement>;
  readonly formRef: RefObject<HTMLFormElement>;
  readonly begin: () => void;
  readonly cancel: () => void;
  readonly refuse: (fields: Readonly<Record<string, string>>) => void;
  readonly clearError: (field: string) => void;
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

/** The first field: a group's checked radio, or the first other control (a11y review L2). */
const FIELD =
  'input[type=radio]:checked:not([disabled]), input:not([type=radio]):not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])';
const NO_ERRORS: Readonly<Record<string, string>> = Object.freeze({});

interface FocusRefs {
  readonly formRef: RefObject<HTMLFormElement>;
  readonly editRef: RefObject<HTMLButtonElement>;
  readonly saveRef: RefObject<HTMLButtonElement>;
}

/** The "check the details marked below" alert goes when the marks go from some to none: she fixed the last one. Only
 * that alert (a stale or plain message stays), and only on that change (a refusal with no field keeps it). */
function useMarkedAlertClears(errors: Readonly<Record<string, string>>, setNotice: Dispatch<SetStateAction<Notice | null>>) {
  const hadMarks = useRef(false);
  useEffect(() => {
    const marked = Object.keys(errors).length > 0;
    if (hadMarks.current && !marked) setNotice((shown) => (shown?.text === EDIT_MESSAGES.checkMarked ? null : shown));
    hadMarks.current = marked;
  }, [errors, setNotice]);
}

/** Focus on the first field when editing starts, on Edit when it ends, on the first marked field after a refusal by
 * field (`refusals` counts those — never as a mark clears while she types), on Save after a plain refusal or the
 * give-up (`saveTurn` counts those). */
function useEditFocus(editing: boolean, refusals: number, saveTurn: number, refs: FocusRefs) {
  const { formRef, editRef, saveRef } = refs;
  const was = useRef(editing);
  useEffect(() => {
    if (editing && !was.current) formRef.current?.querySelector<HTMLElement>(FIELD)?.focus();
    if (!editing && was.current) editRef.current?.focus();
    was.current = editing;
  }, [editing, formRef, editRef]);
  useEffect(() => {
    if (refusals > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusals, formRef]);
  useEffect(() => {
    if (saveTurn > 0) saveRef.current?.focus();
  }, [saveTurn, saveRef]);
}

/** The page's notice and its marked fields: `refuse` marks them with the alert, `clearError` unmarks one as she fixes
 * it, and the alert goes with the last mark. */
function useMarks() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>(NO_ERRORS);
  const [refusals, setRefusals] = useState(0);
  useMarkedAlertClears(errors, setNotice);
  const refuse = useCallback((fields: Readonly<Record<string, string>>) => {
    setErrors(fields);
    setNotice({ tone: "alert", text: EDIT_MESSAGES.checkMarked });
    setRefusals((n) => n + 1);
  }, []);
  const clearError = useCallback((field: string) => {
    setErrors((current) => {
      if (!Object.hasOwn(current, field)) return current;
      const { [field]: _gone, ...rest } = current;
      return rest;
    });
  }, []);
  return { notice, setNotice, errors, setErrors, refusals, refuse, clearError };
}

function useEditRefs() {
  return { editRef: useRef<HTMLButtonElement>(null), saveRef: useRef<HTMLButtonElement>(null), formRef: useRef<HTMLFormElement>(null) };
}

export function useEditMode(): EditMode {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const { notice, setNotice, errors, setErrors, refusals, refuse, clearError } = useMarks();
  const [announcement, setAnnouncement] = useState("");
  const [saveTurn, setSaveTurn] = useState(0);
  const [closing, setClosing] = useState(false);
  const inFlight = useRef(false);
  const { editRef, saveRef, formRef } = useEditRefs();
  useEditFocus(editing, refusals, saveTurn, { formRef, editRef, saveRef });

  const reset = useCallback(() => { setNotice(null); setErrors(NO_ERRORS); setAnnouncement(""); }, [setNotice, setErrors]);
  const begin = useCallback(() => { reset(); setClosing(false); setEditing(true); }, [reset]);
  const cancel = useCallback(() => { reset(); setEditing(false); }, [reset]);

  const finish = useCallback((outcome: SaveOutcome | null) => {
    setAnnouncement("");
    if (outcome === null) { setNotice({ tone: "alert", text: EDIT_MESSAGES.gaveUp }); setSaveTurn((n) => n + 1); router.refresh(); return; }
    if (outcome.kind === "fields") { refuse(outcome.fields); return; }
    if (outcome.kind === "refused") { setNotice({ tone: "alert", text: outcome.message }); setSaveTurn((n) => n + 1); return; }
    setErrors(NO_ERRORS);
    setClosing(true); // saved, or overtaken (the latest replaces her edits): the guard stands down before the view
    startRefresh(() => {
      if (outcome.kind === "stale") setNotice({ tone: "status", text: EDIT_MESSAGES.stale });
      else setAnnouncement("Saved");
      setEditing(false);
      router.refresh();
    });
  }, [refuse, router, setNotice, setErrors]);

  const save = useCallback(async (run: () => Promise<SaveOutcome>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    setAnnouncement("Saving…");
    try {
      finish(await withGiveUp(run));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [finish, setNotice]);

  const armed = editing && !closing;
  return { editing, armed, saving: saving || refreshing, notice, announcement, errors, editRef, saveRef, formRef, begin, cancel, refuse, clearError, save };
}
