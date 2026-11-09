/**
 * The store's row and reply shapes (plan 06 step 6): zod schemas that parse what amendment 21's tables and functions
 * return, and the camelCase values the rest of the feature uses. Pure: no I/O. A row or reply that doesn't fit is
 * never silently dropped or guessed — the caller fails the whole read (the 02 `mapRows` rule).
 *
 * Her bank details are bank fields only (plan 14.4: the trading name and address moved to her business details);
 * a created invoice carries its money parts, VAT, issuer snapshot and lines (`store-map-lines.ts`).
 *
 * 06b-3 rework (ledger B06 §9.1 R1, R3): a bank save's reply carries the version now stored, exactly as the database
 * sent it (it goes back with her next save); her own Settings page reads her full details and that version.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { z } from "zod";
import type { DetailMasks } from "./masking";
import { isInvoiceNumber } from "./numbering";
import {
  hoursValue,
  instant,
  lineRow,
  linesInOrder,
  londonDate,
  pence,
  printedAddress,
  printedLine,
  singleRate,
  version,
  type StoredLine,
} from "./store-map-lines";
import {
  BUSINESS_TYPE_KEYS,
  CANCEL_REASONS,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  LINE_KINDS,
  VAT_MODES,
  type BusinessType,
  type CancelReason,
  type InvoiceKind,
  type InvoiceStatus,
  type VatMode,
} from "./types";

/** What a screen may read of her details: the generated masks, never the full numbers (brief §0.2). */
export const MASK_COLUMNS = "account_name, sort_code_last2, account_last4, updated_at";
/** The PDF's read: the full numbers (brief D12: the PDF is the one place they appear). */
export const FULL_COLUMNS = "account_name, sort_code, account_number, account_last4";
/** Her own Settings page (06b-3 rework R3): her full details, shown to her only, and the version a save sends back. */
export const SETTINGS_BANK_COLUMNS = "account_name, sort_code, account_number, updated_at";
/** 07's week reader: no email, bank or PDF field leaves (pdf_path is read only to re-check R1). */
export const WEEK_COLUMNS = "id, invoice_seq, invoice_number, nanny_id, nanny_name, hours, status, pdf_path, sent_at";
/** The family readers: no email, bank, issuer or PDF field leaves; the lines' kinds and rates give 07 its rate (14.7). */
export const FAMILY_COLUMNS =
  "id, invoice_seq, invoice_number, nanny_id, nanny_name, kind, period_start, hours, shifts_pence, expenses_pence, vat_pence, " +
  "total_pence, status, pdf_path, sent_at, cancelled_at, cancel_reason, replaces_invoice_id, nanny_invoice_lines(kind, rate_pence)";

const id = z.string().min(1);
const hours = hoursValue;
const seq = z.number().int().positive();
/** BB-<name>-<YYMMDD>-<seq>, as the database stored it (BAI 2026-11-04). */
const invoiceNumber = z.string().refine(isInvoiceNumber);
const last2 = z.string().regex(/^\d{2}$/);
const last4 = z.string().regex(/^\d{4}$/);

export interface MaskedPaymentDetails extends DetailMasks {
  readonly accountName: string;
  readonly updatedAt: string;
}

export interface StoredPaymentDetails {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
  readonly accountLast4: string;
}

/** Who she was on this invoice, fixed when it was created (plan 14.4): what its PDF prints. */
export interface IssuerSnapshot {
  readonly businessType: BusinessType;
  readonly tradingName: string;
  readonly address: string;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vatNumber: string | null;
}

export interface SavedDetails {
  readonly firstSave: boolean;
  readonly changed: boolean;
  /** The version now stored, as the database sent it. */
  readonly updatedAt: string;
  readonly masks: DetailMasks;
}

/** Her bank details as her own Settings page shows them (06b-3 rework R3), with their version. */
export interface SettingsBankDetails {
  readonly accountName: string;
  readonly sortCode: string;
  readonly accountNumber: string;
  readonly updatedAt: string;
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
  readonly shiftsPence: number;
  readonly expensesPence: number;
  readonly vat: { readonly mode: VatMode; readonly rateBp: number | null; readonly pence: number };
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
  readonly issuer: IssuerSnapshot;
  readonly lines: readonly StoredLine[];
}

export interface WeekRow {
  readonly invoiceId: string;
  readonly seq: number;
  readonly number: string;
  readonly nannyId: string;
  readonly nannyName: string;
  readonly hours: number;
  readonly sentAt: string;
}

export interface FamilyRow {
  readonly invoiceId: string;
  readonly seq: number;
  readonly number: string;
  readonly nannyId: string;
  readonly nannyName: string;
  readonly kind: InvoiceKind;
  readonly periodStart: string;
  readonly hours: number;
  /** The single rate when every shift has it; null when the rates differ (14.7). */
  readonly ratePence: number | null;
  readonly shiftsPence: number;
  readonly expensesPence: number;
  readonly vatPence: number;
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
    updated_at: instant,
  })
  .transform((r): MaskedPaymentDetails => ({
    accountName: r.account_name,
    sortCodeLast2: r.sort_code_last2,
    accountLast4: r.account_last4,
    updatedAt: r.updated_at,
  }));

export const fullRow = z
  .object({
    account_name: z.string().min(1),
    sort_code: z.string().regex(/^\d{6}$/),
    account_number: z.string().regex(/^\d{8}$/),
    account_last4: last4,
  })
  .transform((r): StoredPaymentDetails => ({
    accountName: r.account_name,
    sortCode: r.sort_code,
    accountNumber: r.account_number,
    accountLast4: r.account_last4,
  }));

