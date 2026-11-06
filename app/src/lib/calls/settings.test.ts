/** Call settings: defaults and bounds that match amendment 19's CHECKs (plan A5). */
import { describe, expect, it } from "vitest";
import { CALL_LENGTH_CHOICES, CALL_SETTINGS_DEFAULTS, parseSettingsUpdate, settingsFromRow } from "./settings";

const ROW = {
  id: 1,
  slot_minutes: 45,
  window_days: 7,
  notice_minutes: 120,
  hold_minutes: 5,
  parent_reminder_minutes: 1440,
  admin_reminder_minutes: 15,
  overdue_grace_minutes: 15,
  not_booked_delay_minutes: 30,
  caller_number: "+442079460000",
  enabled_since: "2027-02-01T09:00:00+00:00",
};

describe("CALL_SETTINGS_DEFAULTS", () => {
  it("are 30 / 7 / 120 / 5 / 1440 / 15 / 15 / 30, no caller number, not started", () => {
    expect(CALL_SETTINGS_DEFAULTS).toEqual({
      slotMinutes: 30,
      windowDays: 7,
      noticeMinutes: 120,
      holdMinutes: 5,
      parentReminderMinutes: 1440,
      adminReminderMinutes: 15,
      overdueGraceMinutes: 15,
      notBookedDelayMinutes: 30,
      callerNumber: null,
      enabledSince: null,
    });
    expect(Object.isFrozen(CALL_SETTINGS_DEFAULTS)).toBe(true);
  });
});

describe("parseSettingsUpdate — the call length is a fixed choice (brief §0a.13, BAI 2026-11-06)", () => {
  it("the choices are 15, 20, 30, 45 and 60 minutes, frozen", () => {
    expect(CALL_LENGTH_CHOICES).toEqual([15, 20, 30, 45, 60]);
    expect(Object.isFrozen(CALL_LENGTH_CHOICES)).toBe(true);
  });

  it.each([15, 20, 30, 45, 60])("%s minutes → ok", (minutes) => {
    expect(parseSettingsUpdate({ slotMinutes: minutes })).toEqual({ ok: true, value: { slotMinutes: minutes } });
  });

  it.each([5, 10, 25, 40, 90, 240, 4, 241, 30.5, 0, -30, Number.NaN])("%s minutes → refused, though the database's 5–240 would take some", (minutes) => {
    expect(parseSettingsUpdate({ slotMinutes: minutes })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("parseSettingsUpdate — the SQL bounds", () => {
  it.each([
    ["windowDays", 1, true],
    ["windowDays", 28, true],
    ["windowDays", 0, false],
    ["windowDays", 29, false],
    ["noticeMinutes", 0, true],
    ["noticeMinutes", 10080, true],
    ["noticeMinutes", -1, false],
    ["noticeMinutes", 10081, false],
    ["holdMinutes", 1, true],
    ["holdMinutes", 60, true],
    ["holdMinutes", 0, false],
    ["holdMinutes", 61, false],
    ["parentReminderMinutes", 1, true],
    ["parentReminderMinutes", 0, false],
    ["adminReminderMinutes", 0, false],
    ["overdueGraceMinutes", 0, true],
    ["overdueGraceMinutes", -1, false],
    ["notBookedDelayMinutes", 0, false],
    ["slotMinutes", "30", false],
  ])("%s = %s → ok %s", (field, value, ok) => {
    expect(parseSettingsUpdate({ [field]: value }).ok).toBe(ok);
  });

  it.each([
    ["+447700900123", "+447700900123"],
    ["+442079460000", "+442079460000"],
    [" +44 20 7946 0000 ", "+442079460000"],
    ["", null],
    [null, null],
  ])("caller number %j → %j", (input, expected) => {
    const parsed = parseSettingsUpdate({ callerNumber: input });
    expect(parsed).toEqual({ ok: true, value: { callerNumber: expected } });
  });

  it.each(["07700900123", "+4477009", "+4420794600001234", "+1 202 555 0100", "tel:+447700900123"])(
    "refuses caller number %j",
    (input) => {
      expect(parseSettingsUpdate({ callerNumber: input })).toEqual({ ok: false, error: "invalid" });
    },
  );

  it("is a partial patch: only the fields given come back", () => {
    expect(parseSettingsUpdate({ slotMinutes: 45 })).toEqual({ ok: true, value: { slotMinutes: 45 } });
  });

  it("refuses enabledSince (set only by Start call booking), unknown keys and non-objects", () => {
    expect(parseSettingsUpdate({ enabledSince: "2027-02-01T09:00:00Z" }).ok).toBe(false);
    expect(parseSettingsUpdate({ colour: "violet" }).ok).toBe(false);
    expect(parseSettingsUpdate(null).ok).toBe(false);
    expect(parseSettingsUpdate("slotMinutes=30").ok).toBe(false);
  });
});

describe("settingsFromRow — the database row", () => {
  it("maps every column and normalises the timestamp", () => {
    expect(settingsFromRow(ROW)).toEqual({
      slotMinutes: 45,
      windowDays: 7,
      noticeMinutes: 120,
      holdMinutes: 5,
      parentReminderMinutes: 1440,
      adminReminderMinutes: 15,
      overdueGraceMinutes: 15,
      notBookedDelayMinutes: 30,
      callerNumber: "+442079460000",
      enabledSince: "2027-02-01T09:00:00.000Z",
    });
  });

  it("keeps nulls", () => {
    expect(settingsFromRow({ ...ROW, caller_number: null, enabled_since: null })).toMatchObject({
      callerNumber: null,
      enabledSince: null,
    });
  });

  it.each([5, 25, 240])("a stored length off the list but inside the database's 5–240 (%s) still reads — a read never fails on it", (minutes) => {
    expect(settingsFromRow({ ...ROW, slot_minutes: minutes })?.slotMinutes).toBe(minutes);
  });

  it("returns null for a row that isn't one", () => {
    expect(settingsFromRow(null)).toBeNull();
    expect(settingsFromRow({ ...ROW, slot_minutes: "thirty" })).toBeNull();
    expect(settingsFromRow({ ...ROW, slot_minutes: 4 })).toBeNull();
    expect(settingsFromRow({ ...ROW, enabled_since: "not a time" })).toBeNull();
  });
});
