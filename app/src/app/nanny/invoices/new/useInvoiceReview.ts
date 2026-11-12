"use client";

/**
 * The review and send, as one small state machine (plan 06 §14.6 b4.2/b4.4; old step 12; the server builder's contract
 * in `invoice-messages.ts`). The client never chooses the invoice id or a figure: the review gives them, sealed, and
 * Send returns them with the draft.
 *
 * - **Review:** `previewInvoice(draft)`. On the form, any refusal goes back to the form (by field, or its message).
 * - **The setup** (bank details, rarely an address): `saveBusinessSettings`, then review again (a new id and key).
 *   `stale` reviews again with its message; a refusal by field stays on the setup.
 * - **Send:** sent → her list. `changed`, `no_details`, `no_address`, `already_failed` → review again, with the message
 *   ("Your business settings changed — check the invoice again"). `in_progress`, `already_done`, `not_recorded` → her
 *   list, which shows the message. A refusal by field → the form. Anything else → its message on the review.
 * - One request at a time (a ref: React 18 batches state); an action that throws (offline, a new deploy) says
 *   "Something went wrong. Please try again."
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useRef, useState } from "react";
import type { BusinessPageInput } from "@/lib/invoices/actions/business-page";
import { INVOICE_ACTION_MESSAGES, type InvoiceActionError, type InvoiceActionRefusal, type InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import { previewInvoice } from "@/lib/invoices/actions/preview-invoice";
import { saveBusinessSettings } from "@/lib/invoices/actions/save-business-settings";
import { sendInvoice } from "@/lib/invoices/actions/send-invoice";
import type { FormDraft } from "./invoice-form";

const INVOICES = "/nanny/invoices";
/** Send answers that need a fresh review (a new invoice id and key). */
const REVIEW_AGAIN: readonly InvoiceActionError[] = ["changed", "no_details", "no_address", "already_failed"];
/** Send answers her list explains (`?notice=`). */
const TO_LIST: readonly InvoiceActionError[] = ["in_progress", "already_done", "not_recorded"];

export type ReviewPending = "review" | "send" | "setup" | null;

export interface ReviewState {
  readonly step: "form" | "review";
  readonly draft: FormDraft | null;
  readonly preview: InvoicePreview | null;
  readonly notice: string | null;
  readonly setupIssues: Readonly<Record<string, string>>;
}

const START: ReviewState = { step: "form", draft: null, preview: null, notice: null, setupIssues: {} };

export interface ReviewHandlers {
  /** A refusal for the form: by field, or its message. */
  readonly onFormRefusal: (refusal: InvoiceActionRefusal) => void;
  /** Leave for her list. */
  readonly go: (href: string) => void;
}

/** One request at a time (a ref: React 18 batches state); a throw → `onThrow`. */
function useOnce(onThrow: () => void) {
  const [pending, setPending] = useState<ReviewPending>(null);
  const busy = useRef(false);
  const once = async (kind: Exclude<ReviewPending, null>, work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    try {
      await work();
    } catch {
      onThrow();
    }
    busy.current = false;
    setPending(null);
  };
  return { pending, once };
}

export function useInvoiceReview({ onFormRefusal, go }: ReviewHandlers) {
  const [state, setState] = useState<ReviewState>(START);
  const { pending, once } = useOnce(() => setState((s) => ({ ...s, notice: INVOICE_ACTION_MESSAGES.error })));

  /** Review a draft; `from` says where a refusal shows (the form's, or the review's notice). */
  const askReview = async (draft: FormDraft, notice: string | null, from: ReviewState["step"]) => {
    const result = await previewInvoice(draft);
    if (result.ok) return setState({ step: "review", draft, preview: result.preview, notice, setupIssues: {} });
    if (from === "form" || result.fields) {
      onFormRefusal(result);
      return setState((s) => ({ ...s, step: "form", notice: null }));
    }
    setState((s) => ({ ...s, notice: result.message }));
  };

  const send = (draft: FormDraft, preview: InvoicePreview) => once("send", async () => {
    const sealed = { invoiceId: preview.invoiceId, expectedTotalPence: preview.expectedTotalPence, reviewKey: preview.reviewKey };
    const result = await sendInvoice({ ...draft, ...sealed });
    if (result.ok) return go(INVOICES);
    if (TO_LIST.includes(result.error)) return go(`${INVOICES}?notice=${result.error}`);
    if (REVIEW_AGAIN.includes(result.error)) return askReview(draft, result.message, "review");
    if (result.fields) {
      onFormRefusal(result);
      return setState((s) => ({ ...s, step: "form", notice: null }));
    }
    setState((s) => ({ ...s, notice: result.message }));
  });

  const saveSetup = (draft: FormDraft, input: BusinessPageInput) => once("setup", async () => {
    const result = await saveBusinessSettings(input);
    if (result.ok) return askReview(draft, null, "review");
    if (result.error === "stale") return askReview(draft, result.message, "review");
    setState((s) => ({ ...s, notice: result.message, setupIssues: result.fields ?? {} }));
  });

  return {
    state,
    pending,
    review: (draft: FormDraft) => once("review", () => askReview(draft, null, "form")),
    send: () => (state.draft && state.preview ? send(state.draft, state.preview) : undefined),
    saveSetup: (input: BusinessPageInput) => (state.draft ? saveSetup(state.draft, input) : undefined),
    back: () => setState((s) => ({ ...s, step: "form", notice: null })),
  };
}
