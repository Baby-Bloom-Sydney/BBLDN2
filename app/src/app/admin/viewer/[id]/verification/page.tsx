import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VerificationPageClient } from "@/app/nanny/verification/VerificationPageClient";

export default async function AdminViewerVerificationPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const targetUserId = params.id;

  // Determine role
  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId)
    .single();

  if (!roleData) redirect("/admin/users");

  const role = roleData.role as string;

  if (role === "nanny") {
    // Fetch nanny verification data
    const { data: verification } = await admin
      .from("verifications")
      .select(`
        id,
        identity_status, wwcc_status, contact_status, cross_check_status,
        verification_status,
        surname, given_names, date_of_birth, passport_country,
        passport_upload_url, identification_photo_url,
        identity_verified, identity_rejection_reason, identity_user_guidance,
        extracted_passport_number, extracted_nationality,
        wwcc_verification_method, wwcc_number, wwcc_expiry_date,
        wwcc_grant_email_url, wwcc_service_nsw_screenshot_url,
        wwcc_doc_verified, wwcc_verified, wwcc_rejection_reason, wwcc_user_guidance,
        phone_number, address_line, city, state, postcode, country,
        cross_check_reasoning,
        created_at, updated_at
      `)
      .eq("user_id", targetUserId)
      .maybeSingle();

    // Fetch profile for pre-filling
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, last_name, date_of_birth")
      .eq("user_id", targetUserId)
      .maybeSingle();

    return (
      <VerificationPageClient
        initialData={verification}
        profileData={
          profile
            ? {
                firstName: profile.first_name ?? "",
                lastName: profile.last_name ?? "",
                dateOfBirth: profile.date_of_birth ?? "",
              }
            : null
        }
      />
    );
  }

  return (
    <div className="p-6 text-center text-slate-500">
      Verification viewer not available for role: {role}
    </div>
  );
}
