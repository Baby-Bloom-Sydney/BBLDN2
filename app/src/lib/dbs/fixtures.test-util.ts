/**
 * Unit 3b (BB-LDN-3b-061026) — test-only fixtures for the nanny DBS screens. Synthetic values only.
 *
 * The verification row keeps the original column names (D-4: renaming them is cleanup), so this is the one test file that
 * spells them; every 3b screen test builds its rows through `dbsRow` / `dbsInput` with DBS-named fields instead.
 */
import type { VerificationData } from "@/lib/actions/verification";
import type { NannyProfile } from "@/lib/actions/nanny";
import type { UserGuidance } from "@/lib/verification";
import type { DbsDisplayInput } from "./nanny-display";

/** The stored section values 3b's states decode from (kept under D-4; `lib/verification.ts` names them NEW_INFO / NO_MATCH). */
export const STORED_SECTION = { NEW_INFO: "expired", NO_MATCH: "ocg_not_found" } as const;

export interface DbsFixture {
  code?: number;
  section?: string;
  crossCheck?: string;
  guidance?: UserGuidance | null;
  number?: string | null;
  issued?: string | null;
  checkedAt?: string | null;
  apiResult?: string | null;
  rejection?: string | null;
  method?: string | null;
  reasoning?: string | null;
  identity?: string;
}

export function dbsInput(f: DbsFixture = {}): DbsDisplayInput {
  return {
    verification_status: f.code,
    wwcc_status: f.section,
    cross_check_status: f.crossCheck,
    wwcc_user_guidance: f.guidance,
  };
}

/** A `/api/verification-status` poll body (the processing step reads it). */
export function dbsPoll(f: DbsFixture = {}): Record<string, unknown> {
  return {
    status: f.code ?? 20,
    identity_status: f.identity ?? "verified",
    contact_status: "saved",
    wwcc_status: f.section ?? "not_started",
    cross_check_status: f.crossCheck ?? "not_started",
    wwcc_user_guidance: f.guidance ?? null,
  };
}

export function dbsRow(f: DbsFixture = {}): VerificationData {
  return {
    id: "ver-1",
    identity_status: f.identity ?? "verified",
    wwcc_status: f.section ?? "not_started",
    contact_status: "saved",
    cross_check_status: f.crossCheck ?? "not_started",
    verification_status: f.code ?? 20,
    surname: "Doe",
    given_names: "Jane",
    date_of_birth: "1990-01-01",
    passport_country: "United Kingdom",
    passport_upload_url: "user-1/p.png",
    identification_photo_url: "user-1/s.png",
    identity_verified: (f.identity ?? "verified") === "verified",
    identity_rejection_reason: null,
    identity_user_guidance: null,
    extracted_passport_number: null,
    extracted_nationality: null,
    wwcc_verification_method: f.method ?? null,
    wwcc_number: f.number ?? null,
    wwcc_expiry_date: f.issued ?? null,
    wwcc_doc_verified: false,
    wwcc_verified: false,
    wwcc_rejection_reason: f.rejection ?? null,
    wwcc_user_guidance: f.guidance ?? null,
    ocg_result_status: f.apiResult ?? null,
    ocg_verified_at: f.checkedAt ?? null,
    phone_number: null,
    address_line: "1 Test Street",
    city: "London",
    state: null,
    postcode: "SW1A 1AA",
    country: "United Kingdom",
    cross_check_reasoning: f.reasoning ?? null,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
  } as VerificationData;
}

/** A profile row for `NannyMyProfile`; `staleVerifiedFlag` sets the old column that no longer drives the glance. */
export function nannyProfileFixture(level: number, staleVerifiedFlag: boolean): NannyProfile {
  return {
    first_name: "Jane", last_name: "Doe", email: "jane@example.test", mobile_number: null, date_of_birth: null,
    suburb: "Camden", postcode: "NW1 0AA", profile_picture_url: null, gender: null, nationality: null, languages: [],
    total_experience_years: 3, nanny_experience_years: 2, under_3_experience_years: null, newborn_experience_years: null,
    experience_details: null, role_types_preferred: [], level_of_support_offered: [], hourly_rate_min: null,
    pay_frequency: [], immediate_start_available: false, placement_ongoing_preferred: false, start_date_earliest: null,
    end_date_latest: null, max_children: null, min_child_age_months: null, max_child_age_months: null,
    additional_needs_ok: false, residency_status: null, right_to_work: null, drivers_license: null,
    has_car: null, comfortable_with_pets: null, vaccination_status: null, non_smoker: null, hobbies_interests: null,
    strengths_traits: null, skills_training: null, motivation: null, personality_traits: [], professional_values: [],
    childcare_roles: [], photo_1_url: null, photo_2_url: null, photo_3_url: null, nanny_id: "nanny-1", status: "active",
    verification_tier: "", verification_level: level, wwcc_verified: staleVerifiedFlag, identity_verified: level >= 2,
    highest_qualification: null, certificates: [], assurances: [], availability: null, ai_content: null,
  } as unknown as NannyProfile;
}
