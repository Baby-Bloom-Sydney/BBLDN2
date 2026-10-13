"use client";

/**
 * Admin "Nanny Verification" tab: stat cards + two sub-tabs — ID (unchanged) and DBS (unit 3d: lists A–D in
 * `DbsQueueTab`, decisions in `DBSCheckModal`). The OCG portal button, Confirm stamp, DD/MM/YYYY copy cells and the
 * method column are gone (spec §4). Stat numbers come from `fetchVerificationStats` (`ADMIN_PENDING_CODES`, S1).
 * Never: computes a status list of its own (3a owns code sets).
 */
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { formatRelativeTime } from "@/lib/utils";
import { STATUS_LABELS, statusTone } from "@/lib/verification";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IDCheckModal } from "./IDCheckModal";
import { DbsQueueTab } from "./DbsQueueTab";
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  IdCard,
  FileText,
} from "lucide-react";
import type { VerificationStats, PendingIdentityCheck, DbsQueues, PendingDbsCheck } from "./page";

interface VerificationTabProps {
  stats: VerificationStats;
  identityChecks: PendingIdentityCheck[];
  dbsQueues: DbsQueues<PendingDbsCheck>;
}

// ── Status badge variant for verification status integer ──

function getStatusBadgeVariant(status: number): "pending" | "verified" | "inactive" | "active" | "failed" | "info" {
  const tone = statusTone(status);
  return tone === "unattempted" ? "pending" : tone;
}

export function VerificationTab({ stats, identityChecks, dbsQueues }: VerificationTabProps) {
  const [selectedIdCheck, setSelectedIdCheck] = useState<PendingIdentityCheck | null>(null);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pending}</p>
                <p className="text-xs text-slate-500">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.approvedToday}</p>
                <p className="text-xs text-slate-500">Approved Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.rejectedToday}</p>
                <p className="text-xs text-slate-500">Rejected Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                <ShieldCheck className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalVerified}</p>
                <p className="text-xs text-slate-500">Total Verified</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sub-tabs: ID / DBS */}
      <Tabs defaultValue="id" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <TabsList className="w-max sm:w-auto">
          <TabsTrigger value="id" className="gap-2">
            <IdCard className="h-4 w-4" />
            <span className="hidden sm:inline">ID Verification</span>
            <span className="sm:hidden">ID</span>
            {identityChecks.length > 0 && (
              <span className="ml-1 rounded-full bg-yellow-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {identityChecks.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="dbs" className="gap-2">
            <FileText className="h-4 w-4" />
            <span>DBS</span>
            {dbsQueues.badgeCount > 0 && (
              <span className="ml-1 rounded-full bg-yellow-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {dbsQueues.badgeCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        </div>

        {/* ID Sub-tab */}
        <TabsContent value="id">
          <Card>
            <CardHeader>
              <CardTitle>Pending Identity Checks</CardTitle>
              <CardDescription>
                Review passport and photo ID submissions ({identityChecks.length} pending)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {identityChecks.length > 0 ? (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {identityChecks.map((check) => {
                      const name = `${check.first_name || ""} ${check.last_name || ""}`.trim() || "Unknown";

                      return (
                        <TableRow key={check.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <UserAvatar
                                name={name}
                                imageUrl={check.profile_picture_url || undefined}
                                className="h-8 w-8"
                              />
                              <div>
                                <p className="font-medium">{name}</p>
                                <p className="text-sm text-slate-500">{check.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-slate-500">
                              {formatRelativeTime(check.created_at)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge variant={getStatusBadgeVariant(check.verification_status)}>
                              {STATUS_LABELS[check.verification_status] || `Unknown (${check.verification_status})`}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedIdCheck(check)}
                            >
                              Check ID
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              ) : (
                <EmptyState
                  icon={IdCard}
                  title="No pending ID checks"
                  description="All identity verifications have been reviewed."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DBS Sub-tab — lists A–D (unit 3d) */}
        <TabsContent value="dbs">
          <DbsQueueTab queues={dbsQueues} />
        </TabsContent>
      </Tabs>

      {/* ID Check Modal */}
      <IDCheckModal
        check={selectedIdCheck}
        open={!!selectedIdCheck}
        onOpenChange={(open) => !open && setSelectedIdCheck(null)}
      />
    </div>
  );
}
