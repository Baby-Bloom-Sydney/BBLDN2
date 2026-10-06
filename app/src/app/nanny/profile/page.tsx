import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { getNannyProfile, isProfileComplete } from "@/lib/actions/nanny";
import { NannyMyProfile } from "./NannyMyProfile";

export default async function NannyProfilePage() {
  const complete = await isProfileComplete();
  if (!complete) {
    redirect("/apply");
  }

  const { data: profile, error } = await getNannyProfile();

  if (error || !profile) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
          <p className="mt-1 text-slate-500">Manage your nanny profile</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p className="text-red-600">{error || "Failed to load profile"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <NannyMyProfile profile={profile} />;
}
