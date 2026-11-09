"use client";

/**
 * The search box and its results, shared by the parent's address dialog and the nanny's inline address field
 * (06b-3 rework, ledger B06 §9.1 R2). Results are buttons: Tab or the arrow keys move through them, Escape closes
 * them and returns to the box.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toTitleCase } from "@/lib/uk-contact";
import type { AddressApiResult, AddressSearch } from "./useAddressSearch";

export interface AddressSearchInputProps {
  readonly id: string;
  readonly search: AddressSearch;
  readonly onPick: (result: AddressApiResult) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly describedBy?: string;
  readonly invalid?: boolean;
  /** She typed (the parent's dialog drops its pick). */
  readonly onType?: () => void;
}

const PLACEHOLDER = "Start typing your address…";

export function AddressSearchInput({ id, search, onPick, disabled, autoFocus, describedBy, invalid, onType }: AddressSearchInputProps) {
  const options = () => [...(search.dropdownRef.current?.querySelectorAll<HTMLButtonElement>("[data-address-option]") ?? [])];
  const input = () => document.getElementById(id);
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && search.showDropdown) { e.preventDefault(); options()[0]?.focus(); }
    if (e.key === "Escape" && search.showDropdown) { e.preventDefault(); search.setShowDropdown(false); }
  };
  const onOptionKey = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const all = options();
    if (e.key === "ArrowDown") { e.preventDefault(); all[Math.min(index + 1, all.length - 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (index === 0 ? input() : all[index - 1])?.focus(); }
    // focus first: the box's focus handler reopens the list, so it closes after
    if (e.key === "Escape") { e.preventDefault(); input()?.focus(); search.setShowDropdown(false); }
  };
  return (
    <div className="relative" ref={search.dropdownRef}>
      <Input id={id} placeholder={PLACEHOLDER} value={search.query} onChange={(e) => { onType?.(); search.onChange(e.target.value); }}
        onFocus={() => { if (search.results.length > 0) search.setShowDropdown(true); }} onKeyDown={onFieldKey}
        disabled={disabled} autoComplete="off" autoFocus={autoFocus} aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className="aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus-visible:ring-rose-400" />
      {search.loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden="true" />}
      {search.showDropdown && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {search.results.map((r, i) => (
            <button key={r.pid} type="button" data-address-option onClick={() => onPick(r)} onKeyDown={onOptionKey(i)}
              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 focus-visible:bg-violet-50 focus-visible:text-violet-700 focus-visible:outline-none">
              {toTitleCase(r.ssla || r.sla)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
