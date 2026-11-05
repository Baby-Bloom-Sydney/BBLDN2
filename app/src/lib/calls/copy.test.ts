/**
 * Placeholder wording (plan §3d; brief §0, §3; BAI edits before switch-on, brief §10).
 * Parents see "Complimentary matchmaker call"; admin says "matchmaker call". Nothing says "intro", nothing says
 * the placement is free, and audience-facing text never says "tracking".
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_COPY,
  PARENT_COPY,
  bookedLine,
  callOnLine,
  callsToMakeLine,
  fewFreeTimesLine,
  heldLine,
  noFreeTimesLine,
  prebookFullLine,
  slotAtLine,
  takenNoticeLine,
  yourCallLine,
} from "./copy";

const allStrings = (copy: Readonly<Record<string, string>>) => Object.values(copy);

describe("parent copy, word for word", () => {
  it("matches brief §0 / §3", () => {
    expect(PARENT_COPY).toMatchObject({
      pageHeading: "Your Complimentary matchmaker call",
      taken: "That time has just gone — pick another",
      holdExpired: "Your hold ran out — pick again",
      afterNoAnswer: "We tried to call you — pick another time",
      noTimes: "No times free right now — we'll still call you for your Complimentary matchmaker call.",
      loadFailed: "We couldn't load the times — we'll still call you for your Complimentary matchmaker call",
      rateLimited: "Too many changes — try again in a while",
      signupLine: "Next: your Complimentary matchmaker call, to introduce you to your top nannies.",
      hubNotBooked: "Pick a time for your Complimentary matchmaker call",
      changeTime: "Change time",
      cancel: "Cancel",
      goToMatches: "Go to my matches",
    });
  });

  it("the picker's words (04b rework W4)", () => {
    expect(PARENT_COPY).toMatchObject({
      availability: "Your matchmaker's availability",
      selectTime: "Select a time",
      confirmTimeButton: "Confirm time",
      confirming: "Confirming...",
      skipForNow: "Skip for now",
      takenTitle: "This time has just been booked",
      pickAnother: "Pick another time",
    });
    expect(slotAtLine({ day: "Thursday 5 November", time: "10:00" })).toBe("Thursday 5 November at 10:00");
    expect(takenNoticeLine("Thursday 5 November at 10:00")).toBe(
      "Someone else booked Thursday 5 November at 10:00 a moment ago. Please pick another time.",
    );
  });

  it("the booked slide's words (04b rework W5)", () => {
    expect(PARENT_COPY).toMatchObject({
      youreBooked: "You're booked",
      goToMatches: "Go to my matches",
      goToChildcare: "Go to my childcare",
      goToDashboard: "Go to my dashboard",
    });
    expect(callOnLine("07700 900123")).toBe("We'll call you on 07700 900123.");
  });

  it("the no-position words (04b rework W11, BAI 2026-11-05 verbatim); the button is 'Confirm time' (W15)", () => {
    expect(PARENT_COPY.completePositionLine).toBe("Complete your childcare position so that we can confirm your call with your matchmaker.");
    expect(PARENT_COPY.confirmTimeButton).toBe("Confirm time");
    expect(allStrings(PARENT_COPY)).not.toContain("Complete my childcare position");
    expect(PARENT_COPY.positionIntro).toBe("Create your childcare position to get your best matches");
  });

  it("the Childcare tab card's words (04b rework W9)", () => {
    expect(PARENT_COPY.bookATime).toBe("Book a time");
  });

  it("builds the booked lines from London words, without saying London (W14)", () => {
    const words = { day: "Tuesday 9 February", time: "14:00", short: "Tue 9 Feb, 14:00" };
    expect(bookedLine(words)).toBe("Your Complimentary matchmaker call is on Tuesday 9 February at 14:00");
    expect(heldLine(words, "10:05")).toBe("We're holding Tuesday 9 February, 14:00 for you until 10:05.");
    expect(yourCallLine("Thursday 5 November at 10:00")).toBe("Your call: Thursday 5 November at 10:00");
    expect(prebookFullLine("Monday 8 February")).toBe("We'll call you on Monday 8 February");
  });

  it("names the call as the Complimentary matchmaker call wherever it names it", () => {
    // BAI's own words for the no-position line, verbatim (2026-11-05, brief §0a.6) — the one exception.
    const verbatim = new Set<string>([PARENT_COPY.completePositionLine]);
    for (const text of allStrings(PARENT_COPY).filter((t) => !verbatim.has(t))) {
      if (/call\b/i.test(text) && /matchmaker/i.test(text)) expect(text).toMatch(/Complimentary matchmaker call/);
    }
  });
});

describe("admin copy", () => {
  it("says matchmaker call, never Complimentary", () => {
    expect(ADMIN_COPY.stopCallingWhileBooked).toBe("Cancel the booked time first");
    expect(noFreeTimesLine(7)).toBe("No free call times in the next 7 days.");
    expect(noFreeTimesLine(14)).toBe("No free call times in the next 14 days.");
    expect(noFreeTimesLine(1)).toBe("No free call times in the next 1 day.");
    expect(fewFreeTimesLine(7)).toBe("Free call times are running low in the next 7 days.");
    expect(JSON.stringify(ADMIN_COPY)).not.toMatch(/next \d+ days?/);
    for (const text of allStrings(ADMIN_COPY)) expect(text).not.toMatch(/Complimentary/);
    expect(allStrings(ADMIN_COPY).some((t) => /matchmaker call/.test(t))).toBe(true);
  });

  it("builds the counts line", () => {
    expect(callsToMakeLine({ booked: 8, notBooked: 4 })).toBe("Calls still to make this week: 12 (8 booked · 4 not booked)");
    expect(callsToMakeLine({ booked: 0, notBooked: 0 })).toBe("Calls still to make this week: 0 (0 booked · 0 not booked)");
  });
});

describe("the copy rules", () => {
  it("parents are never told 'London time' (W14, BAI 2026-11-05: \"this is just a given\"); admin still is", () => {
    for (const text of allStrings(PARENT_COPY)) expect(text).not.toMatch(/London/);
    expect(PARENT_COPY.pageIntro).toBe("Pick a time and we'll call you then.");
  });

  const every = [...allStrings(PARENT_COPY), ...allStrings(ADMIN_COPY)];

  it("never says intro (it means the nanny meet-and-greet)", () => {
    for (const text of every) expect(text).not.toMatch(/\bintro\b|intro call/i);
  });

  it("never says the placement is free", () => {
    for (const text of every) expect(text).not.toMatch(/placement[^.]*free|free[^.]*placement|no fee|free of charge/i);
  });

  it("never says tracking", () => {
    for (const text of every) expect(text).not.toMatch(/track/i);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(PARENT_COPY)).toBe(true);
    expect(Object.isFrozen(ADMIN_COPY)).toBe(true);
  });
});
