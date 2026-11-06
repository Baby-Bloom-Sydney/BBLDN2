"use client";

/**
 * Blocks on the Calendar tab (plan C5; brief §3 admin 5, §0.12, §9.12; BB-wave1-041126/04c2-build): add a block with
 * a reason — native date and time inputs, sent as typed and read as London clock time on the server, never in the
 * browser's zone — and remove one (LDN1 never built removal). A booked call under a block stays booked and is tagged
 * "Blocked over — move or cancel" on the Calls tab (ADR-077: never cancelled). The list is the blocks still to come,
 * soonest first. One save at a time across add and remove.
 *
 * Review round 1 (React M3, M4, L4): every field is marked required; nothing is disabled while saving (the buttons are
 * `aria-disabled`), and after a block is removed — its button gone — focus goes to the Blocks heading.
 */

import { useId, useRef, useState, type RefObject } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BlockRow } from "@/lib/calls/calendar";
import { BLOCK_REASON_MAX } from "@/lib/calls/calendar-limits";
import { ADMIN_COPY } from "@/lib/calls/copy";
import { ACTION_BUTTON, AlertLine, QUIET_BUTTON } from "../cohorts/parts";
import { addCallBlockAction, removeCallBlockAction } from "./actions";
import { BUSY_LOOK, useCalendarSave, type CalendarSave } from "./use-calendar-save";

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly type: "date" | "time" | "text";
  readonly value: string;
  readonly onChange: (v: string) => void;
}

function Field({ id, label, type, value, onChange }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} aria-required="true" step={type === "time" ? 60 : undefined} maxLength={type === "text" ? BLOCK_REASON_MAX : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** The add form's fields; the To date follows the From date so it is never left before it. */
function useBlockFields(defaultDate: string) {
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [reason, setReason] = useState("");
  const moveFrom = (date: string) => {
    setFromDate(date);
    setToDate((to) => (date !== "" && (to === "" || to < date) ? date : to));
  };
  const clear = () => {
    setFromTime("");
    setToTime("");
    setReason("");
  };
  return { values: { fromDate, fromTime, toDate, toTime, reason }, setFromDate: moveFrom, setFromTime, setToDate, setToTime, setReason, clear };
}

function AddBlock({ defaultDate, save }: { readonly defaultDate: string; readonly save: CalendarSave }) {
  const id = useId();
  const f = useBlockFields(defaultDate);
  const add = async () => {
    const added = await save.run(() => addCallBlockAction(f.values), ADMIN_COPY.blockAdded);
    if (added !== null) f.clear();
  };
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Field id={`${id}-fd`} label={ADMIN_COPY.blockFromDate} type="date" value={f.values.fromDate} onChange={f.setFromDate} />
      <Field id={`${id}-ft`} label={ADMIN_COPY.blockFromTime} type="time" value={f.values.fromTime} onChange={f.setFromTime} />
      <Field id={`${id}-td`} label={ADMIN_COPY.blockToDate} type="date" value={f.values.toDate} onChange={f.setToDate} />
      <Field id={`${id}-tt`} label={ADMIN_COPY.blockToTime} type="time" value={f.values.toTime} onChange={f.setToTime} />
      <div className="sm:col-span-2">
        <Field id={`${id}-r`} label={ADMIN_COPY.blockReason} type="text" value={f.values.reason} onChange={f.setReason} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={`${ACTION_BUTTON} ${BUSY_LOOK}`} aria-disabled={save.saving}>
          {save.saving ? ADMIN_COPY.saving : ADMIN_COPY.addBlock}
        </button>
      </div>
    </form>
  );
}

function BlockList({ blocks, save, afterRemove }: { readonly blocks: readonly BlockRow[]; readonly save: CalendarSave; readonly afterRemove: RefObject<HTMLHeadingElement> }) {
  if (blocks.length === 0) return <p className="text-sm text-slate-500">{ADMIN_COPY.noBlocks}</p>;
  const remove = async (blockId: string) => {
    const removed = await save.run(() => removeCallBlockAction({ blockId }), ADMIN_COPY.blockRemoved);
    if (removed !== null) afterRemove.current?.focus();
  };
  return (
    <ul aria-label={ADMIN_COPY.blocksAhead} className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {blocks.map((block) => (
        <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="min-w-0 break-words text-sm text-slate-700">{`${block.when} · ${block.reason}`}</p>
          <button
            type="button"
            className={`${QUIET_BUTTON} ${BUSY_LOOK}`}
            aria-label={`${ADMIN_COPY.removeBlock} block: ${block.when}, ${block.reason}`}
            aria-disabled={save.saving}
            onClick={() => void remove(block.id)}
          >
            {ADMIN_COPY.removeBlock}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BlocksForm({ blocks, defaultDate }: { readonly blocks: readonly BlockRow[]; readonly defaultDate: string }) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const save = useCalendarSave(ADMIN_COPY.blockInvalid);
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <h2 ref={headingRef} id={id} tabIndex={-1} className="text-base font-semibold text-slate-900 focus:outline-none">
            {ADMIN_COPY.blocksHeading}
          </h2>
          <p className="text-xs text-slate-500">{ADMIN_COPY.blocksHint}</p>
          <AddBlock defaultDate={defaultDate} save={save} />
          {save.error && <AlertLine>{save.error}</AlertLine>}
          <p role="status" className="text-sm text-slate-600">
            {save.status}
          </p>
          <BlockList blocks={blocks} save={save} afterRemove={headingRef} />
        </CardContent>
      </Card>
    </section>
  );
}
