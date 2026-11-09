/**
 * `PlacementData` — the shape returned by the `getParentPlacement`
 * server action and consumed by both the main `/parent/position`
 * page AND Katie's chat `<PlacementTile />` / `<PlacementCard />`.
 *
 * Lives in `lib/types/` rather than colocated with the page client
 * component so multiple consumers can import it without coupling
 * the component tree to the page module.
 */
export interface PlacementData {
  id: string;
  nannyId: string;
  nannyName: string;
  nannySuburb: string;
  nannyPhoto: string | null;
  /** Her age (the family's screens never get her date of birth). */
  nannyAge: number | null;
  weeklyHours: number | null;
  hourlyRate: number | null;
  hiredAt: string;
  startDate: string | null;
  nannyEmail: string | null;
  nannyPhone: string | null;
  totalExperienceYears: number | null;
  nannyExperienceYears: number | null;
  highestQualification: string | null;
  certifications: string[];
  wwccVerified: boolean;
  wwccExpiry: string | null;
  vaccinationStatus: boolean;
  nannyHourlyRate: number | null;
}
