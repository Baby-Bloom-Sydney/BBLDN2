"use client";

/**
 * The search box and its results, shared by the parent's address dialog and the nanny's inline address field
 * (06b-3 rework, ledger B06 §9.1 R2). Results are buttons: Tab or the arrow keys move through them, Escape closes
 * them and returns to the box.
 *
 * Review round 1: `inline` puts the results in the page's flow (a Settings card is `overflow-hidden`, which clipped an
 * overlay to a sliver: code H1, a11y C1, React H1); Enter in the box never submits the page around it (TS M3, React
 * M1); the results close when focus leaves the box and its list (a11y M1); a focused result is ringed (a11y M5).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { type FocusEvent, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  readonly required?: boolean;
  /** Results in the page's flow (inside a card) instead of floating over it (inside a dialog). */
  readonly inline?: boolean;
  /** She typed (the parent's dialog drops its pick). */
  readonly onType?: () => void;
}

const PLACEHOLDER = "Start typing your address…";

export function AddressSearchInput({ id, search, onPick, disabled, autoFocus, describedBy, invalid, required, inline = false, onType }: AddressSearchInputProps) {
  const options = () => [...(search.dropdownRef.current?.querySelectorAll<HTMLButtonElement>("[data-address-option]") ?? [])];
  const input = () => document.getElementById(id);
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault(); // a search box: Enter never submits the page
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
  const onLeave = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && search.dropdownRef.current?.contains(next)) return;
    if (next !== null) search.setShowDropdown(false);
  };
  return (
    <div className="relative" ref={search.dropdownRef} onBlur={onLeave}>
      <Input id={id} placeholder={PLACEHOLDER} value={search.query} onChange={(e) => { onType?.(); search.onChange(e.target.value); }}
        onFocus={() => { if (search.results.length > 0) search.setShowDropdown(true); }} onKeyDown={onFieldKey}
        disabled={disabled} autoComplete="off" autoFocus={autoFocus} aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined} aria-required={required ? true : undefined}
        className="aria-[invalid=true]:border-rose-600 aria-[invalid=true]:focus-visible:ring-rose-600" />
      {search.loading && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />}
      {search.showDropdown && (
        <div className={cn("mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white", inline ? "" : "absolute z-50 shadow-lg")}>
          {search.results.map((r, i) => (
            <button key={r.pid} type="button" data-address-option onClick={() => onPick(r)} onKeyDown={onOptionKey(i)}
              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 focus-visible:bg-violet-50 focus-visible:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-600">
              {toTitleCase(r.ssla || r.sla)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
