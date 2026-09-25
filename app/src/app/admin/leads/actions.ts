"use server";

// T-032 — Server actions for the Nanny Contact Management page.
//
// Every action calls requireAdmin() first, then uses createAdminClient()
// (service-role, bypasses RLS — the requireAdmin gate is the security boundary).
// Every action returns {success, error} envelope.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import {
  CONTACT_DIRECTIONS,
  CONTACT_METHODS,
  CONTACT_OUTCOMES,
  LEAD_STATUSES,
  type ActionResult,
  type ContactDirection,
  type ContactMethod,
  type ContactOutcome,
  type LeadStatus,
} from "@/lib/leads/types";

const LEADS_PATH = "/admin/leads";

// ── Input schemas ──

const uuidSchema = z.string().uuid();

const logContactSchema = z.object({
  nanny_user_id: uuidSchema,
  method: z.enum(
    CONTACT_METHODS as readonly [ContactMethod, ...ContactMethod[]],
  ),
  direction: z.enum(
    CONTACT_DIRECTIONS as readonly [ContactDirection, ...ContactDirection[]],
  ),
  outcome: z
    .enum(CONTACT_OUTCOMES as readonly [ContactOutcome, ...ContactOutcome[]])
    .optional()
    .nullable(),
  purpose: z.string().max(80).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  contacted_at: z.string().datetime().optional(),
});

export type LogContactInput = z.infer<typeof logContactSchema>;

