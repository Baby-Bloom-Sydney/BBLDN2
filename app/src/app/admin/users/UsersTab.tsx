"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { formatRelativeTime } from "@/lib/utils";
import { LEVEL_LABELS, STATUS_LABELS, statusTone } from "@/lib/verification";
import { Search, Users, X, Baby } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserDetailDrawer } from "./UserDetailDrawer";
import type { UserData, UserStats } from "./page";

interface UsersTabProps {
  users: UserData[];
  stats: UserStats;
}

type RoleFilter = "all" | "nanny" | "parent" | "admin";
type LevelFilter = "all" | "0" | "1" | "2" | "3" | "4";
type StatusFilter = "all" | "id_stage" | "wwcc_stage" | "verified" | "rejected";

// ── Level badge variant ──

function getLevelVariant(
  level: number | null,
): "inactive" | "pending" | "active" | "verified" | "info" {
  if (level === null) return "inactive";
  if (level === 0) return "inactive";
  if (level === 1) return "pending";
  if (level === 2) return "info";
  if (level === 3) return "active";
  return "verified";
}

// ── Status badge variant: statusTone from lib/verification.ts (3a; no local code map) ──

// ── Filter matching ──

function matchesLevelFilter(user: UserData, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  return user.verification_level === parseInt(filter);
}

function matchesStatusFilter(user: UserData, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const s = user.verification_status;
  if (s === null) return false;
  if (filter === "id_stage") return s >= 10 && s < 20;
  if (filter === "wwcc_stage") return s >= 20 && s < 30;
  if (filter === "verified") return s >= 30;
  if (filter === "rejected")
    return s === 12 || s === 22 || s === 23 || s === 26 || s === 27 || s === 28;
  return true;
}

export function UsersTab({ users, stats }: UsersTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);

  // Auto-open the drawer when `/admin/users?openUser=<id>` is the
  // entry URL. Lets other admin surfaces deep-link a parent/nanny
  // profile (e.g. the subscription detail page's quick-access
  // buttons). Bailey 2026-05-14.
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get("openUser");
  useEffect(() => {
    if (!targetUserId) return;
    const match = users.find((u) => u.user_id === targetUserId);
    if (match) setSelectedUser(match);
  }, [targetUserId, users]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name =
          `${user.first_name || ""} ${user.last_name || ""}`.toLowerCase();
        const email = (user.email || "").toLowerCase();
        if (!name.includes(query) && !email.includes(query)) return false;
      }
      if (roleFilter !== "all") {
        if (roleFilter === "admin") {
          if (user.role !== "admin" && user.role !== "super_admin")
            return false;
        } else if (user.role !== roleFilter) return false;
      }
      if (!matchesLevelFilter(user, levelFilter)) return false;
      if (!matchesStatusFilter(user, statusFilter)) return false;
      return true;
    });
  }, [users, searchQuery, roleFilter, levelFilter, statusFilter]);

  const hasActiveFilters =
    searchQuery ||
    roleFilter !== "all" ||
    levelFilter !== "all" ||
    statusFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setLevelFilter("all");
    setStatusFilter("all");
  };

  const selectClass =
    "rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-slate-500">Total Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{stats.nannies}</p>
            <p className="text-xs text-slate-500">Nannies</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{stats.parents}</p>
            <p className="text-xs text-slate-500">Parents</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{stats.admins}</p>
            <p className="text-xs text-slate-500">Admins</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by name or email..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select
              className={selectClass}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            >
              <option value="all">All Roles</option>
              <option value="nanny">Nannies</option>
              <option value="parent">Parents</option>
              <option value="admin">Admins</option>
            </select>
            <select
              className={selectClass}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
            >
              <option value="all">All Levels</option>
              <option value="0">Signed Up (0)</option>
              <option value="1">Registered (1)</option>
              <option value="2">ID Verified (2)</option>
              <option value="3">Provisional (3)</option>
              <option value="4">Fully Verified (4)</option>
            </select>
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All Status</option>
              <option value="id_stage">ID Stage (10-12)</option>
              <option value="wwcc_stage">DBS Stage (20-29)</option>
              <option value="verified">Verified (30-40)</option>
              <option value="rejected">Rejected</option>
            </select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-500" />
            All Users
          </CardTitle>
          <CardDescription>
            Showing {filteredUsers.length} of {users.length} users
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredUsers.length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>BSR</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const name =
                      `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                      "Unknown";

                    return (
                      <TableRow
                        key={user.user_id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setSelectedUser(user)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              name={name}
                              imageUrl={user.profile_picture_url || undefined}
                              className="h-8 w-8"
                            />
                            <div>
                              <p className="font-medium">{name}</p>
                              <p className="text-sm text-slate-500">
                                {user.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="capitalize">
                            {user.role.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {user.role === "nanny" ? (
                            <StatusBadge
                              variant={getLevelVariant(user.verification_level)}
                            >
                              {LEVEL_LABELS[user.verification_level ?? 0] ||
                                `Unknown (${user.verification_level})`}
                            </StatusBadge>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.role === "nanny" &&
                          user.verification_status !== null ? (
                            <StatusBadge
                              variant={statusTone(
                                user.verification_status,
                              )}
                            >
                              {STATUS_LABELS[user.verification_status] ||
                                `Unknown (${user.verification_status})`}
                            </StatusBadge>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.role === "nanny" ? (
                            user.babysitter_eligible ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-green-700">
                                <Baby className="h-3.5 w-3.5" />
                                Yes
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">No</span>
                            )
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.suburb ? (
                            <span className="text-sm">
                              {user.suburb}
                              {user.postcode && ` (${user.postcode})`}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-slate-500">
                            {formatRelativeTime(user.created_at)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="No users found"
              description={
                hasActiveFilters
                  ? "Try adjusting your search or filters."
                  : "No users have signed up yet."
              }
            />
          )}
        </CardContent>
      </Card>

      {/* User Detail Drawer */}
      <UserDetailDrawer
        user={selectedUser}
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      />
    </div>
  );
}
