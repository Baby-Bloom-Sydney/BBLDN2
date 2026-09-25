"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepProps } from "../NannyRegistrationFunnel";
import { HOURLY_RATE_BOUNDS } from "@/lib/constants";

const PAY_FREQUENCY_OPTIONS = ["Daily", "Weekly", "Fortnightly", "Monthly"];

function MultiSelectTags({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt]
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`px-4 py-2 rounded-full border text-sm font-medium cursor-pointer transition-colors ${
            selected.includes(opt)
              ? "bg-violet-600 text-white border-violet-600"
              : "bg-white text-slate-700 border-slate-300 hover:border-violet-400"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/** Round up to nearest £0.25 */
function roundUpToQuarter(value: number): number {
  return Math.ceil(value * 4) / 4;
}

export function StepSalary({ data, updateData, goNext, goBack }: StepProps) {
  const [displayValue, setDisplayValue] = useState<string>(
    data.hourly_rate_min ? data.hourly_rate_min.replace("£", "") : ""
  );
  const payFrequency: string[] = data.pay_frequency ?? [];

  const hasRate = data.hourly_rate_min !== null && data.hourly_rate_min !== undefined;
  const showPayFrequency = hasRate;
  const canContinue = hasRate && payFrequency.length > 0;

  function handleRateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setDisplayValue(raw);

    if (!raw) {
      updateData({ hourly_rate_min: null });
      return;
    }

    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) {
      updateData({ hourly_rate_min: `£${num}` });
    }
  }

  function handleRateBlur() {
    if (!displayValue) return;

    const num = parseFloat(displayValue);
    if (isNaN(num) || num <= 0) {
      setDisplayValue("");
      updateData({ hourly_rate_min: null });
      return;
    }

    const clamped = Math.max(num, HOURLY_RATE_BOUNDS.min);
    const rounded = roundUpToQuarter(clamped);
    const formatted = rounded.toFixed(2);
    setDisplayValue(formatted);
    updateData({ hourly_rate_min: `£${formatted}` });
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-slate-800">
          Salary Expectations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Hourly Rate */}
        <div className="space-y-3">
          <Label htmlFor="hourly_rate" className="text-sm font-medium text-slate-700">
            Minimum hourly rate you&apos;ll accept
          </Label>
          <div className="relative max-w-48">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">£</span>
            <Input
              id="hourly_rate"
              type="number"
              min={HOURLY_RATE_BOUNDS.min}
              step={0.25}
              placeholder={HOURLY_RATE_BOUNDS.min.toFixed(2)}
              value={displayValue}
              onChange={handleRateChange}
              onBlur={handleRateBlur}
              className="pl-7 text-lg"
            />
          </div>
          <p className="text-xs text-slate-500">
            Minimum £{HOURLY_RATE_BOUNDS.min.toFixed(2)} — rounded up to the nearest £0.25
          </p>
        </div>

        {/* Pay Frequency — revealed after hourly rate entered */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            showPayFrequency ? "max-h-[500px] opacity-100 mt-6" : "max-h-0 opacity-0"
          }`}
        >
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              How often are you comfortable with being paid?
            </p>
            <MultiSelectTags
              options={PAY_FREQUENCY_OPTIONS}
              selected={payFrequency}
              onChange={(val) => updateData({ pay_frequency: val })}
            />
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={goBack} className="flex-1">
            Back
          </Button>
          {canContinue && (
            <Button
              type="button"
              onClick={goNext}
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
            >
              Continue to add Helpful Information
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