const editLogEntrySchema = z.object({
  log_id: uuidSchema,
  outcome: z
    .enum(CONTACT_OUTCOMES as readonly [ContactOutcome, ...ContactOutcome[]])
    .optional()
    .nullable(),
  purpose: z.string().max(80).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export type EditLogEntryInput = z.infer<typeof editLogEntrySchema>;

// ── Helper: derive a stable operator handle from the authenticated session ──

async function deriveOperatorHandle(userId: string): Promise<string> {
  const supa = createAdminClient();
  const { data: profile } = await supa
    .from("user_profiles")
    .select("first_name, last_name, email")
    .eq("user_id", userId)
    .maybeSingle<{
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>();

  if (profile?.first_name) {
    const last = profile.last_name ? ` ${profile.last_name}` : "";
    return `${profile.first_name}${last}`.trim();
  }
  return profile?.email ?? userId;
}

function envelopeError<T = void>(
  action: string,
  error: unknown,
): ActionResult<T> {
  // Log the raw error server-side for forensics, but return a generic
  // user-facing message — never leak Postgrest text (constraint names,
  // column names, partial query fragments) to the browser even on an
  // admin-only surface.
  console.error(`[leads:${action}] failed:`, error);
  // Zod errors are safe to surface (input shape feedback).
  if (error instanceof Error && error.name === "ZodError") {
    return { success: false, error: "Invalid input. Please check the form." };
  }
  return {
    success: false,
    error: "Action failed. Check server logs for details.",
  };
}

// ── Actions ──

export async function logContact(
  rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = logContactSchema.parse(rawInput);
    const { userId } = await requireAdmin();
    const operator = await deriveOperatorHandle(userId);
    const supa = createAdminClient();

    const { data, error } = await supa
      .from("lead_contacts")
      .insert({
        nanny_user_id: input.nanny_user_id,
        method: input.method,
        direction: input.direction,
        outcome: input.outcome ?? null,
        purpose: input.purpose ?? null,
        note: input.note ?? null,
        operator_handle: operator,
        contacted_at: input.contacted_at ?? new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !data) {
      return envelopeError(
        "logContact",
        error ?? new Error("insert returned no row"),
      );
    }

    revalidatePath(LEADS_PATH);
    return { success: true, data: { id: data.id } };
  } catch (error: unknown) {
    return envelopeError("logContact", error);
  }
}

export async function editLogEntry(rawInput: unknown): Promise<ActionResult> {
  try {
    const input = editLogEntrySchema.parse(rawInput);
    const { userId } = await requireAdmin();
    const operator = await deriveOperatorHandle(userId);
    const supa = createAdminClient();

    const patch: Record<string, unknown> = { edited_by: operator };
    if (input.outcome !== undefined) patch.outcome = input.outcome;
    if (input.purpose !== undefined) patch.purpose = input.purpose;
    if (input.note !== undefined) patch.note = input.note;

    const { error } = await supa
      .from("lead_contacts")
      .update(patch)
      .eq("id", input.log_id);

    if (error) return envelopeError("editLogEntry", error);

    revalidatePath(LEADS_PATH);
    return { success: true, data: undefined };
  } catch (error: unknown) {
    return envelopeError("editLogEntry", error);
  }
}

/**
 * Upsert helper — ensures a nanny_contact_state row exists then sets the
 * given fields. Pattern shared by status / next-action / pin / offset /
 * override / assign actions.
 */
async function upsertContactState(
  nannyUserId: string,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const supa = createAdminClient();
  const { error } = await supa
    .from("nanny_contact_state")
    .upsert(
      { nanny_user_id: nannyUserId, ...patch },
      { onConflict: "nanny_user_id" },
    );
  if (error) return envelopeError("upsertContactState", error);
  return { success: true, data: undefined };
}

const updateLeadStatusSchema = z.object({
  nanny_user_id: uuidSchema,
  status: z.enum(LEAD_STATUSES as readonly [LeadStatus, ...LeadStatus[]]),
});

export async function updateLeadStatus(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    const input = updateLeadStatusSchema.parse(rawInput);
    await requireAdmin();
    const supa = createAdminClient();
    const { error } = await supa
      .from("nanny_contact_state")
      .upsert(
        { nanny_user_id: input.nanny_user_id, lead_status: input.status },
        { onConflict: "nanny_user_id" },
      );
    if (error) {
      // Surface the actual Postgres / PostgREST error to the operator —
      // this is an admin-only surface, and silent failures (the generic
      // envelopeError text) hid a CHECK-constraint mismatch when the
      // T-032b/c migration hadn't applied. Worth the trade-off.
      console.error("[leads:updateLeadStatus] failed:", error);
      const message =
        error.message ||
        error.details ||
        error.hint ||
        "Database rejected the status update.";
      return { success: false, error: message };
    }
    revalidatePath(LEADS_PATH);
    return { success: true, data: undefined };
  } catch (error: unknown) {
    return envelopeError("updateLeadStatus", error);
  }
}

const setNextActionSchema = z.object({
  nanny_user_id: uuidSchema,
  next_action_at: z.string().datetime().nullable(),
});

export async function setNextAction(rawInput: unknown): Promise<ActionResult> {
  try {
    const input = setNextActionSchema.parse(rawInput);
    await requireAdmin();
    const result = await upsertContactState(input.nanny_user_id, {
      next_action_at: input.next_action_at,
    });
    if (result.success) revalidatePath(LEADS_PATH);
    return result;
  } catch (error: unknown) {
    return envelopeError("setNextAction", error);
  }
}

const pinNoteSchema = z.object({
  nanny_user_id: uuidSchema,
  pinned_note: z.string().max(500).nullable(),
});

export async function pinNote(rawInput: unknown): Promise<ActionResult> {
  try {
    const input = pinNoteSchema.parse(rawInput);
    await requireAdmin();
    const result = await upsertContactState(input.nanny_user_id, {
      pinned_note: input.pinned_note,
    });
    if (result.success) revalidatePath(LEADS_PATH);
    return result;
  } catch (error: unknown) {
    return envelopeError("pinNote", error);
  }
}

const updateContactsOffsetSchema = z.object({
  nanny_user_id: uuidSchema,
  offset: z.number().int().min(0).max(10000),
});

export async function updateContactsOffset(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    const input = updateContactsOffsetSchema.parse(rawInput);
    await requireAdmin();
    const result = await upsertContactState(input.nanny_user_id, {
      total_contacts_manual_offset: input.offset,
    });
    if (result.success) revalidatePath(LEADS_PATH);
    return result;
  } catch (error: unknown) {
    return envelopeError("updateContactsOffset", error);
  }
}

const overrideRespondedSchema = z.object({
  nanny_user_id: uuidSchema,
  value: z.boolean().nullable(),
});

export async function overrideResponded(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    const input = overrideRespondedSchema.parse(rawInput);
    await requireAdmin();
    const result = await upsertContactState(input.nanny_user_id, {
      responded_ever_override: input.value,
    });
    if (result.success) revalidatePath(LEADS_PATH);
    return result;
  } catch (error: unknown) {
    return envelopeError("overrideResponded", error);
  }
}

const assignOperatorSchema = z.object({
  nanny_user_id: uuidSchema,
  operator: z.string().max(80).nullable(),
});

export async function assignOperator(rawInput: unknown): Promise<ActionResult> {
  try {
    const input = assignOperatorSchema.parse(rawInput);
    await requireAdmin();
    const result = await upsertContactState(input.nanny_user_id, {
      assigned_operator: input.operator,
    });
    if (result.success) revalidatePath(LEADS_PATH);
    return result;
  } catch (error: unknown) {
    return envelopeError("assignOperator", error);
  }
}

const upsertNotesSchema = z.object({
  nanny_user_id: uuidSchema,
  body: z.string().max(20_000),
});

