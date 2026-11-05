/**
 * The position flow's intro for a parent who picked a call time first (04b rework W15; BAI 2026-11-05: "we would also
 * need the text on the subsequent position slide to say 'Create your childcare position to get your best matches',
 * then it would go onto the first question. (this is for quickmatch)"). Only with `callAt`: in the flow's own
 * interstitial style ("And lastly..."), with the progress bar, then on to question 1 after the interstitial's own
 * time; under reduced motion it still moves on, without the fade. Without `callAt` the flow is today's.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/parent", () => ({ saveTypeformPosition: vi.fn() }));
vi.mock("./questions", async (original) => ({
  ...(await original<typeof import("./questions")>()),
  INITIAL_FORM_DATA: {},
  QUESTIONS: [
    { id: "min_age", type: "single-select", question: "How old should the nanny be?", field: "minimum_age", options: [{ value: "18", label: "18+" }], columns: 2 },
    { id: "and_lastly", type: "interstitial", question: "", field: null, interstitialText: "And lastly...", interstitialDuration: 2000 },
  ],
}));

import { TypeformFlow } from "./TypeformFlow";

const AT = "2027-02-09T14:00:00.000Z";
const INTRO = "Create your childcare position to get your best matches";
const QUESTION_1 = "How old should the nanny be?";

const reducedMotion = (matches: boolean) => {
  window.matchMedia = vi.fn(
    (query: string) => ({ matches: query.includes("reduce") && matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  );
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const screenOf = (text: string) => screen.getByText(text).closest("div.relative") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
});
afterEach(() => vi.useRealTimers());

describe("TypeformFlow — the intro, only for a parent who picked a call time (W15)", () => {
  it("with callAt: the intro first, in the interstitial's own style with the progress bar; no question yet", () => {
    render(<TypeformFlow callAt={AT} />);
    const intro = screen.getByText(INTRO);
    expect(intro.className).toContain("text-xl sm:text-2xl font-semibold text-slate-800 text-center");
    expect(screenOf(INTRO).querySelector(".h-1.bg-slate-100")).not.toBeNull();
    expect(screen.queryByText(QUESTION_1)).not.toBeInTheDocument();
  });

  it("then, after the interstitial's time and its fade, question 1", () => {
    render(<TypeformFlow callAt={AT} />);
    advance(1999);
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    advance(1);
    expect(screenOf(INTRO).className).toContain("opacity-0");
    advance(200);
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument();
    expect(screen.getByText(QUESTION_1)).toBeInTheDocument();
  });

  it("under reduced motion it still moves on to question 1, without the fade", () => {
    reducedMotion(true);
    render(<TypeformFlow callAt={AT} />);
    advance(1999);
    expect(screenOf(INTRO).className).not.toContain("opacity-0");
    advance(1);
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument();
    expect(screen.getByText(QUESTION_1)).toBeInTheDocument();
  });

  it("without callAt: question 1 at once, no intro (today's flow)", () => {
    render(<TypeformFlow />);
    expect(screen.getByText(QUESTION_1)).toBeInTheDocument();
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument();
    advance(5000);
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument();
  });
});
