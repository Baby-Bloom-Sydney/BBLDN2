/**
 * A match as its cards show it, for anything sent to the browser: the nanny's first name, last initial, area, photo
 * and age; her experience counts, rate and headline; and the match's own scores and lists. The engine's full rows
 * (her account id, full last name, date of birth, the rest of her nanny row) stay on the server, where the DFY
 * emails use them. Pure.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { profileAge } from "@/lib/profile-age";
import type { MatchResult } from "./types";

export interface PublicMatchProfile {
  first_name: string;
  /** The initial of her last name. */
  last_name: string;
  suburb: string | null;
  profile_picture_url: string | null;
  age: number | null;
}

export interface PublicMatchNanny {
  id: string;
  total_experience_years: number | null;
  nanny_experience_years: number | null;
  under_3_experience_years: number | null;
  newborn_experience_years: number | null;
  hourly_rate_min: number | null;
  ai_content: { headline?: string } | null;
}

export type PublicMatchResult = Omit<MatchResult, "nanny" | "profile"> & {
  nanny: PublicMatchNanny;
  profile: PublicMatchProfile;
};

export function publicMatch(match: MatchResult): PublicMatchResult {
  const { nanny, profile, ...scores } = match;
  const headline = nanny.ai_content?.headline;
  return {
    ...scores,
    nanny: {
      id: nanny.id,
      total_experience_years: nanny.total_experience_years,
      nanny_experience_years: nanny.nanny_experience_years,
      under_3_experience_years: nanny.under_3_experience_years,
      newborn_experience_years: nanny.newborn_experience_years,
      hourly_rate_min: nanny.hourly_rate_min,
      ai_content: headline ? { headline } : null,
    },
    profile: {
      first_name: profile.first_name,
      last_name: (profile.last_name ?? "").charAt(0),
      suburb: profile.suburb,
      profile_picture_url: profile.profile_picture_url,
      age: profileAge(profile.date_of_birth),
    },
  };
}
