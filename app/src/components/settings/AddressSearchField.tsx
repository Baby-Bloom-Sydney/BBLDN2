"use client";

/**
 * Her address, edited in place (06b-3 rework, ledger B06 §9.1 R2; brief 06 §0b 2): the address on file shown in
 * full, and the picker's search under it to choose another — UK addresses, served London districts only. The
 * current address stays until she picks another; a pick gives her whole address, stored as verification stores it
 * (`homeFromParsed`). Used by the nanny's Profile and Business pages (parent Settings keeps the dialog for now).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { Label } from "@/components/ui/label";
import { homeFromParsed, homeLines, type HomeAddress } from "@/lib/settings/nanny-profile-rules";
import { AddressSearchInput } from "./AddressSearchInput";
import { NOT_IN_AREA, useAddressSearch, type AddressApiResult } from "./useAddressSearch";

export interface AddressSearchFieldProps {
  readonly id: string;
  readonly value: HomeAddress | null;
  readonly onPick: (home: HomeAddress) => void;
  readonly error?: string;
  readonly disabled?: boolean;
}

export const NOT_ADDED = "Not added";

export function AddressSearchField({ id, value, onPick, error, disabled }: AddressSearchFieldProps) {
  const search = useAddressSearch("");
  const lines = homeLines(value);
  const describedBy = [`${id}-current`, error ? `${id}-error` : null].filter((x) => x !== null).join(" ");
  const choose = (result: AddressApiResult) => {
    const parsed = search.pick(result);
    if (parsed === null) return;
    search.reset("");
    onPick(homeFromParsed(parsed));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>Address</Label>
        <span className="text-[10px] text-slate-500">London only</span>
      </div>
      <div id={`${id}-current`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
        {lines.length > 0 ? lines.map((line) => <span key={line} className="block break-words">{line}</span>) : <span className="italic text-slate-500">{NOT_ADDED}</span>}
      </div>
      <AddressSearchInput id={id} search={search} onPick={choose} disabled={disabled} describedBy={describedBy} invalid={error !== undefined} />
      {search.notInArea && <p className="text-xs text-amber-700">{NOT_IN_AREA}</p>}
      {error && <p id={`${id}-error`} className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
