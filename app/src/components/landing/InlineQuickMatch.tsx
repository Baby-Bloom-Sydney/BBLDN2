"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu",
  Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
};
const DAY_KEY: Record<string, string> = {
  Monday: "monday", Tuesday: "tuesday", Wednesday: "wednesday", Thursday: "thursday",
  Friday: "friday", Saturday: "saturday", Sunday: "sunday",
};

const TIME_BLOCKS = [
  { key: "morning", label: "Morning", sublabel: "6am - 10am", short: "6am-10am" },
  { key: "midday", label: "Midday", sublabel: "10am - 2pm", short: "10am-2pm" },
  { key: "afternoon", label: "Afternoon", sublabel: "2pm - 6pm", short: "2pm-6pm" },
  { key: "evening", label: "Evening", sublabel: "6pm - 10pm", short: "6pm-10pm" },
];

/** Compact quickmatch widget: availability first → suburb → search. Designed to embed in tiles. */
export function InlineQuickMatch() {
  const router = useRouter();

  // Suburb
  const [districts, setDistricts] = useState<DistrictEntry[]>([]);
  const [query, setQuery] = useState("");
  const [filtered, setFiltered] = useState<DistrictEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictEntry | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Availability
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Record<string, string[]>>({});

  // UI
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((d: DistrictEntry[]) => setDistricts(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSuburbChange = (val: string) => {
    setQuery(val);
    setSelectedDistrict(null);
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
        .slice(0, 8);
      setFiltered(matches);
      setShowDropdown(matches.length > 0);
    } else {
      setFiltered([]);
      setShowDropdown(false);
    }
  };

  const handleSuburbSelect = (entry: DistrictEntry) => {
    setQuery(entry.label);
    setShowDropdown(false);
    setSelectedDistrict(entry);
    setPrompt(null);
  };

  const toggleDay = useCallback((day: string) => {
    setPrompt(null);
    const key = DAY_KEY[day];
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        setAvailability((a) => {
          const next = { ...a };
          delete next[key];
          return next;
        });
        return prev.filter((d) => d !== day);
      }
      return [...prev, day];
    });
  }, []);

  const toggleTimeBlock = useCallback((day: string, blockKey: string) => {
    setPrompt(null);
    const key = DAY_KEY[day];
    setAvailability((prev) => {
      const current = prev[key] ?? [];
      const updated = current.includes(blockKey)
        ? current.filter((b) => b !== blockKey)
        : [...current, blockKey];
      return { ...prev, [key]: updated };
    });
  }, []);

  const sortedSelectedDays = DAY_OPTIONS.filter((d) => selectedDays.includes(d));

  const allDaysHaveBrackets =
    sortedSelectedDays.length > 0 &&
    sortedSelectedDays.every((day) => {
      const blocks = availability[DAY_KEY[day]] ?? [];
      return blocks.length > 0;
    });

  const canSearch = selectedDistrict !== null && allDaysHaveBrackets;

  const handleSearch = () => {
    if (!canSearch || !selectedDistrict) return;
    setLoading(true);
    sessionStorage.setItem(
      "bb-quick-match",
      JSON.stringify({
        suburb: selectedDistrict.district,
        postcode: selectedDistrict.prefix,
        availability,
      })
    );
    router.push("/results");
  };

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="text-center pt-1">
        <p className="text-sm font-semibold text-slate-800">Schedule doesn&apos;t match?</p>
        <p className="text-xs text-slate-500 mt-0.5">Tell us your availability and we&apos;ll find nannies that fit</p>
      </div>

      {/* Step 1: Day selection */}
      <div className="space-y-2">
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-4 gap-1.5">
            {DAY_OPTIONS.slice(0, 4).map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-2 py-2 rounded-lg border text-xs font-medium text-center transition-all duration-150 touch-manipulation ${
                  selectedDays.includes(day)
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {DAY_SHORT[day]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {DAY_OPTIONS.slice(4).map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-2 py-2 rounded-lg border text-xs font-medium text-center transition-all duration-150 touch-manipulation ${
                  selectedDays.includes(day)
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {DAY_SHORT[day]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Step 2: Time blocks — appears when days selected */}
      {sortedSelectedDays.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600 block">
            When during the day?
          </label>
          <div className="w-full overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[38px_repeat(4,1fr)] sm:grid-cols-[60px_repeat(4,1fr)] gap-1 sm:gap-1.5 mb-1.5">
              <div />
              {TIME_BLOCKS.map((block) => (
                <div key={block.key} className="text-center flex flex-col justify-end">
                  <p className="text-[10px] min-[400px]:text-[11px] font-semibold text-slate-600 tracking-tight">
                    {block.label}
                  </p>
                  <span className="hidden sm:block text-[9px] text-slate-400 mt-0.5 whitespace-nowrap tracking-wide">
                    {block.sublabel}
                  </span>
                  <span className="block sm:hidden text-[8px] min-[400px]:text-[9px] text-slate-400 mt-0.5 whitespace-nowrap tracking-tighter">
                    {block.short}
                  </span>
                </div>
              ))}
            </div>

            {/* Day rows */}
            {sortedSelectedDays.map((day) => {
              const currentTimes = availability[DAY_KEY[day]] ?? [];
              return (
                <div
                  key={day}
                  className="grid grid-cols-[38px_repeat(4,1fr)] sm:grid-cols-[60px_repeat(4,1fr)] gap-1 sm:gap-1.5 mb-1"
                >
                  <div className="flex items-center">
                    <p className="text-[11px] sm:text-xs font-semibold text-slate-600 tracking-tight">
                      {DAY_SHORT[day]}
                    </p>
                  </div>
                  {TIME_BLOCKS.map((block) => {
                    const isSelected = currentTimes.includes(block.key);
                    return (
                      <button
                        key={block.key}
                        type="button"
                        onClick={() => toggleTimeBlock(day, block.key)}
                        className={`h-8 sm:h-9 rounded-md border text-xs font-medium transition-colors touch-manipulation ${
                          isSelected
                            ? "bg-violet-500 text-white border-violet-500 shadow-sm"
                            : "bg-white text-slate-400 border-slate-200 hover:border-violet-400 hover:bg-slate-50"
                        }`}
                      >
                        {isSelected ? "\u2713" : ""}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Suburb — appears when time blocks are complete */}
      {allDaysHaveBrackets && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600 block">
            What area are you in?
          </label>
          <div className="relative" ref={dropdownRef}>
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSuburbChange(e.target.value)}
              onFocus={() => { if (filtered.length > 0) setShowDropdown(true); }}
              placeholder="Search area or postcode..."
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors"
            />
            {showDropdown && filtered.length > 0 && (
              <div className="absolute z-50 bottom-full mb-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                {filtered.map((entry) => (
                  <button
                    key={`${entry.district}-${entry.prefix}`}
                    type="button"
                    onClick={() => handleSuburbSelect(entry)}
                    className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CTA */}
      <Button
        className="w-full bg-violet-500 hover:bg-violet-600 h-10 text-sm"
        disabled={loading}
        onClick={() => {
          if (selectedDays.length === 0) {
            setPrompt("Select the days you need childcare");
            return;
          }
          if (!allDaysHaveBrackets) {
            setPrompt("Choose time slots for your selected days");
            return;
          }
          if (!selectedDistrict) {
            setPrompt("Enter your area to get started");
            return;
          }
          setPrompt(null);
          handleSearch();
        }}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Finding nannies...
          </>
        ) : (
          <>
            <Search className="mr-2 h-4 w-4" />
            Find your perfect Nanny
          </>
        )}
      </Button>

      {prompt && (
        <p className="text-xs text-violet-500 text-center">{prompt}</p>
      )}
    </div>
  );
}
