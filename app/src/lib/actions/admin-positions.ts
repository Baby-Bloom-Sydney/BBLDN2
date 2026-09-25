// ── Admin/AI Position Management ──
// Creates, updates, and closes positions via API (no parent auth required).
// Uses SYSTEM_PARENT_ID as the parent_id for all admin/AI positions.

import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/constants";

const appUrl =
  SITE_URL;

const VALID_SCHEDULE_TYPES = ["Fixed", "Flexible"] as const;
const VALID_PLACEMENT_LENGTHS = ["Ongoing", "Temporarily"] as const;
const VALID_URGENCY = ["As soon as possible", "At a later date"] as const;
const VALID_LANGUAGE = ["English", "Foreign language", "Multiple"] as const;
const VALID_EXPERIENCE = [1, 2, 3, 5] as const;
const VALID_MIN_AGE = [18, 21, 25, 28, 35] as const;
const VALID_FOCUS = ["Educational play", "Just supervision"] as const;
const VALID_SUPPORT = [
  "Tailored developmental support",
  "Just standard routines",
] as const;
const VALID_SOURCES = ["admin", "ai_agent"] as const;
const VALID_BRACKETS = ["morning", "midday", "afternoon", "evening"] as const;
const VALID_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface AdminPositionInput {
  family_display_name: string;
  suburb: string;
  children: Array<{ age_months: number; gender: string | null }>;
  hourly_rate?: number;
  hours_per_week?: number;
  schedule_type?: "Fixed" | "Flexible";
  days_required?: string[];
  schedule?: Record<string, string[]>;
  placement_length?: "Ongoing" | "Temporarily";
  urgency?: "As soon as possible" | "At a later date";
  start_date?: string;
  expires_at?: string;
  reason_for_nanny?: string[];
  drivers_license_required?: boolean;
  car_required?: boolean;
  comfortable_with_pets_required?: boolean;
  language_preference?: "English" | "Foreign language" | "Multiple";
  language_preference_details?: string;
  years_of_experience?: 1 | 2 | 3 | 5;
  minimum_age_requirement?: 18 | 21 | 25 | 28 | 35;
  focus_type?: "Educational play" | "Just supervision";
  support_type?: "Tailored developmental support" | "Just standard routines";
  child_needs?: boolean;
  child_needs_details?: string;
  description?: string;
  source?: "admin" | "ai_agent";
}

