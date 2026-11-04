/**
 * The store's row and reply shapes (plan 06 step 6): zod schemas that parse what amendment 21's tables and functions
 * return, and the camelCase values the rest of the feature uses. Pure: no I/O. A row or reply that doesn't fit is
 * never silently dropped or guessed — the caller fails the whole read (the 02 `mapRows` rule).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import { z } from "zod";
import type { DetailMasks } from "./masking";
import { invoiceNumber } from "./numbering";
import { CANCEL_REASONS, INVOICE_KINDS, INVOICE_STATUSES, type CancelReason, type InvoiceKind, type InvoiceStatus } from "./types";
import { isLondonDate } from "./week";

/** What a screen may read of her details: the generated masks, never the full numbers (brief §0.2). */
export const MASK_COLUMNS = "account_name, sort_code_last2, account_last4, trading_name, invoice_address, updated_at";
/** The PDF's read: the full numbers (brief D12: the PDF is the one place they appear). */
export const FULL_COLUMNS = "account_name, sort_code, account_number, account_last4, trading_name, invoice_address";
/** 07's week reader: no email, bank or PDF field leaves (pdf_path is read only to re-check R1). */
export const WEEK_COLUMNS = "id, invoice_seq, nanny_id, nanny_name, hours, status, pdf_path, sent_at";
/** The family readers: no email, bank or PDF field leaves. */
export const FAMILY_COLUMNS =
  "id, invoice_seq, nanny_id, nanny_name, kind, period_start, hours, rate_pence, total_pence, status, pdf_path, sent_at, cancelled_at, cancel_reason, replaces_invoice_id";

const id = z.string().min(1);
const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v))).transform((v) => new Date(v).toISOString());
const londonDate = z.string().refine(isLondonDate);
/** `numeric(4,1)`: PostgREST may send a number or its text. */
const hours = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().positive().finite());
const pence = z.number().int();
const seq = z.number().int().positive();
const last2 = z.string().regex(/^\d{2}$/);
const last4 = z.string().regex(/^\d{4}$/);

export interface MaskedPaymentDetails extends DetailMasks {
  readonly accountName: string;
  readonly tradingName: string | null;
  readonly invoiceAddress: string | null;
  readonly updatedAt: string;
}

export interface StoredPaymentDetails {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
  readonly accountLast4: string;
  readonly tradingName: string | null;
  readonly invoiceAddress: string | null;
}

export interface SavedDetails {
  readonly firstSave: boolean;
  readonly changed: boolean;
  readonly masks: DetailMasks;
}

export interface CreatedInvoice {
  readonly invoiceId: string;
  readonly seq: number;
  readonly number: string;
  readonly status: InvoiceStatus;
  readonly kind: InvoiceKind;
  readonly placementId: string | null;
  readonly connectionRequestId: string | null;
  readonly periodStart: string;
  readonly hours: number;
  readonly ratePence: number;
  readonly totalPence: number;
  readonly parentUserId: string;
  readonly familyName: string;
  readonly familyEmail: string;
  readonly nannyName: string;
  readonly nannyEmail: string;
  readonly accountLast4: string;
  readonly pdfPath: string;
  readonly replacesInvoiceId: string | null;
  readonly replacesNumber: string | null;
  readonly createdAt: string;
}

export interface WeekRow {
  readonly invoiceId: string;
  readonly seq: number;
  readonly nannyId: string;
  readonly nannyName: string;
  readonly hours: number;
  readonly sentAt: string;
}

export interface FamilyRow {
  readonly invoiceId: string;
  readonly seq: number;
  readonly nannyId: string;
  readonly nannyName: string;
  readonly kind: InvoiceKind;
  readonly periodStart: string;
  readonly hours: number;
  readonly ratePence: number;
  readonly totalPence: number;
  readonly status: "sent" | "cancelled";
  readonly sentAt: string;
  readonly cancelledAt: string | null;
  readonly cancelReason: CancelReason | null;
  readonly replacesInvoiceId: string | null;
}

export const maskedRow = z
  .object({
    account_name: z.string().min(1),
    sort_code_last2: last2,
    account_last4: last4,
    trading_name: z.string().nullable(),
    invoice_address: z.string().nullable(),
    updated_at: instant,
  })
  .transform((r): MaskedPaymentDetails => ({
    accountName: r.account_name,
    sortCodeLast2: r.sort_code_last2,
    accountLast4: r.account_last4,
    tradingName: r.trading_name,
    invoiceAddress: r.invoice_address,
    updatedAt: r.updated_at,
  }));

export const fullRow = z
  .object({
    account_name: z.string().min(1),
    sort_code: z.string().regex(/^\d{6}$/),
    account_number: z.string().regex(/^\d{8}$/),
    account_last4: last4,
    trading_name: z.string().nullable(),
    invoice_address: z.string().nullable(),
  })
  .transform((r): StoredPaymentDetails => ({
    accountName: r.account_name,
    sortCode: r.sort_code,
    accountNumber: r.account_number,
    accountLast4: r.account_last4,
    tradingName: r.trading_name,
    invoiceAddress: r.invoice_address,
  }));

