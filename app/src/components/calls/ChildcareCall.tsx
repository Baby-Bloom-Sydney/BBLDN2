"use client";

/**
 * The call on her Childcare tab (04b rework W9, W12): the card, and the popup it opens in place. The popup also opens
 * from the hub's `call` param — `open` (after her in-app position, W8), `booked` / `gone` (after a position made with
 * a picked time, W11) — read and checked by the page. Closing it removes `call` (and `at`) with `router.replace`, so a
 * refresh doesn't reopen it; opened from the card, the URL is left alone.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PARENT_COPY } from "@/lib/calls/copy";
import type { CallPopupMode } from "@/lib/calls/next-path";
import type { HubCallCard } from "@/lib/calls/parent-view";
import { CallHubCard } from "./CallHubCard";
import { CallPopup } from "./CallPopup";

export interface ChildcareCallProps {
  readonly card: HubCallCard | null;
  /** The checked `call` param, or null. */
  readonly openWith: CallPopupMode | null;
  /** For `call=gone`: the time that went, in London words ("Tuesday 9 February at 14:00"), or null. */
  readonly goneWhen: string | null;
  /** `call=open&failed=1`: a booking failed for any reason but taken — the picker opens with 04b's line. */
  readonly failed: boolean;
}

const POPUP_PARAMS = ["call", "at"] as const;

/** Close: drop `call` and `at` from the URL if they are there (no scroll jump). */
function useClearParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return () => {
    if (!POPUP_PARAMS.some((key) => params.has(key))) return;
    const kept = new URLSearchParams(params.toString());
    for (const key of POPUP_PARAMS) kept.delete(key);
    const query = kept.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  };
}

export function ChildcareCall({ card, openWith, goneWhen, failed }: ChildcareCallProps) {
  const [open, setOpen] = useState(openWith !== null);
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string | null>(openWith === "gone" ? goneWhen ?? PARENT_COPY.thatTime : null);
  const [message, setMessage] = useState<string | null>(failed ? PARENT_COPY.notSet : null);
  const clearParams = useClearParams();
  if (card === null && !open && openWith === null) return null;

  const openPopup = (change: boolean) => {
    setChanging(change);
    setNotice(null);
    setMessage(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    clearParams();
  };
  return (
    <>
      <CallHubCard card={card} onBook={() => openPopup(false)} onChange={() => openPopup(true)} />
      <CallPopup open={open} onClose={close} startChanging={changing} notice={notice} message={message} />
    </>
  );
}
