/**
 * The fields the nanny profile action writes, and where each goes: her profile row, her nannies row, or the related
 * tables (availability, credentials, assurances). Anything not on the list is refused before any write.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import { NANNY_KEYS, PROFILE_KEYS, RELATED_KEYS, splitProfileUpdate, touchesIdentity } from "./nanny-profile-keys";

describe("the field lists", () => {
  it("her profile row: name, mobile, date of birth, area, photo", () => {
    expect([...PROFILE_KEYS]).toEqual(["first_name", "last_name", "mobile_number", "date_of_birth", "suburb", "postcode", "profile_picture_url"]);
  });

  it("the related tables: qualification, certificates, assurances, availability", () => {
    expect([...RELATED_KEYS]).toEqual(["highest_qualification", "certificates", "assurances", "available_days", "schedule"]);
  });

  it("her nannies row: her profile's own fields only", () => {
    expect([...NANNY_KEYS]).toEqual([
      "gender", "nationality", "languages",
      "total_experience_years", "nanny_experience_years", "under_3_experience_years", "newborn_experience_years", "experience_details",
      "role_types_preferred", "level_of_support_offered",
      "hourly_rate_min", "pay_frequency", "immediate_start_available", "placement_ongoing_preferred", "start_date_earliest", "end_date_latest",
      "max_children", "min_child_age_months", "max_child_age_months", "additional_needs_ok",
      "sydney_resident", "residency_status", "right_to_work", "drivers_license", "has_car", "comfortable_with_pets", "vaccination_status", "non_smoker",
      "hobbies_interests", "strengths_traits", "skills_training",
      "motivation", "personality_traits", "professional_values", "childcare_roles", "photo_1_url", "photo_2_url", "photo_3_url",
    ]);
  });

  it("no field is on two lists", () => {
    const all = [...PROFILE_KEYS, ...NANNY_KEYS, ...RELATED_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("splitProfileUpdate", () => {
  it("sends each field to its row and leaves the related ones to their own writes", () => {
    expect(splitProfileUpdate({ profile_picture_url: "https://x/p.jpg", hourly_rate_min: 21, languages: ["English"], certificates: ["First Aid"] }))
      .toEqual({ ok: true, profile: { profile_picture_url: "https://x/p.jpg" }, nanny: { hourly_rate_min: 21, languages: ["English"] } });
  });

  it("an empty update writes nothing", () => {
    expect(splitProfileUpdate({})).toEqual({ ok: true, profile: {}, nanny: {} });
  });

  it("keeps a field sent as null or undefined, as before", () => {
    expect(splitProfileUpdate({ photo_1_url: undefined, nationality: null })).toEqual({ ok: true, profile: {}, nanny: { photo_1_url: undefined, nationality: null } });
  });

  it("refuses the whole update when any field is not on the lists", () => {
    for (const key of ["unlisted_field", "user_id", "id", "email", "constructor"]) {
      expect(splitProfileUpdate({ hourly_rate_min: 21, [key]: 4 })).toEqual({ ok: false });
    }
    expect(splitProfileUpdate(JSON.parse('{"hourly_rate_min":21,"__proto__":{"x":1}}'))).toEqual({ ok: false });
  });

  it("accepts the related fields in their shapes", () => {
    const related = { highest_qualification: null, certificates: ["First Aid"], assurances: [], available_days: ["Mon"], schedule: { Mon: ["am"] } };
    expect(splitProfileUpdate(related)).toEqual({ ok: true, profile: {}, nanny: {} });
    expect(splitProfileUpdate({ highest_qualification: "Level 3", schedule: undefined })).toEqual({ ok: true, profile: {}, nanny: {} });
  });

  it("refuses a related field in the wrong shape", () => {
    for (const bad of [
      { certificates: "First Aid" }, { assurances: [1] }, { available_days: null }, { highest_qualification: 3 },
      { schedule: ["Mon"] }, { schedule: { Mon: "am" } }, { schedule: null },
    ]) {
      expect(splitProfileUpdate(bad)).toEqual({ ok: false });
    }
  });

  it("refuses anything but a plain object", () => {
    for (const bad of [null, undefined, "x", 3, ["hourly_rate_min"]]) expect(splitProfileUpdate(bad)).toEqual({ ok: false });
  });

  it("returns new objects, never the one it was given", () => {
    const input = { hourly_rate_min: 21 };
    const split = splitProfileUpdate(input);
    expect(split.ok && split.nanny).not.toBe(input);
  });
});

describe("touchesIdentity", () => {
  it("is true when her name or date of birth is sent", () => {
    expect(touchesIdentity({ first_name: "A" })).toBe(true);
    expect(touchesIdentity({ last_name: "B" })).toBe(true);
    expect(touchesIdentity({ date_of_birth: null })).toBe(true);
  });

  it("is false otherwise, and for a field sent as undefined", () => {
    expect(touchesIdentity({ hourly_rate_min: 21, mobile_number: "+447700900001" })).toBe(false);
    expect(touchesIdentity({ first_name: undefined })).toBe(false);
  });
});