export const savedReply = z
  .object({ status: z.literal("saved"), first_save: z.boolean(), changed: z.boolean(), sort_code_last2: last2, account_last4: last4 })
  .transform((r): SavedDetails => ({
    firstSave: r.first_save,
    changed: r.changed,
    masks: { sortCodeLast2: r.sort_code_last2, accountLast4: r.account_last4 },
  }));

export const createdReply = z
  .object({
    status: z.literal("created"),
    invoice_id: id,
    invoice_seq: seq,
    invoice_status: z.literal("sending"), // a fresh create is always sending: anything else fails closed
    kind: z.enum(INVOICE_KINDS),
    placement_id: id.nullable(),
    connection_request_id: id.nullable(),
    period_start: londonDate,
    hours,
    rate_pence: pence.positive(),
    total_pence: pence.positive(),
    parent_user_id: id,
    family_name: z.string().min(1),
    family_email: z.string().min(1),
    nanny_name: z.string().min(1),
    nanny_email: z.string().min(1),
    account_last4: last4,
    pdf_path: z.string().min(1),
    replaces_invoice_id: id.nullable(),
    replaces_seq: seq.nullable(),
    created_at: instant,
  })
  .transform((r): CreatedInvoice => ({
    invoiceId: r.invoice_id,
    seq: r.invoice_seq,
    number: invoiceNumber(r.invoice_seq),
    status: r.invoice_status,
    kind: r.kind,
    placementId: r.placement_id,
    connectionRequestId: r.connection_request_id,
    periodStart: r.period_start,
    hours: r.hours,
    ratePence: r.rate_pence,
    totalPence: r.total_pence,
    parentUserId: r.parent_user_id,
    familyName: r.family_name,
    familyEmail: r.family_email,
    nannyName: r.nanny_name,
    nannyEmail: r.nanny_email,
    accountLast4: r.account_last4,
    pdfPath: r.pdf_path,
    replacesInvoiceId: r.replaces_invoice_id,
    replacesNumber: r.replaces_seq === null ? null : invoiceNumber(r.replaces_seq),
    createdAt: r.created_at,
  }));

/** A refusal from amendment 21's functions (status codes only; a retry of an id answers in_progress / already_done). */
export const refusalReply = z.object({
  status: z.enum([
    "invalid", "future", "not_hers", "no_trial", "wrong_date", "no_details", "bad_replaces", "already_replaced", "no_contact",
    "nanny_inactive", "cap", "busy", "in_progress", "already_done", "already_failed", "not_found", "not_sending", "no_pdf",
  ]),
});

export const finishedReply = z.object({ status: z.enum(["sent", "failed"]) });

/** Both row kinds carry status and pdf_path so R1 is re-checked here, whatever the query asked for. */
export const weekRow = z.object({
  id,
  invoice_seq: seq,
  nanny_id: id,
  nanny_name: z.string(),
  hours,
  status: z.enum(INVOICE_STATUSES),
  pdf_path: z.string().nullable(),
  sent_at: instant.nullable(),
});

/** The daily-cap count's rows (security M2: the database's own rule, re-told for 06b's screen). */
export const capRow = z.object({ id, status: z.enum(INVOICE_STATUSES), created_at: instant });

export const familyRow = z.object({
  id,
  invoice_seq: seq,
  nanny_id: id,
  nanny_name: z.string(),
  kind: z.enum(INVOICE_KINDS),
  period_start: londonDate,
  hours,
  rate_pence: pence,
  total_pence: pence,
  status: z.enum(INVOICE_STATUSES),
  pdf_path: z.string().nullable(),
  sent_at: instant.nullable(),
  cancelled_at: instant.nullable(),
  cancel_reason: z.enum(CANCEL_REASONS).nullable(),
  replaces_invoice_id: id.nullable(),
});

export const toWeekRow = (r: z.output<typeof weekRow>, sentAt: string): WeekRow => ({
  invoiceId: r.id,
  seq: r.invoice_seq,
  nannyId: r.nanny_id,
  nannyName: r.nanny_name,
  hours: r.hours,
  sentAt,
});

export const toFamilyRow = (r: z.output<typeof familyRow>, status: "sent" | "cancelled", sentAt: string): FamilyRow => ({
  invoiceId: r.id,
  seq: r.invoice_seq,
  nannyId: r.nanny_id,
  nannyName: r.nanny_name,
  kind: r.kind,
  periodStart: r.period_start,
  hours: r.hours,
  ratePence: r.rate_pence,
  totalPence: r.total_pence,
  status,
  sentAt,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  replacesInvoiceId: r.replaces_invoice_id,
});
