"use client";

/**
 * The intro before question 1 for a parent who picked a call time first — the quick match, or any parent with no
 * position (04b rework W15; BAI 2026-11-05: "the text on the subsequent position slide to say 'Create your childcare
 * position to get your best matches', then it would go onto the first question"). In the flow's own interstitial
 * style, it moves on by itself after the interstitial's own time ("And lastly..."), fading out as the flow's screens
 * do; under prefers-reduced-motion it moves on at the same moment without the fade.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { useEffect, useRef, useState } from "react";
import { PARENT_COPY } from "@/lib/calls/copy";
import { Interstitial } from "./Interstitial";
import { QUESTIONS } from "./questions";

/** As long as the flow's own interstitial shows. */
const SHOW_MS = QUESTIONS.find((q) => q.type === "interstitial")?.interstitialDuration ?? 2000;
/** The flow's own fade between screens (`TypeformFlow` `transitionTo`). */
const FADE_MS = 200;

const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PositionIntro({ onDone }: { readonly onDone: () => void }) {
  const [exiting, setExiting] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let fade: ReturnType<typeof setTimeout> | undefined;
    const shown = setTimeout(() => {
      if (reducedMotion()) return done.current();
      setExiting(true);
      fade = setTimeout(() => done.current(), FADE_MS);
    }, SHOW_MS);
    return () => {
      clearTimeout(shown);
      if (fade !== undefined) clearTimeout(fade);
    };
  }, []);
  return <Interstitial text={PARENT_COPY.positionIntro} progress={0} exiting={exiting} />;
}
