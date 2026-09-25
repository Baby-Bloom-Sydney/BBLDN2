"use client";

/**
 * Address picker for the settings flow. Mirrors the GNAF
 * autocomplete used in nanny verification + onboarding so a user
 * who previously verified their address sees the same UX here.
 *
 * Key invariants:
 *   - Only addresses parseable as UK addresses are offered.
 *   - The selection is rejected unless its postcode resolves to a
 *     served London district (sourced from /api/london-districts).
 *   - The dialog persists ONLY district + prefix — settings doesn't
 *     hold a street-line column for users.
 *
 * No manual override path: typed addresses that don't match any
 * GNAF result can't be saved. This is deliberate — manual entry
 * was producing inconsistent suburb/postcode pairs that broke
 * matching.
 */

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { Loader2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  parseUkAddress,
  toTitleCase,
  type ParsedAddress,
  toServedPrefix,
} from "@/lib/uk-contact";

interface AddressApiResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

interface AddressPickerDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Current saved suburb (for display + initial query). */
  currentSuburb: string;
  /** Current saved postcode (for display + service-area initial check). */
  currentPostcode: string;
  /** Saves the new address. Receives parsed suburb + postcode.
   *  Return `{ success: false, error }` to surface the error inline. */
  onSubmit: (
    address: ParsedAddress,
  ) => Promise<{ success: boolean; error?: string | null }>;
}

export function AddressPickerDialog({
  open,
  onOpenChange,
  currentSuburb,
  currentPostcode,
  onSubmit,
}: AddressPickerDialogProps) {
  const initialQuery = currentSuburb
    ? `${currentSuburb}${currentPostcode ? ` ${currentPostcode}` : ""}`
    : "";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AddressApiResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ParsedAddress | null>(null);
  const [notInArea, setNotInArea] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [servedPrefixes, setServedPrefixes] = useState<Set<string>>(
    new Set(),
  );

  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset internal state when the dialog opens fresh.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setResults([]);
      setShowDropdown(false);
      setSelected(null);
      setNotInArea(false);
      setError(null);
    }
    // initialQuery is derived from props that are stable while
    // open; depending on `open` is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((data: { district: string; prefix: string; label: string }[]) => {
        setServedPrefixes(new Set(data.map((d) => d.prefix)));
      })
      .catch(() => {
        // Service-area check fails closed when the API can't be
        // reached — every selection rejects "not in area" until
        // the postcodes load. Acceptable: better than allowing an
        // out-of-area suburb through silently.
      });
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const search = useCallback((q: string) => {
    if (q.trim().length < 4) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/address-search?q=${encodeURIComponent(q)}`,
        );
        if (!res.ok) {
          setResults([]);
          setShowDropdown(false);
          return;
        }
        const data: AddressApiResult[] = await res.json();
        // The route already filters to GB and emits the UK address shape,
        // so there is nothing left to filter here (12.01).
        setResults(data.slice(0, 8));
        setShowDropdown(data.length > 0);
      } catch {
        setResults([]);
        setShowDropdown(false);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, []);

  function onChange(val: string) {
    setQuery(val);
    setSelected(null);
    setNotInArea(false);
    search(val);
  }

  function onSelect(result: AddressApiResult) {
    const parsed = parseUkAddress(result.ssla || result.sla);
    if (!parsed) {
      setShowDropdown(false);
      return;
    }
    if (
      servedPrefixes.size > 0 &&
      toServedPrefix(parsed.postcode, servedPrefixes) === null
    ) {
      setNotInArea(true);
      setSelected(null);
      setQuery(toTitleCase(result.ssla || result.sla));
      setShowDropdown(false);
      return;
    }
    setQuery(`${parsed.town} ${parsed.postcode}`);
    setSelected(parsed);
    setShowDropdown(false);
    setResults([]);
    setNotInArea(false);
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
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="address-search">Address</Label>
              <span className="text-[10px] text-slate-400">
                London only
              </span>
            </div>
            <div className="relative" ref={dropdownRef}>
              <Input
                id="address-search"
                placeholder="Start typing your address…"
                value={query}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => {
                  if (results.length > 0) setShowDropdown(true);
                }}
                disabled={isSaving}
                autoComplete="off"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
              )}
              {showDropdown && (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {results.map((r) => (
                    <button
                      key={r.pid}
                      type="button"
                      onClick={() => onSelect(r)}
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {toTitleCase(r.ssla || r.sla)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selected && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600">
                <Check className="h-3 w-3" />
                {selected.town} {selected.postcode}
              </p>
            )}
            {notInArea && (
              <p className="mt-1 text-xs text-amber-600">
                That address is outside our service area. We currently only
                operate in Greater London.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selected || isSaving}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
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
