/**
 * Her home address (06b-3 rework, security H1 — coordinator, option (a), ledger B06 §9.11): her own owner-only row,
 * `nanny_home_addresses` (amendment 21), never her profile row, which parents may read for a visible nanny. Her profile
 * keeps only her area (suburb, postcode), which the two saves keep in step in the same transaction.
 *
 * - `readOwnHome`: her row, read with her own session (RLS: her row only), its version kept exactly as stored.
 * - `shownHome`: what Profile and Business show — her row, or with none her area from her profile, as she saw it
 *   before (so what she sees is unchanged).
 * - `homeParts`: the row's parts from what she picked — a second line folded into the street line (as
 *   `formatAddressLine` does), the town (none when blank), the postcode as stored (capitals, one space).
 * - `saveHomeAddress`: the address alone (Business; verification's residence step with `anyVersion`), and
 *   `saveOwnProfile`: her name, date of birth and address at once (Profile), each row with the version she loaded.
 *   Both through the service client, for the user the caller proved from her session — never an id from a browser.
 *
 * Server-only by use (it takes a session or uses the service key); never a `"use server"` file. A failed call is
 * logged by its code only — never its message or details, which can carry the row (security review L4).
 * Her street line must never go back on her profile row (security H1).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HomeAddress } from "./nanny-profile-rules";

export interface OwnHome {
  /** Null when she has no row. */
  readonly home: HomeAddress | null;
  /** The row's version; null when she has no row. */
  readonly updatedAt: string | null;
}

export interface HomeParts {
  readonly line1: string;
  readonly town: string | null;
  readonly postcode: string;
}

type Refused = { readonly status: "stale" | "invalid" | "error" };
export type HomeSave = { readonly status: "saved"; readonly updatedAt: string } | Refused;
export type ProfileSave =
  | { readonly status: "saved"; readonly profileUpdatedAt: string; readonly addressUpdatedAt: string | null }
  | Refused;

/** What a Profile save may change; a field left out stays as it is. */
export interface ProfileChanges {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly date_of_birth?: string;
  readonly address?: HomeAddress;
}

interface HomeRow {
  readonly line1: string;
  readonly town: string | null;
  readonly postcode: string;
  readonly updated_at: string;
}

export async function readOwnHome(session: SupabaseClient, userId: string): Promise<OwnHome | null> {
  const { data, error } = await session
    .from("nanny_home_addresses").select("line1, town, postcode, updated_at").eq("user_id", userId).maybeSingle<HomeRow>();
  if (error) return null;
  if (!data) return { home: null, updatedAt: null };
  return { home: { line1: data.line1, line2: "", town: data.town ?? "", postcode: data.postcode }, updatedAt: data.updated_at };
}

/** Her row; with none, her area (town and postcode) as she saw it before; nothing at all → null. */
export function shownHome(own: HomeAddress | null, area: { readonly suburb: string | null; readonly postcode: string | null }): HomeAddress | null {
  if (own) return own;
  const town = area.suburb?.trim() ?? "";
  const postcode = area.postcode?.trim() ?? "";
  return town === "" && postcode === "" ? null : { line1: "", line2: "", town, postcode };
}

/** "n10aa" → "N1 0AA". */
const postcodeOf = (raw: string): string => {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
};

export function homeParts(home: HomeAddress): HomeParts {
  const line1 = [home.line1.trim(), home.line2.trim()].filter((part) => part !== "").join(", ");
  const town = home.town.trim();
  return { line1, town: town === "" ? null : town, postcode: postcodeOf(home.postcode) };
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const logFailed = (fn: string, error: { readonly code?: string }): void => {
  console.error(`[home-address] ${fn} failed`, { code: error.code ?? "unknown" });
};
const statusOf = (data: unknown): unknown => (typeof data === "object" && data !== null ? (data as { status?: unknown }).status : undefined);

function refusedOr<T>(data: unknown, saved: (reply: Record<string, unknown>) => T | null): T | Refused {
  const status = statusOf(data);
  if (status === "stale" || status === "invalid") return { status };
  if (status !== "saved") return { status: "error" };
  return saved(data as Record<string, unknown>) ?? { status: "error" };
}

export async function saveHomeAddress(userId: string, home: HomeAddress, expectedUpdatedAt: string | null, anyVersion = false): Promise<HomeSave> {
  const parts = homeParts(home);
  const { data, error } = await createAdminClient().rpc("nanny_home_address_save", {
    p_user: userId, p_line1: parts.line1, p_town: parts.town, p_postcode: parts.postcode,
    p_expected_updated_at: expectedUpdatedAt, p_any_version: anyVersion,
  });
  if (error) {
    logFailed("nanny_home_address_save", error);
    return { status: "error" };
  }
  return refusedOr(data, (reply) => (isText(reply.updated_at) ? { status: "saved", updatedAt: reply.updated_at } : null));
}

export async function saveOwnProfile(
  userId: string,
  changes: ProfileChanges,
  expected: { readonly profile: string | null; readonly address: string | null },
): Promise<ProfileSave> {
  const parts = changes.address ? homeParts(changes.address) : null;
  const { data, error } = await createAdminClient().rpc("nanny_profile_save", {
    p_user: userId,
    p_first_name: changes.first_name?.trim() ?? null,
    p_last_name: changes.last_name?.trim() ?? null,
    p_date_of_birth: changes.date_of_birth ?? null,
    p_line1: parts?.line1 ?? null,
    p_town: parts?.town ?? null,
    p_postcode: parts?.postcode ?? null,
    p_expected_profile_updated_at: expected.profile,
    p_expected_address_updated_at: expected.address,
  });
  if (error) {
    logFailed("nanny_profile_save", error);
    return { status: "error" };
  }
  return refusedOr(data, (reply) => {
    const address = reply.address_updated_at;
    if (!isText(reply.profile_updated_at) || (address !== null && !isText(address))) return null;
    return { status: "saved", profileUpdatedAt: reply.profile_updated_at, addressUpdatedAt: address };
  });
}
