"use client";

/**
 * `/admin/invoices`, client half (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin 2–3; A14). Follows `/admin/guarantees`
 * (`GuaranteesClient`): a card per block, a table that scrolls inside its card on a narrow screen.
 *
 * - **Filters** — family, nanny, kind ("Hired" / "Trial"), status — narrow the rows already read (the newest 500),
 *   together; a live line counts what's shown.
 * - **By family:** every family's summary line (07's `summarise()`), or the chosen family's only.
 * - **The table:** the number with its kind and period, family, nanny, hours, the total with "incl. £x expenses" and the
 *   VAT mode, the status with its reason and "Replaces …" / "Replaced by …", both recipients' deliveries, and "View
 *   PDF" (a new tab, through `/admin/invoices/<id>/pdf`).
 * - **Read-only:** no button and no field but the filters — nothing creates, edits, cancels or resends (brief §3 admin 3).
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */

import { useId, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, type AdminFamily, type AdminInvoiceRow, type AdminInvoicesView } from "./types";

export interface AdminInvoicesClientProps extends AdminInvoicesView {
  readonly loadFailed: boolean;
}

const ALL = "";
interface Filters {
  readonly family: string;
  readonly nanny: string;
  readonly kind: string;
  readonly status: string;
}
const NO_FILTER: Filters = { family: ALL, nanny: ALL, kind: ALL, status: ALL };

interface Choice {
  readonly value: string;
  readonly label: string;
}
const choices = (labels: Readonly<Record<string, string>>): readonly Choice[] => Object.entries(labels).map(([value, label]) => ({ value, label }));
const KIND_CHOICES = choices(INVOICE_KIND_LABELS);
const STATUS_CHOICES = choices(INVOICE_STATUS_LABELS);
const STATUS_TONE: Readonly<Record<AdminInvoiceRow["status"], string>> = { sent: "bg-green-50 text-green-700", cancelled: "bg-slate-100 text-slate-600" };

const matches = (row: AdminInvoiceRow, f: Filters): boolean =>
  (f.family === ALL || row.familyKey === f.family) &&
  (f.nanny === ALL || row.nannyKey === f.nanny) &&
  (f.kind === ALL || row.kind === f.kind) &&
  (f.status === ALL || row.status === f.status);

const plural = (n: number): string => `${n} ${n === 1 ? "invoice" : "invoices"}`;

