"use client";

/**
 * One /admin/calls section (plan C3; brief §3 admin 1; BB-wave1-041126/04c1-build): its heading with a count, then
 * the rows as a table with a caption from `md` up and as a card list on phones (the `/admin/leads` split), or
 * "None right now." History has its own columns (`HistorySection`).
 */

import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_COPY } from "@/lib/calls/copy";
import type { CallRowView, HistoryRowView } from "@/lib/calls/dashboard";
import { FamilyButton, FamilyCell, LinksRow, NanniesCell, PositionCell, TagBadges, WhenCell, type RenderCallControl } from "./CallRowParts";

interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly count: number | null;
  readonly children: React.ReactNode;
}

const FRAME = "hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block";
const CARD = "rounded-lg border border-slate-200 bg-white p-4 shadow-sm";

function Section({ id, title, count, children }: SectionProps) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        {title}
        {count !== null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { readonly children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{children}</p>
);

interface RowsProps {
  readonly title: string;
  readonly rows: readonly CallRowView[];
  readonly onOpen: (parentUserId: string) => void;
  readonly renderCallControl: RenderCallControl;
}

function RowsTable({ title, rows, onOpen, renderCallControl }: RowsProps) {
  return (
    <div className={FRAME}>
      <Table>
        <TableCaption className="sr-only">{title}</TableCaption>
        <TableHeader>
          <TableRow>
            {[ADMIN_COPY.colWhen, ADMIN_COPY.colFamily, ADMIN_COPY.colPosition, ADMIN_COPY.colNannies, ADMIN_COPY.colLinks, ADMIN_COPY.colCall].map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} className="align-top">
              <TableCell className="min-w-[9rem]"><WhenCell row={row} /></TableCell>
              <TableCell className="min-w-[11rem]"><FamilyCell row={row} onOpen={() => onOpen(row.parentUserId)} /></TableCell>
              <TableCell className="min-w-[10rem]"><PositionCell position={row.position} /></TableCell>
              <TableCell><NanniesCell position={row.position} /></TableCell>
              <TableCell><LinksRow links={row.links} /></TableCell>
              <TableCell>{renderCallControl(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RowsCards({ title, rows, onOpen, renderCallControl }: RowsProps) {
  return (
    <ul aria-label={title} className="space-y-3 md:hidden">
      {rows.map((row) => (
        <li key={row.key} className={CARD}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <WhenCell row={row} />
            {renderCallControl(row)}
          </div>
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            <FamilyCell row={row} onOpen={() => onOpen(row.parentUserId)} />
            <PositionCell position={row.position} />
            {row.position && <NanniesCell position={row.position} />}
            <LinksRow links={row.links} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CallSection(props: RowsProps & { readonly id: string }) {
  return (
    <Section id={props.id} title={props.title} count={props.rows.length}>
      {props.rows.length === 0 ? (
        <Quiet>{ADMIN_COPY.sectionEmpty}</Quiet>
      ) : (
        <>
          <RowsTable {...props} />
          <RowsCards {...props} />
        </>
      )}
    </Section>
  );
}

interface HistoryProps {
  readonly rows: readonly HistoryRowView[] | null;
  readonly onOpen: (parentUserId: string) => void;
}

function HistoryTable({ rows, onOpen }: { readonly rows: readonly HistoryRowView[]; readonly onOpen: HistoryProps["onOpen"] }) {
  return (
    <div className={FRAME}>
      <Table>
        <TableCaption className="sr-only">{ADMIN_COPY.sectionHistory}</TableCaption>
        <TableHeader>
          <TableRow>
            {[ADMIN_COPY.colWhen, ADMIN_COPY.colFamily, ADMIN_COPY.colWhat, ADMIN_COPY.colNote, ADMIN_COPY.colBy].map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} className="align-top">
              <TableCell className="whitespace-nowrap text-slate-700">{r.when}</TableCell>
              <TableCell className="space-y-1">
                <FamilyButton name={r.name} onOpen={() => onOpen(r.parentUserId)} />
                <TagBadges tags={r.tags} />
              </TableCell>
              <TableCell className="text-slate-900">{r.what}</TableCell>
              <TableCell className="max-w-xs whitespace-pre-line text-slate-600">{r.note ?? "—"}</TableCell>
              <TableCell className="text-slate-600">{r.by ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HistoryCards({ rows, onOpen }: { readonly rows: readonly HistoryRowView[]; readonly onOpen: HistoryProps["onOpen"] }) {
  return (
    <ul aria-label={ADMIN_COPY.sectionHistory} className="space-y-3 md:hidden">
      {rows.map((r) => (
        <li key={r.key} className={CARD}>
          <p className="text-xs text-slate-500">{r.when}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <FamilyButton name={r.name} onOpen={() => onOpen(r.parentUserId)} />
            <TagBadges tags={r.tags} />
          </div>
          <p className="mt-1 text-sm text-slate-900">{r.what}</p>
          {r.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.note}</p>}
          {r.by && <p className="mt-1 text-xs text-slate-500">{`${ADMIN_COPY.by} ${r.by}`}</p>}
        </li>
      ))}
    </ul>
  );
}

export function HistorySection({ rows, onOpen }: HistoryProps) {
  return (
    <Section id="calls-history" title={ADMIN_COPY.sectionHistory} count={rows?.length ?? null}>
      {rows === null ? (
        <Quiet>{ADMIN_COPY.historyFailed}</Quiet>
      ) : rows.length === 0 ? (
        <Quiet>{ADMIN_COPY.sectionEmpty}</Quiet>
      ) : (
        <>
          <HistoryTable rows={rows} onOpen={onOpen} />
          <HistoryCards rows={rows} onOpen={onOpen} />
        </>
      )}
    </Section>
  );
}
