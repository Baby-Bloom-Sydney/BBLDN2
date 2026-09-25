"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { capitalizeName } from "@/lib/utils";
import { sendEmail } from "@/lib/email/resend";
import {
  NannyLeadIdentity,
  NannyLeadExperience,
  NannyLeadQualifications,
  NannyLeadResidency,
  NannyLeadPreferences,
  NannyLeadAvailability,
  NannyLeadSalary,
  NannyLeadMatching,
  NannyLeadAboutYou,
  NannyLeadSignals,
} from "@/types/nanny-leads";
import { emailFooter } from "@/lib/email/brand";
import { BRAND, SITE_NAME } from "@/lib/constants";

interface ActionResult {
  success: boolean;
  error?: string;
  leadId?: string;
  redirectTo?: string;
}

// ── Helper functions ──

function ageStringToMonths(s: string | null | undefined): number | null {
  if (!s) return null;
  if (s === "Newborn") return 0;
  const monthMatch = s.match(/^(\d+)\s*months?$/i);
  if (monthMatch) return parseInt(monthMatch[1]);
  const yearMatch = s.match(/^(\d+)\s*years?$/i);
  if (yearMatch) return parseInt(yearMatch[1]) * 12;
  return null;
}

function parseRate(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace("$", ""));
  return isNaN(n) ? null : n;
}

// ── N1.5: Create lead on contact submit ──

