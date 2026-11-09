"use client";

/**
 * Address picker dialog for parent Settings. Mirrors the GNAF-style autocomplete used in nanny verification and
 * onboarding so a user who verified their address sees the same search here.
 *
 * Key invariants:
 *   - Only addresses parseable as UK addresses are offered.
 *   - The selection is rejected unless its postcode resolves to a served London district (sourced from
 *     /api/london-districts).
 *   - It hands the caller the parsed address (street line, second line, town, postcode); what is stored is the
 *     caller's choice (parent Settings stores the town and postcode).
 *
 * No manual override path: typed addresses that don't match any result can't be saved. This is deliberate — manual
 * entry was producing inconsistent suburb/postcode pairs that broke matching.
 *
 * 06b-3 rework (ledger B06 §9.1 R2, 2026-11-09): the search moved to `useAddressSearch` + `AddressSearchInput`, shared
 * with the nanny's inline `AddressSearchField`; this dialog keeps wrapping it, behaving as before (small text darker).
 */

import { useEffect, useState, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ParsedAddress } from "@/lib/uk-contact";
import { AddressSearchInput } from "./AddressSearchInput";
import { NOT_IN_AREA, useAddressSearch, type AddressApiResult } from "./useAddressSearch";

interface AddressPickerDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Current saved suburb (for display + initial query). */
  currentSuburb: string;
  /** Current saved postcode (for display + service-area initial check). */
  currentPostcode: string;
  /** Saves the new address. Receives the parsed address.
   *  Return `{ success: false, error }` to surface the error inline. */
  onSubmit: (address: ParsedAddress) => Promise<{ success: boolean; error?: string | null }>;
}

export function AddressPickerDialog({ open, onOpenChange, currentSuburb, currentPostcode, onSubmit }: AddressPickerDialogProps) {
  const initialQuery = currentSuburb ? `${currentSuburb}${currentPostcode ? ` ${currentPostcode}` : ""}` : "";
  const search = useAddressSearch(initialQuery);
  const [selected, setSelected] = useState<ParsedAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  // Reset internal state when the dialog opens fresh.
  useEffect(() => {
    if (open) {
      search.reset(initialQuery);
      setSelected(null);
      setError(null);
    }
    // initialQuery is derived from props that are stable while open; depending on `open` is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSelect(result: AddressApiResult) {
    const parsed = search.pick(result);
    setSelected(parsed);
    if (parsed) search.setQuery(`${parsed.town} ${parsed.postcode}`);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || isSaving) return;
    setError(null);
    startSaving(async () => {
      const r = await onSubmit(selected);
      if (!r.success) {
        setError(r.error ?? "Couldn't save address.");
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit address</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="address-search">Address</Label>
              <span className="text-[10px] text-slate-500">London only</span>
            </div>
            <AddressSearchInput id="address-search" search={search} onPick={onSelect} disabled={isSaving} autoFocus
              onType={() => setSelected(null)} />
            {selected && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check className="h-3 w-3" />
                {selected.town} {selected.postcode}
              </p>
            )}
            {search.notInArea && <p className="mt-1 text-xs text-amber-700">{NOT_IN_AREA}</p>}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selected || isSaving} className="bg-violet-600 text-white hover:bg-violet-700">
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
