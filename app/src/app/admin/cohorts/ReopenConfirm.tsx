"use client";

/**
 * Re-open one family's place (brief §0.8, §3.7): a reason of at least 3 characters (the access toggle's rule), then
 * Confirm. A second click on an already re-opened place says "Already re-opened" and changes nothing.
 * BB-wave1-041126/02-build.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REASON_MAX, REASON_MIN } from "@/lib/cohorts/constants";
import { reopenCohortPlace } from "./actions";
import { ACTION_BUTTON, AlertLine, NoteLine, QUIET_BUTTON } from "./parts";

interface Props {
  readonly placeId: string;
  readonly familyName: string;
  readonly initialReason?: string;
  readonly onDone: () => void;
  readonly onBack: () => void;
}

export function ReopenConfirm({ placeId, familyName, initialReason = "", onDone, onBack }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState(initialReason);
  const [message, setMessage] = useState<{ readonly tone: "error" | "note"; readonly text: string } | null>(null);
  const ready = reason.trim().length >= REASON_MIN && !pending;

  const confirm = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await reopenCohortPlace({ placeId, reason });
      if (!r.ok) return setMessage({ tone: "error", text: r.message });
      router.refresh();
      if (r.message) return setMessage({ tone: "note", text: r.message });
      onDone();
    });

  return (
    <div className="space-y-3" data-testid="reopen-confirm">
      <NoteLine>Re-open {familyName}&apos;s place? One more place becomes free in this cohort.</NoteLine>
      <div className="space-y-1">
        <Label htmlFor={`reason-${placeId}`}>Reason (required)</Label>
        <Input
          id={`reason-${placeId}`}
          value={reason}
          maxLength={REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. moved abroad"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ACTION_BUTTON} disabled={!ready} onClick={confirm}>
          Confirm re-open
        </button>
        <button type="button" className={QUIET_BUTTON} disabled={pending} onClick={onBack}>
          Back
        </button>
      </div>
      {message?.tone === "error" && <AlertLine>{message.text}</AlertLine>}
      {message?.tone === "note" && <NoteLine>{message.text}</NoteLine>}
    </div>
  );
}
