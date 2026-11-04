"use client";

/**
 * Edit one cohort's places inline (brief §0.4, §3.5, §3.9–3.10). A whole number 0–99; below what's already taken or
 * being paid for is refused with the brief's message and the old value comes back. Last write wins, each audited.
 * BB-wave1-041126/02-build.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PLACES_MAX, PLACES_MIN } from "@/lib/cohorts/constants";
import { formatCohortDate } from "@/lib/cohorts/dates";
import { setCohortPlaces } from "./actions";
import { AlertLine, QUIET_BUTTON } from "./parts";

export function PlacesEditor({ startDate, places }: { readonly startDate: string; readonly places: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(places));
  const [error, setError] = useState<string | null>(null);
  const changed = value.trim() !== String(places);

  const save = () =>
    startTransition(async () => {
      setError(null);
      const r = await setCohortPlaces({ startDate, places: value });
      if (r.ok) return router.refresh();
      setError(r.message);
      setValue(String(places));
    });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={PLACES_MIN}
          max={PLACES_MAX}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-20"
          aria-label={`Places in the cohort starting ${formatCohortDate(startDate)}`}
        />
        <button type="button" className={QUIET_BUTTON} disabled={pending || !changed} onClick={save}>
          Save
        </button>
      </div>
      {error && <AlertLine>{error}</AlertLine>}
    </div>
  );
}