export async function upsertNotes(rawInput: unknown): Promise<ActionResult> {
  try {
    const input = upsertNotesSchema.parse(rawInput);
    const { userId } = await requireAdmin();
    const operator = await deriveOperatorHandle(userId);
    const supa = createAdminClient();

    const { error } = await supa.from("lead_notes").upsert(
      {
        nanny_user_id: input.nanny_user_id,
        body: input.body,
        last_edited_by: operator,
      },
      { onConflict: "nanny_user_id" },
    );

    if (error) return envelopeError("upsertNotes", error);
    revalidatePath(LEADS_PATH);
    return { success: true, data: undefined };
  } catch (error: unknown) {
    return envelopeError("upsertNotes", error);
  }
}

const bulkSnoozeSchema = z.object({
  nanny_user_ids: z.array(uuidSchema).min(1).max(500),
  next_action_at: z.string().datetime(),
});

export async function bulkSnooze(
  rawInput: unknown,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const input = bulkSnoozeSchema.parse(rawInput);
    await requireAdmin();
    const supa = createAdminClient();

    // Upsert per-row so missing contact_state rows materialise.
    const rows = input.nanny_user_ids.map((id) => ({
      nanny_user_id: id,
      next_action_at: input.next_action_at,
    }));

    const { error, data } = await supa
      .from("nanny_contact_state")
      .upsert(rows, { onConflict: "nanny_user_id" })
      .select("nanny_user_id");

    if (error) return envelopeError("bulkSnooze", error);
    revalidatePath(LEADS_PATH);
    return { success: true, data: { updated: data?.length ?? 0 } };
  } catch (error: unknown) {
    return envelopeError("bulkSnooze", error);
  }
}

const bulkMoveToDormantSchema = z.object({
  nanny_user_ids: z.array(uuidSchema).min(1).max(500),
});

export async function bulkMoveToDormant(
  rawInput: unknown,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const input = bulkMoveToDormantSchema.parse(rawInput);
    await requireAdmin();
    const supa = createAdminClient();

    const rows = input.nanny_user_ids.map((id) => ({
      nanny_user_id: id,
      lead_status: "dormant" as LeadStatus,
    }));

    const { error, data } = await supa
      .from("nanny_contact_state")
      .upsert(rows, { onConflict: "nanny_user_id" })
      .select("nanny_user_id");

    if (error) return envelopeError("bulkMoveToDormant", error);
    revalidatePath(LEADS_PATH);
    return { success: true, data: { updated: data?.length ?? 0 } };
  } catch (error: unknown) {
    return envelopeError("bulkMoveToDormant", error);
  }
}

// ── fetchRecentLogs ──
// Fetches recent contact log entries for a single nanny — used by the
// "Logs" popup on the list view so an operator can scan history without
// opening the full drawer.

const fetchRecentLogsSchema = z.object({
  nanny_user_id: uuidSchema,
  limit: z.number().int().min(1).max(50).optional(),
});

export type RecentLogEntry = {
  id: string;
  contacted_at: string;
  method: ContactMethod;
  direction: ContactDirection;
  outcome: ContactOutcome | null;
  purpose: string | null;
  note: string | null;
  operator_handle: string;
};

export async function fetchRecentLogs(
  rawInput: unknown,
): Promise<ActionResult<{ logs: RecentLogEntry[] }>> {
  try {
    const input = fetchRecentLogsSchema.parse(rawInput);
    await requireAdmin();
    const supa = createAdminClient();

    const { data, error } = await supa
      .from("lead_contacts")
      .select(
        "id, contacted_at, method, direction, outcome, purpose, note, operator_handle",
      )
      .eq("nanny_user_id", input.nanny_user_id)
      .order("contacted_at", { ascending: false })
      .limit(input.limit ?? 10);

    if (error) return envelopeError("fetchRecentLogs", error);
    return {
      success: true,
      data: { logs: (data ?? []) as RecentLogEntry[] },
    };
  } catch (error: unknown) {
    return envelopeError("fetchRecentLogs", error);
  }
}

// ── updateNannyAvailability ──
// Admin-on-call updates a nanny's weekly schedule (e.g. while on the phone
// with them) without the nanny needing to log in. Writes to the same
// `nanny_availability` row the nanny would edit themselves, then:
//   1. logs the change to `activity_logs` for forensic audit
//   2. emails the nanny so they know an admin updated it
// Email + audit failures do NOT roll back the schedule write — the
// schedule is the authoritative state, the email is a courtesy. Both
// failures are surfaced server-side via console.error for forensics.

const TIME_SLOTS_ALLOWED = [
  "Morning (6am-10am)",
  "Midday (10am-2pm)",
  "Afternoon (2pm-6pm)",
  "Evening (6pm-10pm)",
] as const;

