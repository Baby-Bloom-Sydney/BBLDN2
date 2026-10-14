/**
 * Admin dashboard: headline counts and recent activity. Unit 3d: the "Pending verifications" count reads 3a's
 * ADMIN_PENDING_CODES [10,11,21,30] (it filtered an integer column on the string 'pending', so it was always 0) — the
 * same number as the Verification tab and analytics (S1). Never: keeps a status list of its own.
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { formatRelativeTime } from "@/lib/utils";
import {
  Users,
  UserCheck,
  ShieldCheck,
  Briefcase,
  Filter,
  BarChart3,
  Settings,
  TrendingUp,
  UserPlus,
  Phone,
} from "lucide-react";
import { ADMIN_PENDING_CODES } from "@/lib/verification";

interface RecentUser {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  created_at: string;
  role: string;
}

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";

async function getDashboardStats() {
  if (isDevMode) {
    return {
      nannyCount: 24,
      parentCount: 18,
      pendingCount: 3,
      activeCount: 7,
      newThisWeek: 5,
      newNanniesThisWeek: 3,
      newParentsThisWeek: 2,
      conversionRate: 42,
    };
  }
  const supabase = createClient();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Fetch counts in parallel
  const [
    nannyCountResult,
    parentCountResult,
    pendingVerificationsResult,
    activePlacementsResult,
    newNanniesThisWeekResult,
    newParentsThisWeekResult,
    tier2NanniesResult,
  ] = await Promise.all([
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "nanny"),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "parent"),
    supabase
      .from("verifications")
      .select("*", { count: "exact", head: true })
      .in("verification_status", [...ADMIN_PENDING_CODES]), // 3d: same codes as the Verification tab (S1)
    supabase
      .from("nanny_placements")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "nanny")
      .gte("created_at", oneWeekAgo.toISOString()),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "parent")
      .gte("created_at", oneWeekAgo.toISOString()),
    supabase
      .from("nannies")
      .select("*", { count: "exact", head: true })
      .eq("wwcc_verified", true)
      .eq("identity_verified", true),
  ]);

  const nannyCount = nannyCountResult.count ?? 0;
  const parentCount = parentCountResult.count ?? 0;
  const pendingCount = pendingVerificationsResult.count ?? 0;
  const activeCount = activePlacementsResult.count ?? 0;
  const newNanniesThisWeek = newNanniesThisWeekResult.count ?? 0;
  const newParentsThisWeek = newParentsThisWeekResult.count ?? 0;
  const tier2Nannies = tier2NanniesResult.count ?? 0;

  // Calculate conversion rate (tier2 / total nannies)
  const conversionRate =
    nannyCount > 0 ? Math.round((tier2Nannies / nannyCount) * 100) : 0;

  return {
    nannyCount,
    parentCount,
    pendingCount,
    activeCount,
    newThisWeek: newNanniesThisWeek + newParentsThisWeek,
    newNanniesThisWeek,
    newParentsThisWeek,
    conversionRate,
  };
}

async function getRecentActivity(): Promise<RecentUser[]> {
  if (isDevMode) {
    return [
      {
        user_id: "d1",
        first_name: "Sophie",
        last_name: "Anderson",
        email: "sophie@test.com",
        profile_picture_url: null,
        created_at: new Date().toISOString(),
        role: "nanny",
      },
      {
        user_id: "d2",
        first_name: "James",
        last_name: "Chen",
        email: "james@test.com",
        profile_picture_url: null,
        created_at: new Date(Date.now() - 86400000).toISOString(),
        role: "parent",
      },
      {
        user_id: "d3",
        first_name: "Mia",
        last_name: "Lee",
        email: "mia@test.com",
        profile_picture_url: null,
        created_at: new Date(Date.now() - 172800000).toISOString(),
        role: "nanny",
      },
    ];
  }
  const supabase = createClient();

  // Get recent user profiles with their roles
  const { data, error } = await supabase
    .from("user_profiles")
    .select(
      `
      user_id,
      first_name,
      last_name,
      email,
      profile_picture_url,
      created_at,
      user_roles!inner(role)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !data) {
    return [];
  }

  // Transform the data to flatten the role
  return data.map((user) => ({
    user_id: user.user_id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    profile_picture_url: user.profile_picture_url,
    created_at: user.created_at,
    role: (user.user_roles as unknown as { role: string })?.role || "unknown",
  }));
}

export default async function AdminDashboardPage() {
  const [stats, recentActivity] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(),
  ]);

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="mt-1 text-slate-500">
            Monitor and manage the Baby Bloom platform.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard
          icon={Users}
          value={stats.nannyCount}
          label="Total Nannies"
          iconColor="text-violet-500"
          iconBgColor="bg-violet-100"
        />
        <StatsCard
          icon={UserCheck}
          value={stats.parentCount}
          label="Total Parents"
          iconColor="text-blue-500"
          iconBgColor="bg-blue-100"
        />
        <StatsCard
          icon={ShieldCheck}
          value={stats.pendingCount}
          label="Pending Verifications"
          iconColor="text-yellow-500"
          iconBgColor="bg-yellow-100"
        />
        <StatsCard
          icon={Briefcase}
          value={stats.activeCount}
          label="Active Placements"
          iconColor="text-green-500"
          iconBgColor="bg-green-100"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <UserPlus className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.newThisWeek}</p>
                <p className="text-xs text-slate-500">
                  New This Week ({stats.newNanniesThisWeek} nannies,{" "}
                  {stats.newParentsThisWeek} parents)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                <TrendingUp className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.conversionRate}%</p>
                <p className="text-xs text-slate-500">Tier 2 Conversion Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <ShieldCheck className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">-</p>
                <p className="text-xs text-slate-500">Avg. Time to Verify</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Quick Actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/admin/leads">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <Phone className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-medium">Contacts</h3>
                  <p className="text-sm text-slate-500">Nanny contact log</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/pipeline">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <Filter className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-medium">User Pipeline</h3>
                  <p className="text-sm text-slate-500">View funnel</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/verifications">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <ShieldCheck className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-medium">Verifications</h3>
                  <p className="text-sm text-slate-500">
                    {stats.pendingCount > 0
                      ? `${stats.pendingCount} pending`
                      : "Review documents"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/analytics">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <BarChart3 className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-medium">Analytics</h3>
                  <p className="text-sm text-slate-500">View metrics</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/settings">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <Settings className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-medium">Settings</h3>
                  <p className="text-sm text-slate-500">Platform config</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest user signups on the platform</CardDescription>
        </CardHeader>
        <CardContent>
          {recentActivity.length > 0 ? (
            <div className="space-y-4">
              {recentActivity.map((user) => (
                <div
                  key={user.user_id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      name={
                        `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                        "Unknown"
                      }
                      imageUrl={user.profile_picture_url || undefined}
                      className="h-10 w-10"
                    />
                    <div>
                      <p className="font-medium">
                        {`${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                          "Unknown User"}
                      </p>
                      <p className="text-sm text-slate-500">{user.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                      {user.role}
                    </span>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatRelativeTime(user.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="No recent activity"
              description="When users sign up for the platform, they'll appear here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
