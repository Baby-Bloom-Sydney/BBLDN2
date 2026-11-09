"use client";

/**
 * The address search behind Settings' address fields (06b-3 rework, ledger B06 §9.1 R2), extracted unchanged from
 * `AddressPickerDialog` (parent Settings) so the nanny's inline field (`AddressSearchField`) searches the same way:
 *
 * - UK addresses from `/api/address-search` (≥ 4 characters, debounced), at most 8 offered;
 * - only a postcode in a served London district is taken (`/api/london-districts`); another shows "outside our
 *   service area". Until the districts load, any parsed address is taken (as before);
 * - no free typing: an address is only ever picked from the results.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09 (the logic moved from `AddressPickerDialog.tsx`, 2026-05).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { parseUkAddress, toServedPrefix, toTitleCase, type ParsedAddress } from "@/lib/uk-contact";

export interface AddressApiResult {
  readonly sla: string;
  readonly ssla?: string;
  readonly pid: string;
  readonly score: number;
}

export interface AddressSearch {
  readonly query: string;
  readonly results: readonly AddressApiResult[];
  readonly showDropdown: boolean;
  readonly loading: boolean;
  readonly notInArea: boolean;
  readonly dropdownRef: RefObject<HTMLDivElement>;
  readonly setShowDropdown: (show: boolean) => void;
  readonly setQuery: (query: string) => void;
  /** She typed: search again. */
  readonly onChange: (value: string) => void;
  /** She picked a result: the parsed address when it can be taken, else null (outside the area, or unreadable). */
  readonly pick: (result: AddressApiResult) => ParsedAddress | null;
  /** Back to a fresh search showing `query`. */
  readonly reset: (query: string) => void;
}

const MIN_CHARS = 4;
const DEBOUNCE_MS = 180;
const MAX_RESULTS = 8;

/** The served district prefixes; empty until they load (or if they can't). */
function useServedPrefixes(): ReadonlySet<string> {
  const [served, setServed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((data: { district: string; prefix: string; label: string }[]) => setServed(new Set(data.map((d) => d.prefix))))
      .catch(() => undefined);
  }, []);
  return served;
}

/** A tap outside the field and its results closes them. */
function useCloseOnOutside(ref: RefObject<HTMLDivElement>, close: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, close]);
}

export function useAddressSearch(initialQuery = ""): AddressSearch {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<readonly AddressApiResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const served = useServedPrefixes();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setShowDropdown(false), []);
  useCloseOnOutside(dropdownRef, close);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < MIN_CHARS) { setResults([]); setShowDropdown(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/address-search?q=${encodeURIComponent(q)}`);
        const data: AddressApiResult[] = res.ok ? await res.json() : [];
        setResults(data.slice(0, MAX_RESULTS));
        setShowDropdown(data.length > 0);
      } catch {
        setResults([]);
        setShowDropdown(false);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const onChange = useCallback((value: string) => { setQuery(value); setNotInArea(false); search(value); }, [search]);

  const pick = useCallback((result: AddressApiResult): ParsedAddress | null => {
    const parsed = parseUkAddress(result.ssla || result.sla);
    setShowDropdown(false);
    if (!parsed) return null;
    if (served.size > 0 && toServedPrefix(parsed.postcode, served) === null) {
      setNotInArea(true);
      setQuery(toTitleCase(result.ssla || result.sla));
      return null;
    }
    setResults([]);
    setNotInArea(false);
    return parsed;
  }, [served]);

  const reset = useCallback((q: string) => {
    setQuery(q); setResults([]); setShowDropdown(false); setNotInArea(false);
  }, []);

  return { query, results, showDropdown, loading, notInArea, dropdownRef, setShowDropdown, setQuery, onChange, pick, reset };
}

/** The message for an address outside the served area (unchanged). */
export const NOT_IN_AREA = "That address is outside our service area. We currently only operate in Greater London.";