export const settingsBankRow = z
  .object({
    account_name: z.string().min(1),
    sort_code: z.string().regex(/^\d{6}$/),
    account_number: z.string().regex(/^\d{8}$/),
    updated_at: version,
  })
  .transform((r): SettingsBankDetails => ({
    accountName: r.account_name,
    sortCode: r.sort_code,
    accountNumber: r.account_number,
    updatedAt: r.updated_at,
  }));

export const savedReply = z
  .object({
    status: z.literal("saved"), first_save: z.boolean(), changed: z.boolean(), updated_at: version,
    sort_code_last2: last2, account_last4: last4,
  })
  .transform((r): SavedDetails => ({
    firstSave: r.first_save,
    changed: r.changed,
    updatedAt: r.updated_at,
    masks: { sortCodeLast2: r.sort_code_last2, accountLast4: r.account_last4 },
  }));

export const createdReply = z
  .object({
    status: z.literal("created"),
    invoice_id: id,
    invoice_seq: seq,
    invoice_number: invoiceNumber,
    invoice_status: z.literal("sending"), // a fresh create is always sending: anything else fails closed
    kind: z.enum(INVOICE_KINDS),
    placement_id: id.nullable(),
    connection_request_id: id.nullable(),
    period_start: londonDate,
    hours,
    shifts_pence: pence.positive(),
    expenses_pence: pence.nonnegative(),
    vat_mode: z.enum(VAT_MODES),
    vat_rate_bp: z.number().int().nullable(),
    vat_pence: pence.nonnegative(),
    total_pence: pence.positive(),
    parent_user_id: id,
    family_name: printedLine,
    family_email: z.string().min(1),
    nanny_name: printedLine,
    nanny_email: z.string().min(1),
    account_last4: last4,
    pdf_path: z.string().min(1),
    replaces_invoice_id: id.nullable(),
    replaces_number: invoiceNumber.nullable(),
    created_at: instant,
    business_type: z.enum(BUSINESS_TYPE_KEYS),
    issuer_trading_name: printedLine,
    issuer_address: printedAddress,
    company_name: printedLine.nullable(),
    company_number: z.string().nullable(),
    registered_office: printedAddress.nullable(),
    partnership_name: printedLine.nullable(),
    vat_number: z.string().nullable(),
    lines: z.array(lineRow).min(1), // every invoice has at least one shift
  })
  .transform((r): CreatedInvoice => ({
    invoiceId: r.invoice_id,
    seq: r.invoice_seq,
    number: r.invoice_number,
    status: r.invoice_status,
    kind: r.kind,
    placementId: r.placement_id,
    connectionRequestId: r.connection_request_id,
    periodStart: r.period_start,
    hours: r.hours,
    shiftsPence: r.shifts_pence,
    expensesPence: r.expenses_pence,
    vat: { mode: r.vat_mode, rateBp: r.vat_rate_bp, pence: r.vat_pence },
    totalPence: r.total_pence,
    parentUserId: r.parent_user_id,
    familyName: r.family_name,
    familyEmail: r.family_email,
    nannyName: r.nanny_name,
    nannyEmail: r.nanny_email,
    accountLast4: r.account_last4,
    pdfPath: r.pdf_path,
    replacesInvoiceId: r.replaces_invoice_id,
    replacesNumber: r.replaces_number,
    createdAt: r.created_at,
    issuer: {
      businessType: r.business_type,
      tradingName: r.issuer_trading_name,
      address: r.issuer_address,
      companyName: r.company_name,
      companyNumber: r.company_number,
      registeredOffice: r.registered_office,
      partnershipName: r.partnership_name,
      vatNumber: r.vat_number,
    },
    lines: linesInOrder(r.lines),
  }));

/** A refusal from amendment 21's functions (status codes only; a retry of an id answers in_progress / already_done). */
export const refusalReply = z.object({
  status: z.enum([
    "invalid", "future", "not_hers", "no_trial", "wrong_date", "no_details", "bad_replaces", "already_replaced", "no_contact",
    "nanny_inactive", "cap", "busy", "in_progress", "already_done", "already_failed", "not_found", "not_sending", "no_pdf",
    "no_address", "bad_lines", "changed", "stale",
  ]),
});

export const finishedReply = z.object({ status: z.enum(["sent", "failed"]) });

/** Both row kinds carry status and pdf_path so R1 is re-checked here, whatever the query asked for. */
export const weekRow = z.object({
  id,
  invoice_seq: seq,
  invoice_number: invoiceNumber,
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
  invoice_number: invoiceNumber,
  nanny_id: id,
  nanny_name: z.string(),
  kind: z.enum(INVOICE_KINDS),
  period_start: londonDate,
  hours,
  shifts_pence: pence,
  expenses_pence: pence,
  vat_pence: pence,
  total_pence: pence,
  nanny_invoice_lines: z.array(z.object({ kind: z.enum(LINE_KINDS), rate_pence: pence.positive().nullable() })),
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
  number: r.invoice_number,
  nannyId: r.nanny_id,
  nannyName: r.nanny_name,
  hours: r.hours,
  sentAt,
});

export const toFamilyRow = (r: z.output<typeof familyRow>, status: "sent" | "cancelled", sentAt: string): FamilyRow => ({
  invoiceId: r.id,
  seq: r.invoice_seq,
  number: r.invoice_number,
  nannyId: r.nanny_id,
  nannyName: r.nanny_name,
  kind: r.kind,
  periodStart: r.period_start,
  hours: r.hours,
  ratePence: singleRate(r.nanny_invoice_lines),
  shiftsPence: r.shifts_pence,
  expensesPence: r.expenses_pence,
  vatPence: r.vat_pence,
  totalPence: r.total_pence,
  status,
  sentAt,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  replacesInvoiceId: r.replaces_invoice_id,
});