function FilterSelect({ label, all, value, options, onChange }: {
  readonly label: string;
  readonly all: string;
  readonly value: string;
  readonly options: readonly Choice[];
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-white px-3 text-base text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 md:text-sm">
        <option value={ALL}>{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function FilterBar({ view, filters, set }: { readonly view: AdminInvoicesView; readonly filters: Filters; readonly set: (patch: Partial<Filters>) => void }) {
  const named = (list: readonly { readonly key: string; readonly name: string }[]): readonly Choice[] => list.map((x) => ({ value: x.key, label: x.name }));
  return (
    <fieldset>
      <legend className="sr-only">Filter invoices</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect label="Family" all="All families" value={filters.family} options={named(view.families)} onChange={(family) => set({ family })} />
        <FilterSelect label="Nanny" all="All nannies" value={filters.nanny} options={named(view.nannies)} onChange={(nanny) => set({ nanny })} />
        <FilterSelect label="Kind" all="All kinds" value={filters.kind} options={KIND_CHOICES} onChange={(kind) => set({ kind })} />
        <FilterSelect label="Status" all="All statuses" value={filters.status} options={STATUS_CHOICES} onChange={(status) => set({ status })} />
      </div>
    </fieldset>
  );
}

function FamilySummaries({ families }: { readonly families: readonly AdminFamily[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardContent className="p-5">
          <h2 id={headingId} className="text-base font-semibold text-slate-900">By family</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {families.map((f) => (
              <li key={f.key} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <span className="font-medium text-slate-900">{f.name}</span>
                <span className="tabular-nums text-slate-600">{f.summary}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

function StatusCell({ row }: { readonly row: AdminInvoiceRow }) {
  return (
    <td className="px-4 py-3">
      <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[row.status])}>{row.statusLabel}</span>
      {row.replacesNumber && <span className="mt-1 block text-xs text-slate-500">{`Replaces ${row.replacesNumber}`}</span>}
      {row.replacedByNumber && <span className="mt-1 block text-xs text-slate-500">{`Replaced by ${row.replacedByNumber}`}</span>}
      <ul className="mt-1 space-y-0.5 text-xs">
        {row.deliveries.map((d) => (
          <li key={d.text} className={d.delivered ? "text-slate-500" : "font-medium text-amber-700"}>{d.text}</li>
        ))}
      </ul>
    </td>
  );
}

function InvoiceRow({ row }: { readonly row: AdminInvoiceRow }) {
  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <span className="block whitespace-nowrap font-mono text-xs text-slate-900">{row.number}</span>
        <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">{`${row.kindLabel} · ${row.period}`}</span>
      </th>
      <td className="px-4 py-3 font-medium text-slate-900">{row.familyName}</td>
      <td className="px-4 py-3 text-slate-700">{row.nannyName}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.hours}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
        <span className="block font-semibold text-slate-900">{row.total}</span>
        {row.expenses && <span className="block text-xs text-slate-500">{row.expenses}</span>}
        <span className="block text-xs text-slate-500">{row.vat}</span>
      </td>
      <StatusCell row={row} />
      <td className="whitespace-nowrap px-4 py-3">
        <a href={`/admin/invoices/${encodeURIComponent(row.invoiceId)}/pdf`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-violet-700 underline-offset-2 hover:text-violet-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <FileText className="h-4 w-4" aria-hidden="true" />
          View PDF{" "}<span className="sr-only">{`of ${row.number}`}</span>
        </a>
      </td>
    </tr>
  );
}

function InvoiceTable({ rows }: { readonly rows: readonly AdminInvoiceRow[] }) {
  if (rows.length === 0) {
    return <Card><CardContent className="p-5 text-sm text-slate-500">No invoices match these filters.</CardContent></Card>;
  }
  return (
    <Card>
      {/* scrolls inside its card on a narrow screen; focusable so the keyboard can scroll it too; `relative` keeps the
          screen-reader-only text (absolutely placed) inside the scroll box, so the page itself never scrolls sideways */}
      <CardContent className="relative overflow-x-auto p-0" tabIndex={0} role="region" aria-label="Invoices table">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <caption className="sr-only">Invoices, newest first</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {["Invoice", "Family", "Nanny", "Hours", "Total", "Status", "PDF"].map((h) => (
                <th key={h} scope="col" className={cn("px-4 py-2 font-medium", (h === "Hours" || h === "Total") && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map((r) => <InvoiceRow key={r.invoiceId} row={r} />)}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Notice({ text, alert = false }: { readonly text: string; readonly alert?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-slate-600">
        <p role={alert ? "alert" : undefined}>{text}</p>
      </CardContent>
    </Card>
  );
}

function Lists({ view }: { readonly view: AdminInvoicesView }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const shown = useMemo(() => view.rows.filter((r) => matches(r, filters)), [view.rows, filters]);
  const families = filters.family === ALL ? view.families : view.families.filter((f) => f.key === filters.family);
  return (
    <div className="space-y-6">
      <FilterBar view={view} filters={filters} set={(patch) => setFilters((f) => ({ ...f, ...patch }))} />
      <FamilySummaries families={families} />
      <p role="status" className="text-sm text-slate-500">{`Showing ${shown.length} of ${plural(view.rows.length)}`}</p>
      <InvoiceTable rows={shown} />
    </div>
  );
}

export function AdminInvoicesClient({ loadFailed, ...view }: AdminInvoicesClientProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every invoice nannies have sent, newest first. Read-only.
        {view.atLimit && ` Showing the newest ${view.rows.length} only.`}
      </p>
      <div className="mt-6">
        {loadFailed ? (
          <Notice text="The invoices could not be read — try again." alert />
        ) : view.rows.length === 0 ? (
          <Notice text="No invoices yet." />
        ) : (
          <Lists view={view} />
        )}
      </div>
    </div>
  );
}
