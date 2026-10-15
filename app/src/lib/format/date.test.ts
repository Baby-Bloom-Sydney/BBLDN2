/**
 * Regression: a Node ICU build returns "June" for BOTH month: "long"
 * and month: "short", causing React hydration mismatches
 * (server "June" vs browser "Jun"). These helpers must produce
 * deterministic output regardless of runtime.
 *
 * Bailey 2026-05-14.
 */

import { describe, it, expect } from "vitest";
import {
  formatAuDate,
  formatAuDayMonth,
  formatAuMonth,
  formatAuWeekdayDayMonth,
  formatAuWeekdayDate,
} from "./date";

describe("formatAuDate — deterministic AU date formatting", () => {
  // Use a fixed London-local instant to remove TZ ambiguity.
  // 13 June 2026 at noon BST — a Saturday.
  const sat13Jun2026 = "2026-06-13T12:00:00+01:00";

  it('short style → "13 Jun 2026" (the format that broke under Node ICU)', () => {
    expect(formatAuDate(sat13Jun2026)).toBe("13 Jun 2026");
    expect(formatAuDate(sat13Jun2026, "short")).toBe("13 Jun 2026");
  });

  it('long style → "13 June 2026"', () => {
    expect(formatAuDate(sat13Jun2026, "long")).toBe("13 June 2026");
  });

  it("returns dash for null / undefined / unparseable", () => {
    expect(formatAuDate(null)).toBe("—");
    expect(formatAuDate(undefined)).toBe("—");
    expect(formatAuDate("not a date")).toBe("—");
  });

  it("accepts a Date object as well as ISO string", () => {
    expect(formatAuDate(new Date("2026-06-13T12:00:00+01:00"))).toBe(
      "13 Jun 2026",
    );
  });

  it("month boundaries: short and long both correct across all 12 months", () => {
    const expectedShort = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const expectedLong = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    for (let m = 0; m < 12; m += 1) {
      const d = new Date(2026, m, 15, 12, 0, 0);
      const short = formatAuDate(d).split(" ")[1];
      const long = formatAuDate(d, "long").split(" ")[1];
      expect(short).toBe(expectedShort[m]);
      expect(long).toBe(expectedLong[m]);
    }
  });
});

describe("formatAuDayMonth — day + month only", () => {
  it('short → "13 Jun"', () => {
    expect(formatAuDayMonth("2026-06-13T12:00:00+01:00")).toBe("13 Jun");
  });
  it('long → "13 June"', () => {
    expect(formatAuDayMonth("2026-06-13T12:00:00+01:00", "long")).toBe(
      "13 June",
    );
  });
});

describe("formatAuMonth — month label", () => {
  it('long default → "June"', () => {
    expect(formatAuMonth(new Date(2026, 5, 13))).toBe("June");
  });
  it('short → "Jun"', () => {
    expect(formatAuMonth(new Date(2026, 5, 13), "short")).toBe("Jun");
  });
});

describe("formatAuWeekdayDayMonth — list format", () => {
  it("Sat 13 Jun for 2026-06-13", () => {
    expect(formatAuWeekdayDayMonth("2026-06-13T12:00:00+01:00")).toBe(
      "Sat 13 Jun",
    );
  });
});

describe("formatAuWeekdayDate — full date with weekday", () => {
  it("Sat, 13 Jun 2026", () => {
    expect(formatAuWeekdayDate("2026-06-13T12:00:00+01:00")).toBe(
      "Sat, 13 Jun 2026",
    );
  });
});

// 4b (card 3b — a bug, not a decision): `formatAuDate` renders the London day of an instant on any
// process clock. The suite runs under Europe/London (vitest.setup.ts), which hid the bug, so these
// cases move the process clock to UTC+10 (Pacific/Guam, no DST) — where the old local-accessor code
// printed the UTC+10 day. Instants are written in Z so the offset needs no literal.
describe("formatAuDate — the London day, whatever the process clock (card 3b)", () => {
  const londonClock = process.env.TZ;
  const PLUS_TEN = "Pacific/Guam";
  const onClock = (tz: string, run: () => void) => {
    process.env.TZ = tz;
    try {
      run();
    } finally {
      process.env.TZ = londonClock;
    }
  };

  it("midnight 15 Jun at UTC+10 (14:00Z on 14 Jun) is 14 Jun in London", () => {
    onClock(PLUS_TEN, () => {
      expect(formatAuDate("2026-06-14T14:00:00Z")).toBe("14 Jun 2026");
      expect(formatAuDate("2026-05-24T14:00:00Z", "long")).toBe("24 May 2026");
    });
  });

  it("a London instant keeps its London day under a UTC+10 clock", () => {
    onClock(PLUS_TEN, () => {
      expect(formatAuDate("2026-06-15T23:30:00+01:00")).toBe("15 Jun 2026");
    });
  });

  it("a date-only value (DATE column) keeps its calendar day under a clock behind UTC", () => {
    onClock("America/New_York", () => {
      expect(formatAuDate("2026-01-01")).toBe("1 Jan 2026");
    });
  });

  it("GMT in winter: 23:30Z on 31 Dec is still 31 Dec in London", () => {
    onClock(PLUS_TEN, () => {
      expect(formatAuDate("2026-12-31T23:30:00Z")).toBe("31 Dec 2026");
    });
  });
});
