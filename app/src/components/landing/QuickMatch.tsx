"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Loader2, CheckCircle } from "lucide-react";
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

// Matches parent form constants exactly
const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu",
  Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
};
// Map display day → API key (lowercase)
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

export function QuickMatch() {
  const router = useRouter();

  // Suburb autocomplete state
  const [districts, setDistricts] = useState<DistrictEntry[]>([]);
  const [query, setQuery] = useState("");
  const [filtered, setFiltered] = useState<DistrictEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictEntry | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Availability state — matches parent form pattern: select days, then time blocks per day
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Record<string, string[]>>({});
  const timesRef = useRef<HTMLDivElement>(null);

  // Search state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  // Typewriter placeholder
  const PLACEHOLDER_SUBURBS = ["Vaucluse", "Mosman", "Double Bay", "Rose Bay", "Woollahra", "Neutral Bay", "Bellevue Hill", "Cremorne", "Paddington", "Manly", "Bondi", "Balmoral", "Darling Point", "Palm Beach", "Bronte", "Avalon", "Coogee", "Randwick", "Clovelly", "Maroubra"];
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isInputFocused || query.length > 0) return;

    let suburbIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const currentSuburb = PLACEHOLDER_SUBURBS[suburbIdx];

      if (!deleting) {
        charIdx++;
        setTypedPlaceholder(currentSuburb.slice(0, charIdx));
        if (charIdx === currentSuburb.length) {
          // Pause at full word, then start deleting
          pauseTimer = setTimeout(() => {
            deleting = true;
            typewriterRef.current = setTimeout(tick, 40);
          }, 1800);
          return;
        }
        typewriterRef.current = setTimeout(tick, 80 + Math.random() * 40);
      } else {
        charIdx--;
        setTypedPlaceholder(currentSuburb.slice(0, charIdx));
        if (charIdx === 0) {
          deleting = false;
          suburbIdx = (suburbIdx + 1) % PLACEHOLDER_SUBURBS.length;
          typewriterRef.current = setTimeout(tick, 400);
          return;
        }
        typewriterRef.current = setTimeout(tick, 40);
      }
    };

    // Initial delay before starting
    typewriterRef.current = setTimeout(tick, 600);

    return () => {
      if (typewriterRef.current) clearTimeout(typewriterRef.current);
      if (pauseTimer) clearTimeout(pauseTimer);
    };
  }, [isInputFocused, query.length]);

  // Load served districts on mount
  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((d: DistrictEntry[]) => setDistricts(d))
      .catch(() => {});
  }, []);

  // Click outside to close dropdown
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
        // Deselect — also remove that day's time blocks
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

  // Auto-scroll when time grid appears
  useEffect(() => {
    if (selectedDays.length > 0 && timesRef.current) {
      timesRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [selectedDays.length]);

  // Sort selected days in week order
  const sortedSelectedDays = DAY_OPTIONS.filter((d) => selectedDays.includes(d));

  // Every selected day must have at least one time block
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
    setError(null);

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
    <section id="quick-match" className="relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute top-20 right-[10%] w-72 h-72 bg-violet-100 rounded-full blur-3xl opacity-50" />
      <div className="absolute bottom-10 left-[5%] w-48 h-48 bg-violet-200 rounded-full blur-2xl opacity-30" />

      <div className="container mx-auto px-4 md:px-6 pt-16 pb-12 md:pt-24 md:pb-16">
        {/* Hero text */}
        <div className="max-w-3xl mx-auto text-center relative z-10 mb-10">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight">
            Childcare that nourishes futures
          </h1>
          <p className="mt-5 text-lg text-slate-600 max-w-xl mx-auto leading-relaxed">
            Education-focused nannies. Expertly matched. Free for families.
          </p>
        </div>

        {/* Match form */}
        <div className="max-w-[560px] mx-auto relative z-10">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-lg shadow-slate-200/50 p-6 md:p-8 space-y-5">
            {/* Suburb input */}
            <div>
              <div className="relative" ref={dropdownRef}>
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
                {/* Typewriter overlay — only visible when input is empty and not focused */}
                {!isInputFocused && query.length === 0 && (
                  <span className="absolute left-10 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none select-none">
                    {typedPlaceholder}
                    <span className="inline-block w-[2px] h-4 bg-slate-400 ml-[1px] align-middle" style={{ animation: "blink 1s step-end infinite" }} />
                  </span>
                )}
                <input
                  type="text"
                  value={query}
                  onChange={(e) => handleSuburbChange(e.target.value)}
                  onFocus={() => {
                    setIsInputFocused(true);
                    if (filtered.length > 0) setShowDropdown(true);
                  }}
                  onBlur={() => setIsInputFocused(false)}
                  placeholder={isInputFocused ? "Search suburb or postcode..." : ""}
                  className="w-full h-11 pl-10 pr-4 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors"
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

            {/* Day + time selection — matches parent form pattern */}
            {selectedDistrict && (
            <div className="space-y-4">
              <label className="text-sm font-medium text-slate-700 block text-center">
                Which days do you need childcare?
              </label>

              {/* Day selection — 4 + 3 grid, matches DaysTimesCompound */}
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-4 gap-2">
                  {DAY_OPTIONS.slice(0, 4).map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-2 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 touch-manipulation ${
                        selectedDays.includes(day)
                          ? "bg-violet-500 text-white border-violet-500"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {DAY_SHORT[day]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DAY_OPTIONS.slice(4).map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-2 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 touch-manipulation ${
                        selectedDays.includes(day)
                          ? "bg-violet-500 text-white border-violet-500"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {DAY_SHORT[day]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time bracket grid — appears once days are selected */}
              {sortedSelectedDays.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-slate-700 text-center">
                    When during the day?
                  </p>

                  <div className="w-full overflow-hidden">
                    <div className="w-full">
                      {/* Column headers */}
                      <div className="grid grid-cols-[38px_repeat(4,1fr)] sm:grid-cols-[60px_repeat(4,1fr)] md:grid-cols-[80px_repeat(4,1fr)] gap-1 sm:gap-1.5 mb-1.5">
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
                            className="grid grid-cols-[38px_repeat(4,1fr)] sm:grid-cols-[60px_repeat(4,1fr)] md:grid-cols-[80px_repeat(4,1fr)] gap-1 sm:gap-1.5 mb-1"
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
                </div>
              )}
              <div ref={timesRef} />
            </div>
            )}

            {/* CTA */}
            <Button
              className="w-full bg-violet-500 hover:bg-violet-600 h-11 text-sm"
              disabled={loading}
              onClick={() => {
                if (!selectedDistrict) {
                  setPrompt("Enter your suburb to get started");
                  return;
                }
                if (selectedDays.length === 0) {
                  setPrompt("Select the days you need childcare");
                  return;
                }
                if (!allDaysHaveBrackets) {
                  setPrompt("Choose time slots for your selected days");
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
                  Find Nannies
                </>
              )}
            </Button>

            {prompt && (
              <p className="text-xs text-violet-500 text-center">{prompt}</p>
            )}

            {error && (
              <p className="text-xs text-red-500 text-center">{error}</p>
            )}

          </div>

          {/* Trust indicators */}
          <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-violet-500" />
              <span>WWCC verified</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-violet-500" />
              <span>Expertly vetted</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-violet-500" />
              <span>Developmental focused</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
