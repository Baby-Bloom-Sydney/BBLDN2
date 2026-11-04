/**
 * The call as the next slide of the matchmaking funnel (brief 04 §0a.1; 04b rework W3), in the funnel's own classes
 * (`src/app/(public)/matchmaking/onboarding/QuestionShell.tsx`): a white page, the progress bar across the top (full —
 * this is the funnel's last step), a centred heading and subtitle, and the choices with one primary button in a
 * `max-w-md` area at the bottom. It fades in only when motion is allowed (`motion-safe:`), so a reader who prefers
 * reduced motion sees it still. Server-safe: no state, no effects.
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

import type { ReactNode } from "react";

/** The funnel's primary button (`OnboardingFlow.tsx`'s Continue). */
export const FUNNEL_PRIMARY = "w-full h-11 bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm";

export interface FunnelSlideProps {
  readonly heading: ReactNode;
  readonly subtitle?: ReactNode;
  /** Shown above the heading (the booked tick). */
  readonly mark?: ReactNode;
  /** The bottom area: the choices and the primary button. */
  readonly children: ReactNode;
}

export function FunnelSlide({ heading, subtitle, mark, children }: FunnelSlideProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <div data-testid="funnel-progress" aria-hidden="true" className="h-1 bg-slate-100">
        <div className="h-full w-full rounded-r-full bg-violet-600" />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
        <div className="max-w-lg text-center">
          {mark}
          <h1 data-call-heading tabIndex={-1} className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug focus:outline-none">
            {heading}
          </h1>
          {subtitle && <div className="text-sm text-slate-500 mt-2 max-w-md mx-auto">{subtitle}</div>}
        </div>
      </div>
      <div className="w-full max-w-md mx-auto px-4 pb-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-500">
        {children}
      </div>
    </div>
  );
}
