"use client";

/**
 * The schedule (brief §0.2, §3.1, §3.9): first start date (a London date string, suggesting the next Monday — the
 * native date input's value is used as typed, never through the browser's zone), repeat every N weeks, places in
 * each new cohort. A failed save shows the amber line and keeps what was typed.
 * BB-wave1-041126/02-build.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLACES_MAX, PLACES_MIN, REPEAT_WEEKS_MAX, REPEAT_WEEKS_MIN, SUGGESTED_PLACES, SUGGESTED_REPEAT_WEEKS } from "@/lib/cohorts/constants";
import type { CohortSchedule } from "@/lib/cohorts/types";
import { saveCohortSchedule } from "./actions";
import { ACTION_BUTTON, AlertLine, NoteLine, SmallLabel } from "./parts";

interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function NumberField({ id, label, min, max, value, onChange }: NumberFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function ScheduleForm({ schedule, suggestedFirst }: { readonly schedule: CohortSchedule | null; readonly suggestedFirst: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [first, setFirst] = useState(schedule?.firstStartDate ?? suggestedFirst);
  const [weeks, setWeeks] = useState(String(schedule?.repeatWeeks ?? SUGGESTED_REPEAT_WEEKS));
  const [places, setPlaces] = useState(String(schedule?.defaultPlaces ?? SUGGESTED_PLACES));
  const [message, setMessage] = useState<{ readonly tone: "error" | "note"; readonly text: string } | null>(null);

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await saveCohortSchedule({ firstStartDate: first, repeatWeeks: weeks, defaultPlaces: places });
      if (!r.ok) return setMessage({ tone: "error", text: r.message });
      setMessage({ tone: "note", text: "Saved." });
      router.refresh();
    });

  return (
    <section aria-label="Schedule">
      <Card>
        <CardContent className="space-y-4 p-5">
          <SmallLabel>Schedule</SmallLabel>
          <form
            noValidate
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cohort-first">First cohort starts</Label>
              <Input id="cohort-first" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <NumberField id="cohort-weeks" label="Repeat every (weeks)" min={REPEAT_WEEKS_MIN} max={REPEAT_WEEKS_MAX} value={weeks} onChange={setWeeks} />
            <NumberField id="cohort-places" label="Places in each new cohort" min={PLACES_MIN} max={PLACES_MAX} value={places} onChange={setPlaces} />
            <div className="sm:col-span-3">
              <button type="submit" className={ACTION_BUTTON} disabled={pending}>
                Save schedule
              </button>
            </div>
          </form>
          <NoteLine>Weekly from a Monday is suggested; you can change both. Changing the schedule moves only cohorts with nothing recorded.</NoteLine>
          {message?.tone === "error" && <AlertLine>{message.text}</AlertLine>}
          {message?.tone === "note" && <NoteLine>{message.text}</NoteLine>}
        </CardContent>
      </Card>
    </section>
  );
}
