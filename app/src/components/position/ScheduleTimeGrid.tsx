"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2 } from "lucide-react";
import {
  TIME_BRACKETS,
  BRACKET_KEYS,
  getBracketTimeOptions,
  sydneyToUTC,
} from "@/lib/timezone";

export function ScheduleTimeGrid({
  proposedTimes,
  otherPartyName,
  onConfirm,
  onBack,
  submitting,
}: {
  proposedTimes: string[];
  otherPartyName?: string;
  onConfirm: (isoTime: string) => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState<string | null>(null);

  // Parse proposed times into available slots set and unique dates
  const availableSlots = new Set(proposedTimes);
  const uniqueDates = Array.from(new Set(proposedTimes.map((s) => s.split("_")[0]))).sort();

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return {
      weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
      day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    };
  };

  // Time picker
  const selectedBracketKey = selectedSlot ? selectedSlot.split("_")[1] as keyof typeof TIME_BRACKETS : null;
  const timeGrid = selectedBracketKey
    ? [getBracketTimeOptions(selectedBracketKey).slice(0, 4),
       getBracketTimeOptions(selectedBracketKey).slice(4, 8),
       getBracketTimeOptions(selectedBracketKey).slice(8, 12)]
    : [];
  const hasSelectedTime = selectedSlot && selectedHour !== null && selectedMinute !== null;

  const getConfirmationLabel = () => {
    if (!selectedSlot || selectedHour === null || selectedMinute === null) return "";
    const [date] = selectedSlot.split("_");
    const d = new Date(date + "T00:00:00");
    const dayStr = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const h = selectedHour > 12 ? selectedHour - 12 : selectedHour;
    const ampm = selectedHour >= 12 ? "pm" : "am";
    const m = selectedMinute.toString().padStart(2, "0");
    return `${dayStr} at ${h}:${m}${ampm}`;
  };

  const handleConfirm = () => {
    if (!selectedSlot || selectedHour === null || selectedMinute === null) return;
    const [date] = selectedSlot.split("_");
    const iso = sydneyToUTC(date, selectedHour, selectedMinute);
    onConfirm(iso);
  };

  const firstName = otherPartyName?.split(" ")[0] || "the nanny";

  return (
    <div className="space-y-4">
      {/* Availability grid — dates as rows, brackets as columns */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          {firstName}&apos;s availability
        </p>

        <div className="overflow-x-auto -mx-4 px-4">
          <div className="min-w-[340px]">
            {/* Bracket column headers */}
            <div className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
              <div />
              {BRACKET_KEYS.map((bracket) => (
                <div key={bracket} className="text-center">
                  <p className="text-xs font-semibold text-slate-600">{TIME_BRACKETS[bracket].label}</p>
                  <p className="text-[10px] text-slate-400">{TIME_BRACKETS[bracket].sublabel}</p>
                </div>
              ))}
            </div>

            {/* Date rows */}
            {uniqueDates.map((date) => {
              const { weekday, day } = formatDate(date);
              return (
                <div key={date} className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                  <div className="flex items-center">
                    <div>
                      <p className="text-xs font-semibold text-slate-600">{weekday}</p>
                      <p className="text-[10px] text-slate-400">{day}</p>
                    </div>
                  </div>
                  {BRACKET_KEYS.map((bracket) => {
                    const slot = `${date}_${bracket}`;
                    const isAvailable = availableSlots.has(slot);
                    const isSelected = selectedSlot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={!isAvailable}
                        onClick={() => {
                          if (!isAvailable) return;
                          setSelectedSlot(isSelected ? null : slot);
                          setSelectedHour(null);
                          setSelectedMinute(null);
                        }}
                        className={`h-10 rounded-md border text-xs font-medium transition-colors ${
                          isSelected
                            ? "bg-violet-600 text-white border-violet-600 cursor-pointer"
                            : isAvailable
                            ? "bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400 cursor-pointer"
                            : "bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed"
                        }`}
                      >
                        {isAvailable ? (isSelected ? "\u2713" : "") : ""}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4x3 time picker */}
      {selectedSlot && selectedBracketKey && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">
            Select a time
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-4 gap-1.5">
              {timeGrid.flat().map((opt) => {
                const isSelected = selectedHour === opt.hour && selectedMinute === opt.minute;
                return (
                  <button
                    key={`${opt.hour}-${opt.minute}`}
                    type="button"
                    onClick={() => {
                      setSelectedHour(opt.hour);
                      setSelectedMinute(opt.minute);
                    }}
                    className={`py-2.5 rounded-md border text-sm font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-700 border-slate-200 hover:border-violet-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation */}
      {hasSelectedTime && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">
            {getConfirmationLabel()}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </Button>
        <Button
          className="flex-1 bg-violet-500 hover:bg-violet-600"
          disabled={!hasSelectedTime || submitting}
          onClick={handleConfirm}
        >
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirming...</>
          ) : (
            "Confirm Time"
          )}
        </Button>
      </div>
    </div>
  );
}