export async function createNannyLead(data: {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  identity: NannyLeadIdentity;
  experience: NannyLeadExperience;
  qualifications: NannyLeadQualifications;
  residency: NannyLeadResidency;
  lead_signals: NannyLeadSignals;
  visitor_id?: string;
  highest_page_reached?: number;
}): Promise<ActionResult> {
  const adminClient = createAdminClient();

  // Server-side normalisation for the lead_signals JSONB column (T-023).
  // The client state is restored from localStorage and could be tampered
  // with — strip to the known keys, coerce to known types. New signals
  // added in future must be added here too; the column is allowlist-only.
  const safeLeadSignals: NannyLeadSignals = {
    external_u3_position:
      typeof data.lead_signals?.external_u3_position === "boolean"
        ? data.lead_signals.external_u3_position
        : null,
  };

  try {
    // Check if an auth account already exists with this email
    const { data: userProfileMatch } = await adminClient
      .from("user_profiles")
      .select("user_id")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();
    if (userProfileMatch) {
      return {
        success: false,
        error: "account_exists",
      };
    }

    // Try a straight insert
    const { data: lead, error } = await adminClient
      .from("nanny_leads")
      .insert({
        first_name: capitalizeName(data.first_name),
        last_name: capitalizeName(data.last_name),
        email: data.email,
        phone: data.phone,
        identity: data.identity,
        experience: data.experience,
        qualifications: data.qualifications,
        residency: data.residency,
        lead_signals: safeLeadSignals,
        lead_status: "applied",
        funnel_step: "N1",
        last_active_at: new Date().toISOString(),
        ...(data.visitor_id && { visitor_id: data.visitor_id }),
        ...(data.highest_page_reached != null && {
          highest_page_reached: data.highest_page_reached,
        }),
      })
      .select("id")
      .single();

    if (error) {
      // Duplicate email — check if they already have an auth account
      if (error.message.includes("duplicate") || error.code === "23505") {
        // Look up existing lead
        const { data: existing } = await adminClient
          .from("nanny_leads")
          .select("id, auth_user_id")
          .eq("email", data.email)
          .single();

        if (existing?.auth_user_id) {
          // Already converted to a real account — block
          return {
            success: false,
            error:
              "An account with this email already exists. Please sign in instead.",
          };
        }

        // Pre-auth lead with no account — overwrite with fresh application data
        if (existing) {
          const { data: updated, error: updateErr } = await adminClient
            .from("nanny_leads")
            .update({
              first_name: capitalizeName(data.first_name),
              last_name: capitalizeName(data.last_name),
              phone: data.phone,
              identity: data.identity,
              experience: data.experience,
              qualifications: data.qualifications,
              residency: data.residency,
              lead_signals: safeLeadSignals,
              lead_status: "applied",
              funnel_step: "N1",
              last_active_at: new Date().toISOString(),
              ...(data.visitor_id && { visitor_id: data.visitor_id }),
              ...(data.highest_page_reached != null && {
                highest_page_reached: data.highest_page_reached,
              }),
            })
            .eq("id", existing.id)
            .select("id")
            .single();

          if (updateErr) {
            console.error("Overwrite lead error:", updateErr);
            return {
              success: false,
              error: "Failed to submit application. Please try again.",
            };
          }
          return { success: true, leadId: updated.id };
        }

        return {
          success: false,
          error: "Failed to submit application. Please try again.",
        };
      }
      console.error("Create lead error:", error);
      return {
        success: false,
        error: "Failed to submit application. Please try again.",
      };
    }

    return { success: true, leadId: lead.id };
  } catch (err) {
    console.error("Create lead exception:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}

// ── N3 Complete: Update lead with portfolio data ──

export async function updateNannyLead(
  leadId: string,
  data: {
    preferences?: NannyLeadPreferences;
    availability?: NannyLeadAvailability;
    salary?: NannyLeadSalary;
    matching?: NannyLeadMatching;
    about_you?: NannyLeadAboutYou;
    ai_bio?: string;
    ai_content?: Record<string, unknown>;
    lead_status?: string;
    funnel_step?: string;
    highest_page_reached?: number;
  },
): Promise<ActionResult> {
  const adminClient = createAdminClient();

  try {
    const updateData: Record<string, unknown> = {
      last_active_at: new Date().toISOString(),
    };

    if (data.highest_page_reached != null)
      updateData.highest_page_reached = data.highest_page_reached;

    if (data.preferences) updateData.preferences = data.preferences;
    if (data.availability) updateData.availability = data.availability;
    if (data.salary) updateData.salary = data.salary;
    if (data.matching) updateData.matching = data.matching;
    if (data.about_you) updateData.about_you = data.about_you;
    if (data.ai_bio !== undefined) updateData.ai_bio = data.ai_bio;
    if (data.ai_content !== undefined) updateData.ai_content = data.ai_content;
    if (data.lead_status) updateData.lead_status = data.lead_status;
    if (data.funnel_step) updateData.funnel_step = data.funnel_step;

    const { error } = await adminClient
      .from("nanny_leads")
      .update(updateData)
      .eq("id", leadId);

    if (error) {
      console.error("Update lead error:", error);
      return {
        success: false,
        error: "Failed to save progress. Please try again.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("Update lead exception:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}

// ── N5: Convert lead to full account ──

export async function convertLeadToAccount(
  leadId: string,
  password: string,
  email?: string,
): Promise<ActionResult> {
  const adminClient = createAdminClient();

  try {
    // 1. Fetch lead record
    const { data: lead, error: leadError } = await adminClient
      .from("nanny_leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      console.error("Fetch lead error:", leadError);
      return { success: false, error: "Application not found." };
    }

    // Use the email from the account creation form (may differ from lead email)
    const finalEmail = email?.trim() || lead.email;

    // 2. Create Supabase auth user
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email: finalEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          first_name: capitalizeName(lead.first_name),
          last_name: capitalizeName(lead.last_name),
        },
      });

    if (authError || !authData.user) {
      console.error("Auth create error:", authError);
      if (
        authError?.message.includes("already registered") ||
        authError?.message.includes("already been registered")
      ) {
        return {
          success: false,
          error:
            "An account with this email already exists. Please sign in instead.",
        };
      }
      return {
        success: false,
        error: "Failed to create account. Please try again.",
      };
    }

    const userId = authData.user.id;

    try {
      // 3. Insert user_roles
      const { error: roleError } = await adminClient
        .from("user_roles")
        .insert({ user_id: userId, role: "nanny" });

      if (roleError)
        throw new Error(`Role insert failed: ${roleError.message}`);

      // 4. Insert user_profiles
      const { error: profileError } = await adminClient
        .from("user_profiles")
        .insert({
          user_id: userId,
          first_name: capitalizeName(lead.first_name),
          last_name: capitalizeName(lead.last_name),
          email: finalEmail,
          mobile_number: lead.phone,
          date_of_birth: lead.experience?.date_of_birth || null,
          suburb: lead.residency?.suburb || null,
          postcode: lead.residency?.postcode || null,
          profile_picture_url: lead.about_you?.profile_picture_url || null,
        });

      if (profileError)
        throw new Error(`Profile insert failed: ${profileError.message}`);

      // 5. Insert nannies record (INSERT, not UPDATE — no pre-existing record in V2)
      const identity = lead.identity || {};
      const experience = lead.experience || {};
      const residency = lead.residency || {};
      const preferences = lead.preferences || {};
      const matching = lead.matching || {};
      const salary = lead.salary || {};
      const availability = lead.availability || {};
      const aboutYou = lead.about_you || {};

      const { data: nanny, error: nannyError } = await adminClient
        .from("nannies")
        .insert({
          user_id: userId,
          status: "active",
          // Identity (N1.1)
          motivation: identity.motivation,
          personality_traits: identity.personality_traits,
          level_of_support_offered: identity.level_of_support,
          professional_values: identity.professional_values,
          // Experience (N1.2)
          total_experience_years: experience.total_experience
            ? parseInt(experience.total_experience) || 0
            : null,
          under_3_experience_years: experience.under_3_experience || null,
          newborn_experience_years: experience.newborn_experience || null,
          childcare_roles: experience.childcare_roles,
          // Residency (N1.4)
          nationality: residency.nationality,
          residency_status: residency.residency_status,
          right_to_work: residency.right_to_work,
          sydney_resident: residency.sydney_resident,
          // Preferences (N3.1)
          role_types_preferred: preferences.role_types,
          max_children: preferences.max_children,
          min_child_age_months: ageStringToMonths(preferences.min_age),
          max_child_age_months: ageStringToMonths(preferences.max_age),
          additional_needs_ok: preferences.additional_needs,
          comfortable_with_pets: preferences.comfortable_with_pets,
          // Matching (N3.2)
          languages: matching.languages,
          drivers_license: matching.drivers_license,
          has_car: matching.has_car,
          vaccination_status: matching.vaccination_status,
          non_smoker: matching.non_smoker,
          // Salary (N3.4)
          hourly_rate_min: parseRate(salary.hourly_rate_min),
          pay_frequency: salary.pay_frequency,
          // Availability flags (N3.3)
          immediate_start_available: availability.immediate_start === "Yes",
          placement_ongoing_preferred: availability.placement_ongoing === "Yes",
          start_date_earliest: availability.start_date,
          end_date_latest: availability.end_date,
          // Photos (N3.5)
          profile_picture_url: aboutYou.profile_picture_url,
          photo_1_url: aboutYou.photo_1_url,
          photo_2_url: aboutYou.photo_2_url,
          photo_3_url: aboutYou.photo_3_url,
          // AI content (N4)
          ai_bio: lead.ai_bio,
          ai_content: lead.ai_content || {},
          // Derived nanny experience from childcare roles
          nanny_experience_years:
            experience.childcare_roles?.length > 0
              ? experience.childcare_roles
                  .filter((r: { role: string }) => r.role === "Nanny")
                  .reduce(
                    (sum: number, r: { duration: number }) =>
                      sum + (r.duration || 0),
                    0,
                  ) || null
              : null,
          // Link to lead
          lead_id: leadId,
        })
        .select("id")
        .single();

      if (nannyError || !nanny)
        throw new Error(`Nanny insert failed: ${nannyError?.message}`);

      // 6. Upsert nanny_availability
      if (availability.available_days?.length > 0) {
        await adminClient.from("nanny_availability").upsert(
          {
            nanny_id: nanny.id,
            days_available: availability.available_days,
            schedule: availability.day_times || {},
          },
          { onConflict: "nanny_id" },
        );
      }

      // 7. Insert credentials
      const qualifications = lead.qualifications || {};

      if (
        qualifications.has_qualifications &&
        qualifications.highest_qualification
      ) {
        await adminClient.from("nanny_credentials").insert({
          nanny_id: nanny.id,
          credential_category: "qualification",
          qualification_type: qualifications.highest_qualification,
        });
      }

      if (
        qualifications.has_certificates &&
        qualifications.certificates?.length > 0
      ) {
        for (const cert of qualifications.certificates) {
          await adminClient.from("nanny_credentials").insert({
            nanny_id: nanny.id,
            credential_category: "certification",
            certification_type: cert,
          });
        }
      }

      // 8. Create verifications record (empty — all statuses not_started)
      await adminClient.from("verifications").insert({
        user_id: userId,
        identity_status: "not_started",
        wwcc_status: "not_started",
        contact_status: "not_started",
        cross_check_status: "not_started",
        verification_status: 0,
      });

      // 9. Insert user_progress
      await adminClient.from("user_progress").insert({
        user_id: userId,
        stage: "nanny_lead_converted",
      });

      // 9. Insert form_snapshot audit trail
      await adminClient.from("form_snapshots").insert({
        user_id: userId,
        form_type: "nanny_lead_conversion",
        data: lead as unknown as Record<string, unknown>,
      });

      // 10. Mark lead as converted
      await adminClient
        .from("nanny_leads")
        .update({
          lead_status: "converted",
          converted_at: new Date().toISOString(),
          auth_user_id: userId,
          funnel_step: "N5",
          terms_accepted_at: new Date().toISOString(),
        })
        .eq("id", leadId);

      // 11. Sign the user in via the cookie-based client
      const supabase = createClient();
      await supabase.auth.signInWithPassword({
        email: finalEmail,
        password: password,
      });

      // 12. Send welcome email (ACC-001, fire-and-forget)
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://app-babybloom.vercel.app";
      const firstName = capitalizeName(lead.first_name);
      sendEmail({
        to: finalEmail,
        subject: `Welcome to Baby Bloom, ${firstName}!`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#127881;</div>
    </div>
    <h1 style="font-size:24px;font-weight:700;text-align:center;margin:0 0 8px;">Welcome, ${firstName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">Your Baby Bloom account has been created.</p>
    <p style="font-size:14px;color:#475569;line-height:1.6;">We're excited to have you join ${SITE_NAME}. Here's how to get started:</p>
    <div style="background:#f5f3ff;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#7c3aed;">Next steps</p>
      <ol style="margin:0;padding-left:20px;font-size:14px;color:#475569;line-height:1.8;">
        <li>Complete your profile with your experience and qualifications</li>
        <li>Upload your ID and WWCC for verification</li>
        <li>Once verified, families in ${BRAND.city} can find and connect with you</li>
      </ol>
    </div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/verification" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Start Verification</a>
    </div>
    ${emailFooter({ termsLabel: "Terms of Service" })}
  </div>
</div>
</body></html>`,
        emailType: "welcome",
        recipientUserId: userId,
      }).catch((err) => console.error("[Signup] ACC-001 email error:", err));

      return { success: true, redirectTo: "/nanny" };
    } catch (innerError) {
      // Cleanup: delete auth user if any downstream insert failed
      console.error("Conversion error, cleaning up:", innerError);
      await adminClient.auth.admin.deleteUser(userId);
      return {
        success: false,
        error: "Failed to create account. Please try again.",
      };
    }
  } catch (err) {
    console.error("Convert lead exception:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}