const DAYS_ALLOWED = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const updateNannyAvailabilitySchema = z.object({
  nanny_user_id: uuidSchema,
  available_days: z.array(z.enum(DAYS_ALLOWED)).max(7),
  schedule: z.record(z.string(), z.array(z.enum(TIME_SLOTS_ALLOWED))),
});

export type UpdateNannyAvailabilityInput = z.infer<
  typeof updateNannyAvailabilitySchema
>;

function formatScheduleForEmail(
  days: readonly string[],
  schedule: Record<string, string[]>,
): string {
  if (days.length === 0) return "<p>No days marked as available.</p>";
  const rows = days
    .map((day) => {
      const slots = schedule[day.toLowerCase()] ?? [];
      if (slots.length === 0) return null;
      const slotsLabel = slots
        .map((s) => s.replace(/\s*\([^)]+\)\s*/, ""))
        .join(", ");
      return `<li><strong>${day}:</strong> ${slotsLabel}</li>`;
    })
    .filter((x): x is string => x !== null);
  if (rows.length === 0) return "<p>No time slots marked as available.</p>";
  return `<ul style="margin:8px 0 16px 0;padding-left:20px;line-height:1.7">${rows.join("")}</ul>`;
}

export async function updateNannyAvailability(
  rawInput: unknown,
): Promise<ActionResult<void>> {
  try {
    const input = updateNannyAvailabilitySchema.parse(rawInput);
    const { userId } = await requireAdmin();
    const operator = await deriveOperatorHandle(userId);
    const supa = createAdminClient();

    // Look up nanny.id from nanny_user_id (nanny_availability is keyed by
    // nanny_id, not user_id — same as the nanny's own profile save path).
    const { data: nannyRow, error: nannyErr } = await supa
      .from("nannies")
      .select("id")
      .eq("user_id", input.nanny_user_id)
      .maybeSingle<{ id: string }>();
    if (nannyErr) return envelopeError("updateNannyAvailability", nannyErr);
    if (!nannyRow) {
      return { success: false, error: "Nanny record not found." };
    }

    // Read the previous availability so we can include the before/after in
    // the audit log (operator + future-self will want this when reviewing).
    const { data: previous } = await supa
      .from("nanny_availability")
      .select("days_available, schedule")
      .eq("nanny_id", nannyRow.id)
      .maybeSingle<{
        days_available: string[] | null;
        schedule: Record<string, unknown> | null;
      }>();

    const { error: upsertErr } = await supa.from("nanny_availability").upsert(
      {
        nanny_id: nannyRow.id,
        days_available: input.available_days,
        schedule: input.schedule,
      },
      { onConflict: "nanny_id" },
    );
    if (upsertErr) return envelopeError("updateNannyAvailability", upsertErr);

    // Audit log — best-effort, do not roll back schedule on failure.
    try {
      await supa.from("activity_logs").insert({
        user_id: input.nanny_user_id,
        action: "availability_updated_by_admin",
        details: {
          operator,
          before: previous
            ? {
                days_available: previous.days_available ?? [],
                schedule: previous.schedule ?? {},
              }
            : null,
          after: {
            days_available: input.available_days,
            schedule: input.schedule,
          },
        },
      });
    } catch (logErr) {
      console.error(
        "[leads:updateNannyAvailability] audit log failed:",
        logErr,
      );
    }

    // Email — best-effort, do not roll back schedule on failure.
    try {
      const { data: profile } = await supa
        .from("user_profiles")
        .select("first_name, email")
        .eq("user_id", input.nanny_user_id)
        .maybeSingle<{ first_name: string | null; email: string | null }>();

      if (profile?.email) {
        const scheduleHtml = formatScheduleForEmail(
          input.available_days,
          input.schedule,
        );
        const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.55">
  <h2 style="font-size:20px;font-weight:600;margin:0 0 12px 0">Your availability has been updated</h2>
  <p>Hi ${profile.first_name ?? "there"},</p>
  <p>Following our chat, your Baby Bloom availability has been updated by ${operator}. Here's what's now on your profile:</p>
  ${scheduleHtml}
  <p>If anything here is wrong, you can edit it any time in your <a href="${SITE_URL}/nanny/profile" style="color:#7c3aed">profile</a>, or just reply to this email.</p>
  <p style="margin-top:24px;color:#64748b;font-size:13px">${SITE_NAME}</p>
</div>`.trim();

        await sendEmail({
          to: profile.email,
          subject: "Your Baby Bloom availability has been updated",
          html,
          emailType: "availability_updated_by_admin",
          recipientUserId: input.nanny_user_id,
        });
      }
    } catch (emailErr) {
      console.error("[leads:updateNannyAvailability] email failed:", emailErr);
    }

    revalidatePath(LEADS_PATH);
    return { success: true, data: undefined };
  } catch (error: unknown) {
    return envelopeError("updateNannyAvailability", error);
  }
}
