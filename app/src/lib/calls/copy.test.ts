/**
 * Placeholder wording (plan §3d; brief §0, §3; BAI edits before switch-on, brief §10).
 * Parents see "Complimentary matchmaker call"; admin says "matchmaker call". Nothing says "intro", nothing says
 * the placement is free, and audience-facing text never says "tracking".
 */
import { describe, expect, it } from "vitest";
import { ADMIN_COPY, PARENT_COPY, bookedLine, callsToMakeLine, hubBookedLine, prebookFullLine } from "./copy";

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

  it("builds the booked lines from London words", () => {
    const words = { day: "Tuesday 9 February", time: "14:00", short: "Tue 9 Feb, 14:00" };
    expect(bookedLine(words)).toBe("Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)");
    expect(hubBookedLine(words)).toBe("Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)");
    expect(prebookFullLine("Monday 8 February")).toBe("We'll call you on Monday 8 February");
  });

  it("names the call as the Complimentary matchmaker call wherever it names it", () => {
    for (const text of allStrings(PARENT_COPY)) {
      if (/call\b/i.test(text) && /matchmaker/i.test(text)) expect(text).toMatch(/Complimentary matchmaker call/);
    }
  });
});

describe("admin copy", () => {
  it("says matchmaker call, never Complimentary", () => {
    expect(ADMIN_COPY.stopCallingWhileBooked).toBe("Cancel the booked time first");
    expect(ADMIN_COPY.noFreeTimes).toBe("No free call times in the next 7 days.");
    for (const text of allStrings(ADMIN_COPY)) expect(text).not.toMatch(/Complimentary/);
    expect(allStrings(ADMIN_COPY).some((t) => /matchmaker call/.test(t))).toBe(true);
  });

  it("builds the counts line", () => {
    expect(callsToMakeLine({ booked: 8, notBooked: 4 })).toBe("Calls still to make this week: 12 (8 booked · 4 not booked)");
    expect(callsToMakeLine({ booked: 0, notBooked: 0 })).toBe("Calls still to make this week: 0 (0 booked · 0 not booked)");
  });
});

describe("the copy rules", () => {
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
