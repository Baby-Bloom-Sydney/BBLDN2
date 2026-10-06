import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NannyMyProfile } from "@/app/nanny/profile/NannyMyProfile";
import type { NannyProfile } from "@/lib/actions/nanny";
import { ASSURANCE_OPTIONS, CERTIFICATE_OPTIONS, byOptionOrder } from "@/lib/nanny-options";

export default async function AdminViewerProfilePage({
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
    // Fetch user profile
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, last_name, email, mobile_number, date_of_birth, suburb, postcode, profile_picture_url")
      .eq("user_id", targetUserId)
      .single();

    if (!profile) {
      return <div className="p-6 text-center text-slate-500">Profile not found</div>;
    }

    // Fetch nanny record
    const { data: nanny } = await admin
      .from("nannies")
      .select("*")
      .eq("user_id", targetUserId)
      .single();

    if (!nanny) {
      return <div className="p-6 text-center text-slate-500">Nanny record not found</div>;
    }

    // Fetch credentials, assurances, availability
    const [credsRes, assurRes, availRes] = await Promise.all([
      admin
        .from("nanny_credentials")
        .select("credential_category, qualification_type, certification_type")
        .eq("nanny_id", nanny.id),
      admin
        .from("nanny_assurances")
        .select("assurance_type")
        .eq("nanny_id", nanny.id),
      admin
        .from("nanny_availability")
        .select("days_available, schedule")
        .eq("nanny_id", nanny.id)
        .maybeSingle(),
    ]);

    const highest_qualification =
      (credsRes.data || []).find(
        (c: { credential_category: string }) => c.credential_category === "qualification"
      )?.qualification_type || null;

    const certificates = (credsRes.data || [])
      .filter((c: { credential_category: string }) => c.credential_category === "certification")
      .map((c: { certification_type: string }) => c.certification_type)
      .filter((t: string | null): t is string => t !== null)
      .sort(byOptionOrder(CERTIFICATE_OPTIONS)); // P-2: array order = display order

    const assurances = (assurRes.data || [])
      .map((a: { assurance_type: string }) => a.assurance_type)
      .sort(byOptionOrder(ASSURANCE_OPTIONS)); // P-2

    const nannyProfile: NannyProfile = {
      ...profile,
      ...nanny,
      profile_picture_url: profile.profile_picture_url || nanny.profile_picture_url || null,
      nanny_id: nanny.id,
      highest_qualification,
      certificates,
      assurances,
      availability: availRes.data
        ? { days_available: availRes.data.days_available, schedule: availRes.data.schedule }
        : null,
      ai_content: nanny.ai_content || null,
    };

    return <NannyMyProfile profile={nannyProfile} />;
  }

  // Parent profile — minimal view
  if (role === "parent") {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("first_name, last_name, email, mobile_number, suburb, postcode, profile_picture_url")
      .eq("user_id", targetUserId)
      .single();

    if (!profile) {
      return <div className="p-6 text-center text-slate-500">Profile not found</div>;
    }

    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <h1 className="text-2xl font-bold text-slate-900">Parent Profile</h1>
        <div className="rounded-lg border bg-white p-6 space-y-3">
          <div className="flex items-center gap-4">
            {profile.profile_picture_url && (
              <img
                src={profile.profile_picture_url}
                alt="Profile"
                className="h-16 w-16 rounded-full object-cover"
              />
            )}
            <div>
              <p className="text-lg font-semibold">
                {profile.first_name} {profile.last_name}
              </p>
              <p className="text-sm text-slate-500">{profile.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Phone:</span>{" "}
              {profile.mobile_number || "-"}
            </div>
            <div>
              <span className="text-slate-500">Location:</span>{" "}
              {profile.suburb || "-"} {profile.postcode || ""}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-center text-slate-500">
      Profile viewer not available for role: {role}
    </div>
  );
}
