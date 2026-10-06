"use client";

import { useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UsersTab } from "./UsersTab";
import { VerificationTab } from "./VerificationTab";
import { Users, ShieldCheck } from "lucide-react";
import type { UserData, UserStats, VerificationStats, PendingIdentityCheck, PendingWWCCCheck } from "./page";

interface AdminUsersClientProps {
  users: UserData[];
  userStats: UserStats;
  verificationStats: VerificationStats;
  identityChecks: PendingIdentityCheck[];
  wwccChecks: PendingWWCCCheck[];
}

export function AdminUsersClient({
  users,
  userStats,
  verificationStats,
  identityChecks,
  wwccChecks,
}: AdminUsersClientProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab = tabParam === "verification" ? "verification" : "users";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="mt-1 text-slate-500">
          Manage users and review verifications
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
              <span className="sm:hidden">Users</span>
            </TabsTrigger>
            <TabsTrigger value="verification" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Nanny Verification</span>
              <span className="sm:hidden">Nanny</span>
              {verificationStats.pending > 0 && (
                <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {verificationStats.pending}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users">
          <UsersTab users={users} stats={userStats} />
        </TabsContent>

        <TabsContent value="verification">
          <VerificationTab
            stats={verificationStats}
            identityChecks={identityChecks}
            wwccChecks={wwccChecks}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