function validate(input: AdminPositionInput): string | null {
  if (!input.family_display_name?.trim())
    return "family_display_name is required";
  if (!input.suburb?.trim()) return "suburb is required";
  if (!input.children || input.children.length === 0)
    return "At least 1 child is required";
  if (input.children.length > 3) return "Maximum 3 children";

  for (const c of input.children) {
    if (
      typeof c.age_months !== "number" ||
      c.age_months < 0 ||
      c.age_months > 192
    ) {
      return "Each child age_months must be 0-192";
    }
    if (c.gender && !["Female", "Male", "Rather Not Say"].includes(c.gender)) {
      return "Child gender must be Female, Male, Rather Not Say, or null";
    }
  }

  if (
    input.schedule_type &&
    !VALID_SCHEDULE_TYPES.includes(input.schedule_type)
  ) {
    return `schedule_type must be one of: ${VALID_SCHEDULE_TYPES.join(", ")}`;
  }
  if (
    input.placement_length &&
    !VALID_PLACEMENT_LENGTHS.includes(input.placement_length)
  ) {
    return `placement_length must be one of: ${VALID_PLACEMENT_LENGTHS.join(", ")}`;
  }
  if (input.urgency && !VALID_URGENCY.includes(input.urgency)) {
    return `urgency must be one of: ${VALID_URGENCY.join(", ")}`;
  }
  if (
    input.language_preference &&
    !VALID_LANGUAGE.includes(input.language_preference)
  ) {
    return `language_preference must be one of: ${VALID_LANGUAGE.join(", ")}`;
  }
  if (
    input.years_of_experience != null &&
    !VALID_EXPERIENCE.includes(input.years_of_experience)
  ) {
    return `years_of_experience must be one of: ${VALID_EXPERIENCE.join(", ")}`;
  }
  if (
    input.minimum_age_requirement != null &&
    !VALID_MIN_AGE.includes(input.minimum_age_requirement)
  ) {
    return `minimum_age_requirement must be one of: ${VALID_MIN_AGE.join(", ")}`;
  }
  if (input.focus_type && !VALID_FOCUS.includes(input.focus_type)) {
    return `focus_type must be one of: ${VALID_FOCUS.join(", ")}`;
  }
  if (input.support_type && !VALID_SUPPORT.includes(input.support_type)) {
    return `support_type must be one of: ${VALID_SUPPORT.join(", ")}`;
  }
  if (input.source && !VALID_SOURCES.includes(input.source)) {
    return `source must be one of: ${VALID_SOURCES.join(", ")}`;
  }
  if (input.days_required) {
    for (const d of input.days_required) {
      if (!VALID_DAYS.includes(d as (typeof VALID_DAYS)[number])) {
        return `Invalid day: ${d}. Must be title-case day name.`;
      }
    }
  }
  if (input.schedule) {
    for (const [day, brackets] of Object.entries(input.schedule)) {
      for (const b of brackets) {
        if (!VALID_BRACKETS.includes(b as (typeof VALID_BRACKETS)[number])) {
          return `Invalid time bracket "${b}" for ${day}. Must be morning, midday, afternoon, or evening.`;
        }
      }
    }
  }
  // AI positions must never include pricing
  if (input.source === "ai_agent" && input.hourly_rate != null) {
    return "AI agent positions must not include hourly_rate";
  }
  if (input.hourly_rate != null && input.hourly_rate <= 0) {
    return "hourly_rate must be positive";
  }
  if (input.hours_per_week != null && input.hours_per_week <= 0) {
    return "hours_per_week must be positive";
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// CREATE
// ════════════════════════════════════════════════════════════

export async function createAdminPosition(input: AdminPositionInput): Promise<{
  success: boolean;
  error: string | null;
  position_id?: string;
  public_url?: string;
}> {
  const validationError = validate(input);
  if (validationError) return { success: false, error: validationError };

  const systemParentId = process.env.SYSTEM_PARENT_ID;
  if (!systemParentId)
    return { success: false, error: "SYSTEM_PARENT_ID env var not set" };

  const admin = createAdminClient();
  const source = input.source ?? "admin";

  // Look up the postcode district prefix from the district name.
  // ADR-188: a prefix is 2-4 alphanumerics ("SW4", "E1"), never a number.
  let postcode: string | null = null;
  const { data: districtRow } = await admin
    .from("london_districts")
    .select("prefix")
    .ilike("district", input.suburb)
    .limit(1)
    .maybeSingle();
  if (districtRow) postcode = districtRow.prefix;

  // Build details JSONB
  const details: Record<string, unknown> = {
    focus_type: input.focus_type ?? null,
    support_type: input.support_type ?? null,
    child_needs: input.child_needs ?? false,
    child_needs_details: input.child_needs_details ?? null,
    form_data: null, // No typeform data for admin positions
  };

  // Build position row
  const positionRow = {
    parent_id: systemParentId,
    source,
    family_display_name: input.family_display_name.trim(),
    status: "active" as const,
    stage: 1,
    position_status: 1,
    suburb: input.suburb,
    postcode,
    hourly_rate: input.hourly_rate ?? null,
    hours_per_week: input.hours_per_week ?? null,
    schedule_type: input.schedule_type ?? null,
    days_required: input.days_required ?? null,
    placement_length: input.placement_length ?? null,
    urgency: input.urgency ?? null,
    start_date: input.start_date ?? null,
    expires_at: input.expires_at ?? null,
    reason_for_nanny: input.reason_for_nanny ?? null,
    drivers_license_required: input.drivers_license_required ?? false,
    car_required: input.car_required ?? false,
    comfortable_with_pets_required:
      input.comfortable_with_pets_required ?? false,
    vaccination_required: false,
    non_smoker_required: false,
    language_preference: input.language_preference ?? "English",
    language_preference_details: input.language_preference_details ?? null,
    years_of_experience: input.years_of_experience ?? null,
    minimum_age_requirement: input.minimum_age_requirement ?? null,
    description: input.description ?? null,
    details,
  };

  const { data: position, error: posErr } = await admin
    .from("nanny_positions")
    .insert(positionRow)
    .select("id")
    .single();

  if (posErr || !position) {
    return {
      success: false,
      error: posErr?.message ?? "Failed to create position",
    };
  }

  const positionId = position.id;

  // Insert children
  const childRows = input.children.map((c, i) => ({
    position_id: positionId,
    child_label: ["A", "B", "C"][i],
    age_months: c.age_months,
    gender: c.gender,
    display_order: i + 1,
  }));

  const { error: childErr } = await admin
    .from("position_children")
    .insert(childRows);

  if (childErr) {
    console.error("Failed to insert children:", childErr);
  }

  // Upsert schedule if provided
  if (input.schedule && Object.keys(input.schedule).length > 0) {
    const { error: schedErr } = await admin.from("position_schedule").upsert(
      {
        position_id: positionId,
        schedule: input.schedule,
      },
      { onConflict: "position_id" },
    );

    if (schedErr) {
      console.error("Failed to upsert schedule:", schedErr);
    }
  }

  return {
    success: true,
    error: null,
    position_id: positionId,
    public_url: `${appUrl}/position/${positionId}`,
  };
}

// ════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════

export async function updateAdminPosition(
  id: string,
  input: Partial<AdminPositionInput>,
): Promise<{ success: boolean; error: string | null; position_id?: string }> {
  const admin = createAdminClient();

  // Verify position exists and is admin/AI-created
  const { data: existing, error: fetchErr } = await admin
    .from("nanny_positions")
    .select("id, source")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !existing)
    return { success: false, error: "Position not found" };
  if (existing.source === "parent")
    return {
      success: false,
      error: "Cannot update parent-created positions via API",
    };

  // Build update object (only provided fields)
  const updates: Record<string, unknown> = {};

  if (input.family_display_name !== undefined)
    updates.family_display_name = input.family_display_name.trim();
  if (input.suburb !== undefined) {
    updates.suburb = input.suburb;
    const { data: districtRow } = await admin
      .from("london_districts")
      .select("prefix")
      .ilike("district", input.suburb)
      .limit(1)
      .maybeSingle();
    if (districtRow) updates.postcode = districtRow.prefix;
  }
  if (input.hourly_rate !== undefined) updates.hourly_rate = input.hourly_rate;
  if (input.hours_per_week !== undefined)
    updates.hours_per_week = input.hours_per_week;
  if (input.schedule_type !== undefined)
    updates.schedule_type = input.schedule_type;
  if (input.days_required !== undefined)
    updates.days_required = input.days_required;
  if (input.placement_length !== undefined)
    updates.placement_length = input.placement_length;
  if (input.urgency !== undefined) updates.urgency = input.urgency;
  if (input.start_date !== undefined) updates.start_date = input.start_date;
  if (input.expires_at !== undefined) updates.expires_at = input.expires_at;
  if (input.reason_for_nanny !== undefined)
    updates.reason_for_nanny = input.reason_for_nanny;
  if (input.drivers_license_required !== undefined)
    updates.drivers_license_required = input.drivers_license_required;
  if (input.car_required !== undefined)
    updates.car_required = input.car_required;
  if (input.comfortable_with_pets_required !== undefined)
    updates.comfortable_with_pets_required =
      input.comfortable_with_pets_required;
  if (input.language_preference !== undefined)
    updates.language_preference = input.language_preference;
  if (input.language_preference_details !== undefined)
    updates.language_preference_details = input.language_preference_details;
  if (input.years_of_experience !== undefined)
    updates.years_of_experience = input.years_of_experience;
  if (input.minimum_age_requirement !== undefined)
    updates.minimum_age_requirement = input.minimum_age_requirement;
  if (input.description !== undefined) updates.description = input.description;
  if (input.source !== undefined) updates.source = input.source;

  // Update details JSONB fields if provided
  if (
    input.focus_type !== undefined ||
    input.support_type !== undefined ||
    input.child_needs !== undefined ||
    input.child_needs_details !== undefined
  ) {
    const { data: current } = await admin
      .from("nanny_positions")
      .select("details")
      .eq("id", id)
      .single();
    const currentDetails = (current?.details as Record<string, unknown>) ?? {};
    if (input.focus_type !== undefined)
      currentDetails.focus_type = input.focus_type;
    if (input.support_type !== undefined)
      currentDetails.support_type = input.support_type;
    if (input.child_needs !== undefined)
      currentDetails.child_needs = input.child_needs;
    if (input.child_needs_details !== undefined)
      currentDetails.child_needs_details = input.child_needs_details;
    updates.details = currentDetails;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await admin
      .from("nanny_positions")
      .update(updates)
      .eq("id", id);

    if (updateErr) return { success: false, error: updateErr.message };
  }

  // Replace children if provided
  if (input.children) {
    await admin.from("position_children").delete().eq("position_id", id);
    const childRows = input.children.map((c, i) => ({
      position_id: id,
      child_label: ["A", "B", "C"][i],
      age_months: c.age_months,
      gender: c.gender,
      display_order: i + 1,
    }));
    await admin.from("position_children").insert(childRows);
  }

  // Replace schedule if provided
  if (input.schedule) {
    await admin.from("position_schedule").upsert(
      {
        position_id: id,
        schedule: input.schedule,
      },
      { onConflict: "position_id" },
    );
  }

  return { success: true, error: null, position_id: id };
}

// ════════════════════════════════════════════════════════════
// CLOSE
// ════════════════════════════════════════════════════════════

export async function closeAdminPosition(id: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  const admin = createAdminClient();

  const { data: existing, error: fetchErr } = await admin
    .from("nanny_positions")
    .select("id, source, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !existing)
    return { success: false, error: "Position not found" };
  if (existing.source === "parent")
    return {
      success: false,
      error: "Cannot close parent-created positions via API",
    };
  if (existing.status === "cancelled")
    return { success: false, error: "Position is already closed" };

  const { error: updateErr } = await admin
    .from("nanny_positions")
    .update({
      status: "cancelled",
      stage: 60,
      position_status: 61,
      closed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) return { success: false, error: updateErr.message };

  return { success: true, error: null };
}

// ════════════════════════════════════════════════════════════
// LIST (for API GET)
// ════════════════════════════════════════════════════════════

// Two-hop fallback: when a real parent position has family_display_name NULL,
// resolve the parent's surname via position.parent_id → parents.user_id →
// user_profiles.last_name and compose "{last_name} ({suburb})" (KEY-1 ratified
// 2026-06-02). Batched to keep the list endpoint O(1) DB calls per join hop.
async function resolveLastNameByParent(
  admin: ReturnType<typeof createAdminClient>,
  parentIds: readonly string[],
): Promise<Map<string, string>> {
  const lastNameByParent = new Map<string, string>();
  if (parentIds.length === 0) return lastNameByParent;

  const { data: parentRows } = await admin
    .from("parents")
    .select("id, user_id")
    .in("id", [...parentIds]);

  const userIdByParent = new Map<string, string>();
  for (const row of parentRows ?? []) {
    if (row.user_id) userIdByParent.set(row.id, row.user_id);
  }
  if (userIdByParent.size === 0) return lastNameByParent;

  const userIds = Array.from(new Set(userIdByParent.values()));
  const { data: profileRows } = await admin
    .from("user_profiles")
    .select("user_id, last_name")
    .in("user_id", userIds);

  const lastNameByUser = new Map<string, string>();
  for (const row of profileRows ?? []) {
    if (row.last_name) lastNameByUser.set(row.user_id, row.last_name);
  }
  for (const [parentId, userId] of userIdByParent) {
    const lastName = lastNameByUser.get(userId);
    if (lastName) lastNameByParent.set(parentId, lastName);
  }
  return lastNameByParent;
}

function composeFamilyDisplayName(
  existing: string | null,
  parentId: string | null,
  suburb: string,
  lastNameByParent: Map<string, string>,
): string {
  if (existing) return existing;
  const lastName = parentId ? lastNameByParent.get(parentId) : undefined;
  return lastName ? `${lastName} (${suburb})` : `(${suburb})`;
}

type ChildSummary = { age_months: number; gender: string | null };

async function fetchChildrenByPosition(
  admin: ReturnType<typeof createAdminClient>,
  positionIds: string[],
): Promise<Map<string, ChildSummary[]>> {
  const map = new Map<string, ChildSummary[]>();
  if (positionIds.length === 0) return map;

  const { data: rows } = await admin
    .from("position_children")
    .select("position_id, age_months, gender")
    .in("position_id", positionIds)
    .order("display_order", { ascending: true });

  for (const c of rows ?? []) {
    const list = map.get(c.position_id) ?? [];
    list.push({ age_months: c.age_months, gender: c.gender });
    map.set(c.position_id, list);
  }
  return map;
}

function collectParentIdsNeedingName(
  positions: Record<string, unknown>[],
): string[] {
  return Array.from(
    new Set(
      positions
        .filter((p) => !p.family_display_name && p.parent_id)
        .map((p) => p.parent_id as string),
    ),
  );
}

function formatPositionListRow(
  raw: Record<string, unknown>,
  children: ChildSummary[],
  lastNameByParent: Map<string, string>,
): Record<string, unknown> {
  return {
    ...raw,
    family_display_name: composeFamilyDisplayName(
      (raw.family_display_name as string | null) ?? null,
      (raw.parent_id as string | null) ?? null,
      raw.suburb as string,
      lastNameByParent,
    ),
    children,
    public_url: `${appUrl}/position/${raw.id}`,
  };
}

function formatPositionDetail(
  position: Record<string, unknown>,
  children: ChildSummary[],
  schedule: unknown,
  lastNameByParent: Map<string, string>,
): Record<string, unknown> {
  const details = position.details as Record<string, unknown> | null;
  return {
    id: position.id,
    family_display_name: composeFamilyDisplayName(
      (position.family_display_name as string | null) ?? null,
      (position.parent_id as string | null) ?? null,
      position.suburb as string,
      lastNameByParent,
    ),
    suburb: position.suburb,
    hourly_rate: position.hourly_rate ? Number(position.hourly_rate) : null,
    hours_per_week: position.hours_per_week,
    schedule_type: position.schedule_type,
    days_required: position.days_required,
    schedule,
    placement_length: position.placement_length,
    urgency: position.urgency,
    start_date: position.start_date,
    expires_at: position.expires_at,
    status: position.status,
    stage: position.stage,
    position_status: position.position_status,
    source: position.source,
    created_at: position.created_at,
    description: position.description,
    reason_for_nanny: position.reason_for_nanny,
    drivers_license_required: position.drivers_license_required,
    car_required: position.car_required,
    comfortable_with_pets_required: position.comfortable_with_pets_required,
    language_preference: position.language_preference,
    language_preference_details: position.language_preference_details,
    years_of_experience: position.years_of_experience,
    minimum_age_requirement: position.minimum_age_requirement,
    focus_type: details?.focus_type ?? null,
    support_type: details?.support_type ?? null,
    child_needs: details?.child_needs ?? false,
    child_needs_details: details?.child_needs_details ?? null,
    dfy_activated_at: position.dfy_activated_at,
    dfy_tier: position.dfy_tier,
    dfy_expires_at: position.dfy_expires_at,
    filled_at: position.filled_at,
    filled_by_nanny_id: position.filled_by_nanny_id,
    children,
    public_url: `${appUrl}/position/${position.id}`,
  };
}

export async function listAdminPositions(opts: {
  status?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  positions: unknown[];
  total: number;
  error: string | null;
}> {
  const admin = createAdminClient();
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  let query = admin
    .from("nanny_positions")
    .select(
      "id, parent_id, family_display_name, suburb, hourly_rate, hours_per_week, schedule_type, days_required, placement_length, urgency, start_date, status, stage, position_status, source, created_at, expires_at, description, dfy_activated_at, dfy_tier, dfy_expires_at, filled_at, filled_by_nanny_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.source && opts.source !== "all") {
    query = query.eq("source", opts.source);
  }

  const { data: positions, count, error } = await query;
  if (error) return { positions: [], total: 0, error: error.message };

  const rows = (positions ?? []) as Record<string, unknown>[];
  const positionIds = rows.map((p) => p.id as string);
  const childrenByPosition = await fetchChildrenByPosition(admin, positionIds);
  const lastNameByParent = await resolveLastNameByParent(
    admin,
    collectParentIdsNeedingName(rows),
  );

  const result = rows.map((p) =>
    formatPositionListRow(
      p,
      childrenByPosition.get(p.id as string) ?? [],
      lastNameByParent,
    ),
  );

  return { positions: result, total: count ?? 0, error: null };
}

// ════════════════════════════════════════════════════════════
// GET SINGLE (for API GET /[id])
// ════════════════════════════════════════════════════════════

export async function getAdminPosition(id: string): Promise<{
  position: unknown | null;
  error: string | null;
}> {
  const admin = createAdminClient();

  const { data: position, error } = await admin
    .from("nanny_positions")
    .select(
      "id, parent_id, family_display_name, suburb, hourly_rate, hours_per_week, schedule_type, days_required, placement_length, urgency, start_date, status, stage, position_status, source, created_at, expires_at, description, reason_for_nanny, drivers_license_required, car_required, comfortable_with_pets_required, language_preference, language_preference_details, years_of_experience, minimum_age_requirement, details, dfy_activated_at, dfy_tier, dfy_expires_at, filled_at, filled_by_nanny_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !position)
    return { position: null, error: error?.message ?? "Position not found" };

  const { data: children } = await admin
    .from("position_children")
    .select("age_months, gender")
    .eq("position_id", id)
    .order("display_order", { ascending: true });

  const { data: scheduleRow } = await admin
    .from("position_schedule")
    .select("schedule")
    .eq("position_id", id)
    .maybeSingle();

  const lastNameByParent = position.family_display_name
    ? new Map<string, string>()
    : await resolveLastNameByParent(
        admin,
        position.parent_id ? [position.parent_id] : [],
      );

  return {
    position: formatPositionDetail(
      position,
      (children ?? []).map((c) => ({
        age_months: c.age_months,
        gender: c.gender,
      })),
      scheduleRow?.schedule ?? null,
      lastNameByParent,
    ),
    error: null,
  };
}
