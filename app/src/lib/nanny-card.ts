/**
 * A nanny's browse card as the screens show it: her first name, the initial of her last name and her age — never her
 * account id, full last name or date of birth (the cards go to the browser). Sort by date of birth before this.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import type { NannyCardData } from "@/components/NannyCard";
import { profileAge } from "@/lib/profile-age";

export function publicNannyCard(card: NannyCardData): NannyCardData {
  const { user_id: _userId, date_of_birth: dateOfBirth, last_name: lastName, ...shown } = card;
  return { ...shown, last_name: (lastName ?? "").charAt(0), age: profileAge(dateOfBirth ?? null) };
}
