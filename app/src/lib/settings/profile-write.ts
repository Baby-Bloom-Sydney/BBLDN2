/**
 * Her profile row, read and written with the version she loaded (ledger B06 §9.1 R1).
 *
 * - `readOwnProfile`: her name and the row's `updated_at` (kept exactly as the database wrote it — it is compared
 *   again on the next save). Never her address: that is her own row, `lib/settings/home-address.ts` (security H1).
 *   Her street line must never be written back to this row (H1).
 * - `writeOwnProfile`: Contact details' conditional update — only while `updated_at` is still the version she loaded.
 *   No row matched = `stale` (changed since, by her in another tab or another save); nothing is written.
 * - The caller passes the client: the user-scoped one (`createClient`), so her own-row RLS applies. Server-only by
 *   use (it takes a client), never a `"use server"` file. Nothing here logs.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnProfile {
  readonly firstName: string;
  readonly lastName: string;
  /** The row's version; null when it has none yet. */
  readonly updatedAt: string | null;
}

/** Saved (with the version now stored), stale (changed since: nothing written) or error. */
export type ProfileWrite = { readonly status: "saved"; readonly updatedAt: string } | { readonly status: "stale" | "error" };

const COLUMNS = "first_name, last_name, updated_at";

interface ProfileRow {
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly updated_at: string | null;
}

export async function readOwnProfile(client: SupabaseClient, userId: string): Promise<OwnProfile | null> {
  const { data, error } = await client.from("user_profiles").select(COLUMNS).eq("user_id", userId).maybeSingle<ProfileRow>();
  if (error || !data) return null;
  return { firstName: data.first_name ?? "", lastName: data.last_name ?? "", updatedAt: data.updated_at ?? null };
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
  if (error) return { status: "error" };
  const row: unknown = Array.isArray(data) ? data[0] : undefined;
  const version = typeof row === "object" && row !== null ? (row as { updated_at?: unknown }).updated_at : undefined;
  return typeof version === "string" ? { status: "saved", updatedAt: version } : { status: "stale" };
}
