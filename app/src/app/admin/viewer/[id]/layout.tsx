import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminViewerBar } from "./AdminViewerBar";

interface LayoutProps {
  children: React.ReactNode;
  params: { id: string };
}

export default async function AdminViewerLayout({ children, params }: LayoutProps) {
  // Verify admin auth
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const admin = createAdminClient();

  // Verify caller is admin
  const { data: callerRole } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!callerRole || !["admin", "super_admin"].includes(callerRole.role)) {
    redirect("/login");
  }

  const targetUserId = params.id;

  // Fetch target user info
  const [profileRes, roleRes] = await Promise.all([
    admin
      .from("user_profiles")
      .select("first_name, last_name, email, profile_picture_url")
      .eq("user_id", targetUserId)
      .single(),
    admin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetUserId)
      .single(),
  ]);

  if (!profileRes.data || !roleRes.data) {
    redirect("/admin/users");
  }

  const role = roleRes.data.role as "nanny" | "parent";

  // Fetch verification level
  let verificationLevel = 0;
  if (role === "nanny") {
    const { data: nanny } = await admin
      .from("nannies")
      .select("verification_level")
      .eq("user_id", targetUserId)
      .single();
    verificationLevel = nanny?.verification_level ?? 0;
  }

  const targetUser = {
    userId: targetUserId,
    firstName: profileRes.data.first_name || "",
    lastName: profileRes.data.last_name || "",
    email: profileRes.data.email || "",
    profilePictureUrl: profileRes.data.profile_picture_url || null,
    role,
    verificationLevel,
  };

  return (
    <div>
      <AdminViewerBar user={targetUser} />
      <div className="pt-2">{children}</div>
    </div>
  );
}
