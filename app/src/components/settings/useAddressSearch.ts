"use client";

/**
 * The address search behind Settings' address fields (06b-3 rework, ledger B06 §9.1 R2), extracted from
 * `AddressPickerDialog` (parent Settings) so the nanny's inline field (`AddressSearchField`) searches the same way:
 *
 * - UK addresses from `/api/address-search` (≥ 4 characters, debounced), at most 8 offered;
 * - only a postcode in a served London district is taken (`/api/london-districts`); another shows "outside our
 *   service area". Until the districts load, any parsed address is taken (as before);
 * - no free typing: an address is only ever picked from the results.
 * Review round 1: a slower earlier answer never replaces a newer one; the timer stops when the field goes; how many
 * addresses the last search found is kept, so "No addresses found" can be said.
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
  /** How many addresses the last finished search found; null before one has finished (or after a pick). */
  readonly found: number | null;
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
    let live = true;
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((data: unknown) => {
        if (live && Array.isArray(data)) setServed(new Set(data.map((d: { prefix: string }) => d.prefix)));
      })
      .catch(() => undefined);
    return () => { live = false; };
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

interface Setters {
  readonly setResults: (r: readonly AddressApiResult[]) => void;
  readonly setShowDropdown: (s: boolean) => void;
  readonly setLoading: (l: boolean) => void;
  readonly setFound: (n: number | null) => void;
}

async function fetchAddresses(q: string): Promise<AddressApiResult[]> {
  try {
    const res = await fetch(`/api/address-search?q=${encodeURIComponent(q)}`);
    const body: unknown = res.ok ? await res.json() : [];
    return Array.isArray(body) ? (body as AddressApiResult[]) : [];
  } catch {
    return [];
  }
}

/** The debounced search: only the newest request's answer is shown; the timer stops on unmount. */
function useSearch({ setResults, setShowDropdown, setLoading, setFound }: Setters) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  return useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const ticket = ++latest.current;
    if (q.trim().length < MIN_CHARS) {
      setResults([]); setShowDropdown(false); setFound(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const data = await fetchAddresses(q);
      if (ticket !== latest.current) return;
      setLoading(false);
      setResults(data.slice(0, MAX_RESULTS));
      setShowDropdown(data.length > 0);
      setFound(Math.min(data.length, MAX_RESULTS));
    }, DEBOUNCE_MS);
  }, [setResults, setShowDropdown, setLoading, setFound]);
}

export function useAddressSearch(initialQuery = ""): AddressSearch {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<readonly AddressApiResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const [found, setFound] = useState<number | null>(null);
  const served = useServedPrefixes();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setShowDropdown(false), []);
  useCloseOnOutside(dropdownRef, close);
  const search = useSearch({ setResults, setShowDropdown, setLoading, setFound });

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
    setFound(null);
    return parsed;
  }, [served]);

  const reset = useCallback((q: string) => {
    setQuery(q); setResults([]); setShowDropdown(false); setNotInArea(false); setFound(null);
  }, []);

  return { query, results, showDropdown, loading, notInArea, found, dropdownRef, setShowDropdown, setQuery, onChange, pick, reset };
}

/** The message for an address outside the served area (unchanged). */
export const NOT_IN_AREA = "That address is outside our service area. We currently only operate in Greater London.";
/** A finished search that found nothing (review round 1, a11y M2). */
export const NONE_FOUND = "No addresses found";
