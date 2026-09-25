"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { TypeformFormData } from "../questions";

/** A row of `/api/london-districts` — district name, prefix, stored label. */
interface DistrictEntry {
  district: string;
  prefix: string;
  label: string;
}

// A prefix query like "E1" substring-matches SE1, E10, E11 … so an exact or
// leading prefix match has to outrank them, or the district the family typed
// never reaches the eight-row dropdown (ADR-188: prefixes are 2-4 characters,
// unlike the 4-digit postcode this replaced, where `includes` was harmless).
function rankDistrict(d: DistrictEntry, q: string): number {
  const prefix = d.prefix.toLowerCase();
  if (prefix === q) return 0;
  if (prefix.startsWith(q)) return 1;
  if (d.district.toLowerCase().startsWith(q)) return 2;
  return 3;
}

interface SuburbAutocompleteProps {
  data: Partial<TypeformFormData>;
  updateData: (d: Partial<TypeformFormData>) => void;
  onAdvance: () => void;
}

export function SuburbAutocomplete({
  data,
  updateData,
  onAdvance,
}: SuburbAutocompleteProps) {
  const [districts, setDistricts] = useState<DistrictEntry[]>([]);
  const [query, setQuery] = useState(
    data.suburb && data.postcode
      ? `${data.suburb}, ${data.postcode}`
      : data.suburb ?? ""
  );
  const [filtered, setFiltered] = useState<DistrictEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hasSelected, setHasSelected] = useState(!!data.suburb);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((d: DistrictEntry[]) => setDistricts(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    setHasSelected(false);
    if (val.trim().length >= 2) {
      const q = val.toLowerCase().trim();
      const matches = districts
        .filter(
          (d) =>
            d.district.toLowerCase().includes(q) ||
            d.prefix.toLowerCase().includes(q)
        )
        .sort(
          (a, b) =>
            rankDistrict(a, q) - rankDistrict(b, q) ||
            a.district.localeCompare(b.district)
        )
        .slice(0, 10);
      setFiltered(matches);
      setShowDropdown(matches.length > 0);
    } else {
      setFiltered([]);
      setShowDropdown(false);
    }
  };

  const handleSelect = (entry: DistrictEntry) => {
    setQuery(entry.label);
    setShowDropdown(false);
    setHasSelected(true);
    // ADR-188: the prefix is 2-4 alphanumerics ("SW4"), so it stays a string.
    updateData({
      suburb: entry.district,
      postcode: entry.prefix,
    });
  };

  return (
    <div className="flex flex-col gap-3" ref={dropdownRef}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            if (filtered.length > 0) setShowDropdown(true);
          }}
          placeholder="Start typing your area or postcode"
          className="w-full py-2.5 px-3 rounded-lg border border-slate-200 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
          autoFocus
        />
        {showDropdown && filtered.length > 0 && (
          <div className="absolute z-50 bottom-full mb-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto">
            {filtered.map((entry) => (
              <button
                key={`${entry.district}-${entry.prefix}`}
                type="button"
                onClick={() => handleSelect(entry)}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors"
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {hasSelected && (
        <Button
          onClick={onAdvance}
          className="bg-violet-600 hover:bg-violet-700 text-white py-2.5 px-6 rounded-lg font-medium text-sm"
        >
          Continue
        </Button>
      )}
    </div>
  );
}
