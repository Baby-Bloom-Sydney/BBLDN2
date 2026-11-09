"use client";

/**
 * Her address, edited in place (06b-3 rework, ledger B06 §9.1 R2; brief 06 §0b 2): the address on file shown in
 * full, and the picker's search under it to choose another — UK addresses, served London districts only. The
 * current address stays until she picks another; a pick gives her whole address, stored as verification stores it
 * (`homeFromParsed`). Used by the nanny's Profile and Business pages (parent Settings keeps the dialog for now).
 *
 * Review round 1: the results sit in the page's flow (a card clipped an overlay); after a pick, focus is back in the
 * box and the address shown is announced (`aria-live`); a search that finds nothing says so; outside the area is an
 * alert; the box is named for what it does ("Address, search for another") and can be marked required.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { Label } from "@/components/ui/label";
import { homeFromParsed, homeLines, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { AddressSearchInput } from "./AddressSearchInput";
import { NONE_FOUND, NOT_IN_AREA, useAddressSearch, type AddressApiResult } from "./useAddressSearch";
import { NOT_ADDED } from "./ValueLines";

export interface AddressSearchFieldProps {
  readonly id: string;
  readonly value: HomeAddress | null;
  readonly onPick: (home: HomeAddress) => void;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
}

export function AddressSearchField({ id, value, onPick, error, disabled, required }: AddressSearchFieldProps) {
  const search = useAddressSearch("");
  const lines = homeLines(value);
  const describedBy = [`${id}-current`, error ? `${id}-error` : null].filter((x) => x !== null).join(" ");
  const choose = (result: AddressApiResult) => {
    const parsed = search.pick(result);
    if (parsed === null) return;
    search.reset("");
    onPick(homeFromParsed(parsed));
    document.getElementById(id)?.focus();
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>
          Address<span className="sr-only">, search for another</span>
        </Label>
        <span className="text-[10px] text-slate-500">London only</span>
      </div>
      <div id={`${id}-current`} aria-live="polite" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
        {lines.length > 0 ? lines.map((line) => <span key={line} className="block break-words">{line}</span>) : <span className="italic text-slate-500">{NOT_ADDED}</span>}
      </div>
      <AddressSearchInput id={id} search={search} onPick={choose} disabled={disabled} describedBy={describedBy}
        invalid={error !== undefined} required={required} inline />
      {search.found === 0 && !search.loading && <p role="status" className="text-xs text-slate-500">{NONE_FOUND}</p>}
      {search.notInArea && <p role="alert" className="text-xs text-amber-700">{NOT_IN_AREA}</p>}
      {error && <p id={`${id}-error`} className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
