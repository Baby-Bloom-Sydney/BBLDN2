/**
 * The fields `updateNannyProfile` writes, and where each goes: her profile row (`user_profiles`), her nannies row, or
 * the related tables (availability, credentials, assurances), which the action writes from their own fields. Anything
 * not on these lists is refused before any write. Her name and date of birth are the identity fields: fixed once her
 * identity is verified (`identity-lock.ts`).
 *
 * The lists and `UpdateNannyProfileData` name the same keys (checked at compile time below).
 *
 * BB-wave1-041126, 2026-11-09.
 */

export interface UpdateNannyProfileData {
  // user_profiles fields
  first_name?: string;
  last_name?: string;
  mobile_number?: string | null;
  date_of_birth?: string | null;
  suburb?: string;
  postcode?: string;
  profile_picture_url?: string | null;

  // nannies fields
  gender?: string | null;
  nationality?: string | null;
  languages?: string[] | null;

  total_experience_years?: number | null;
  nanny_experience_years?: number | null;
  under_3_experience_years?: number | null;
  newborn_experience_years?: number | null;
  experience_details?: string | null;

  role_types_preferred?: string[] | null;
  level_of_support_offered?: string[] | null;

  hourly_rate_min?: number | null;
  pay_frequency?: string[] | null;
  immediate_start_available?: boolean;
  placement_ongoing_preferred?: boolean;
  start_date_earliest?: string | null;
  end_date_latest?: string | null;

  max_children?: number | null;
  min_child_age_months?: number | null;
  max_child_age_months?: number | null;
  additional_needs_ok?: boolean;

  sydney_resident?: boolean | null;
  residency_status?: string | null;
  right_to_work?: boolean | null;
  drivers_license?: boolean | null;
  has_car?: boolean | null;
  comfortable_with_pets?: boolean | null;
  vaccination_status?: boolean | null;
  non_smoker?: boolean | null;

  hobbies_interests?: string | null;
  strengths_traits?: string | null;
  skills_training?: string | null;

  // V2 onboarding fields
  motivation?: string | null;
  personality_traits?: string[] | null;
  professional_values?: string[] | null;
  childcare_roles?: { role: string; duration: number }[] | null;
  photo_1_url?: string | null;
  photo_2_url?: string | null;
  photo_3_url?: string | null;

  // Related table fields
  highest_qualification?: string | null;
  certificates?: string[];
  assurances?: string[];
  available_days?: string[];
  schedule?: Record<string, string[]>;
}

/** Her profile row. */
export const PROFILE_KEYS = ["first_name", "last_name", "mobile_number", "date_of_birth", "suburb", "postcode", "profile_picture_url"] as const;

/** The related tables, written by the action from these fields (never to her nannies row). */
export const RELATED_KEYS = ["highest_qualification", "certificates", "assurances", "available_days", "schedule"] as const;

/** Her nannies row: her profile's own fields. */
export const NANNY_KEYS = [
  "gender", "nationality", "languages",
  "total_experience_years", "nanny_experience_years", "under_3_experience_years", "newborn_experience_years", "experience_details",
  "role_types_preferred", "level_of_support_offered",
  "hourly_rate_min", "pay_frequency", "immediate_start_available", "placement_ongoing_preferred", "start_date_earliest", "end_date_latest",
  "max_children", "min_child_age_months", "max_child_age_months", "additional_needs_ok",
  "sydney_resident", "residency_status", "right_to_work", "drivers_license", "has_car", "comfortable_with_pets", "vaccination_status", "non_smoker",
  "hobbies_interests", "strengths_traits", "skills_training",
  "motivation", "personality_traits", "professional_values", "childcare_roles", "photo_1_url", "photo_2_url", "photo_3_url",
] as const;

/** Her name and date of birth. */
export const IDENTITY_KEYS = ["first_name", "last_name", "date_of_birth"] as const;

type Listed = (typeof PROFILE_KEYS)[number] | (typeof RELATED_KEYS)[number] | (typeof NANNY_KEYS)[number];
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time: the three lists name exactly the keys of `UpdateNannyProfileData`. */
const LISTS_MATCH_THE_TYPE: SameKeys<Listed, keyof UpdateNannyProfileData> = true;
void LISTS_MATCH_THE_TYPE;

const PROFILE = new Set<string>(PROFILE_KEYS);
const NANNY = new Set<string>(NANNY_KEYS);
const ALL = new Set<string>([...PROFILE_KEYS, ...RELATED_KEYS, ...NANNY_KEYS]);

export type ProfileUpdateSplit =
  | { readonly ok: true; readonly profile: Readonly<Record<string, unknown>>; readonly nanny: Readonly<Record<string, unknown>> }
  | { readonly ok: false };

const isStrings = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === "string");
const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The related fields' shapes, as the action writes them (absent or undefined: not sent). */
const RELATED_SHAPES: Readonly<Record<(typeof RELATED_KEYS)[number], (value: unknown) => boolean>> = {
  highest_qualification: (value) => value === null || typeof value === "string",
  certificates: isStrings,
  assurances: isStrings,
  available_days: isStrings,
  schedule: (value) => isPlainObject(value) && Object.values(value).every(isStrings),
};

/** Her update split by row: new objects, the related fields left out. Any field not on the lists, or a related field
 *  in the wrong shape, refuses it all. */
export function splitProfileUpdate(data: unknown): ProfileUpdateSplit {
  if (!isPlainObject(data)) return { ok: false };
  const entries = Object.entries(data);
  if (entries.some(([key]) => !ALL.has(key))) return { ok: false };
  const badShape = RELATED_KEYS.some((key) => data[key] !== undefined && !RELATED_SHAPES[key](data[key]));
  if (badShape) return { ok: false };
  return {
    ok: true,
    profile: Object.fromEntries(entries.filter(([key]) => PROFILE.has(key))),
    nanny: Object.fromEntries(entries.filter(([key]) => NANNY.has(key))),
  };
}

/** Whether the update sends her name or date of birth (a field sent as undefined writes nothing). */
export function touchesIdentity(data: Readonly<Record<string, unknown>>): boolean {
  return IDENTITY_KEYS.some((key) => data[key] !== undefined);
}
