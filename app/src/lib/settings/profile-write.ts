/**
 * Her profile row, read and written with the version she loaded (ledger B06 §9.1 R1, R2): the one writer the Profile,
 * Contact details and Business saves share, so "changed elsewhere" means the same thing on every page.
 *
 * - `readOwnProfile`: her name, her address and the row's `updated_at` (kept exactly as the database wrote it — it is
 *   compared again on the next save).
 * - `writeOwnProfile`: a conditional update — only while `updated_at` is still the version she loaded. No row matched
 *   = `stale` (changed since, by her in another tab or by verification's residence step); nothing is written.
 * - `addressColumns`: her address as verification's residence step stores it (`address_line1` the street line,
 *   `address_line2` null, `suburb` the town, `postcode`).
 * - The caller passes the client: the user-scoped one (`createClient`), so her own-row RLS applies. Server-only by
 *   use (it takes a client), never a `"use server"` file. Nothing here logs.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomeAddress } from "./nanny-profile-rules";

export interface OwnProfile {
  readonly firstName: string;
  readonly lastName: string;
  /** Null when none of its parts is on file. */
  readonly home: HomeAddress | null;
  /** The row's version; null when it has none yet. */
  readonly updatedAt: string | null;
}

export type ProfileWrite = "saved" | "stale" | "error";

const COLUMNS = "first_name, last_name, address_line1, address_line2, suburb, postcode, updated_at";

interface ProfileRow {
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly suburb: string | null;
  readonly postcode: string | null;
  readonly updated_at: string | null;
}

function homeOf(row: ProfileRow): HomeAddress | null {
  const home = { line1: row.address_line1 ?? "", line2: row.address_line2 ?? "", town: row.suburb ?? "", postcode: row.postcode ?? "" };
  return Object.values(home).some((part) => part.trim() !== "") ? home : null;
}

export async function readOwnProfile(client: SupabaseClient, userId: string): Promise<OwnProfile | null> {
  const { data, error } = await client.from("user_profiles").select(COLUMNS).eq("user_id", userId).maybeSingle<ProfileRow>();
  if (error || !data) return null;
  return { firstName: data.first_name ?? "", lastName: data.last_name ?? "", home: homeOf(data), updatedAt: data.updated_at ?? null };
}

/** "n1 0aa" → "N1 0AA". */
const postcodeOf = (raw: string): string => {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
};

export function addressColumns(home: HomeAddress): Readonly<Record<string, string | null>> {
  return { address_line1: home.line1.trim(), address_line2: null, suburb: home.town.trim(), postcode: postcodeOf(home.postcode) };
}

export async function writeOwnProfile(
  client: SupabaseClient,
  userId: string,
  fields: Readonly<Record<string, string | null>>,
  expectedUpdatedAt: string | null,
): Promise<ProfileWrite> {
  const mine = client.from("user_profiles").update(fields).eq("user_id", userId);
  const guarded = expectedUpdatedAt === null ? mine.is("updated_at", null) : mine.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await guarded.select("updated_at");
  if (error) return "error";
  return Array.isArray(data) && data.length > 0 ? "saved" : "stale";
}
