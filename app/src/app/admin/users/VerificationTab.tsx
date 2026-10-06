"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { adminConfirmWWCC } from "@/lib/actions/admin";
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  IdCard,
  FileText,
  ExternalLink,
  Copy,
  Check,
  Plus,
  Loader2,
} from "lucide-react";
import type { VerificationStats, PendingIdentityCheck, PendingWWCCCheck } from "./page";

interface VerificationTabProps {
  stats: VerificationStats;
  identityChecks: PendingIdentityCheck[];
  wwccChecks: PendingWWCCCheck[];
}

// ── Copy-to-clipboard cell ──

function CopyCell({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">-</span>;

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className="group flex items-center gap-1 text-left hover:text-violet-600 transition-colors"
      title="Click to copy"
    >
      <span>{value}</span>
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3 text-slate-300 group-hover:text-violet-400" />
      )}
    </button>
  );
}

// ── Format DOB for OCG portal (DD/MM/YYYY) ──

function formatDobForCopy(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Status badge variant for verification status integer ──

function getStatusBadgeVariant(status: number): "pending" | "verified" | "inactive" | "active" | "failed" | "info" {
  const tone = statusTone(status);
  return tone === "unattempted" ? "pending" : tone;
}

export function VerificationTab({ stats, identityChecks, wwccChecks }: VerificationTabProps) {
  const router = useRouter();
  const [selectedIdCheck, setSelectedIdCheck] = useState<PendingIdentityCheck | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Optimistic UI: track IDs confirmed this session to prevent flash before router.refresh() lands
  const [justConfirmed, setJustConfirmed] = useState<Set<string>>(new Set());

  async function handleConfirmWWCC(checkId: string) {
    setLoadingId(checkId);
    const result = await adminConfirmWWCC(checkId);
    setLoadingId(null);

    if (result.success) {
      setJustConfirmed((prev) => { const next = new Set(Array.from(prev)); next.add(checkId); return next; });
      setConfirmingId(null);
      router.refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

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

      {/* Sub-tabs: ID / WWCC */}
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
          <TabsTrigger value="wwcc" className="gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">WWCC Verification</span>
            <span className="sm:hidden">WWCC</span>
            {wwccChecks.length > 0 && (
              <span className="ml-1 rounded-full bg-yellow-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {wwccChecks.length}
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

        {/* WWCC Sub-tab */}
        <TabsContent value="wwcc">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Pending WWCC Checks</CardTitle>
                  <CardDescription>
                    Verify WWCC numbers via the OCG portal ({wwccChecks.length} pending)
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    window.open(
                      "https://wwccemployer.ocg.nsw.gov.au/Login?ReturnUrl=%2FVerifyEmployee",
                      "_blank"
                    )
                  }
                >
                  Open OCG Portal
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {wwccChecks.length > 0 ? (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Surname</TableHead>
                      <TableHead>DOB</TableHead>
                      <TableHead>WWCC #</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wwccChecks.map((check) => {
                      const name = `${check.first_name || ""} ${check.last_name || ""}`.trim() || "Unknown";
                      const isConfirmed = check.wwcc_ocg_submitted_at !== null || justConfirmed.has(check.id);
                      const isConfirming = confirmingId === check.id;
                      const isLoading = loadingId === check.id;

                      const methodLabels: Record<string, string> = {
                        grant_email: "Grant Email",
                        service_nsw_app: "Service NSW",
                        manual_entry: "Manual",
                      };

                      return (
                        <TableRow
                          key={check.id}
                          className={isConfirmed ? "bg-green-50" : undefined}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <UserAvatar
                                name={name}
                                imageUrl={check.profile_picture_url || undefined}
                                className="h-7 w-7"
                              />
                              <div>
                                <p className="text-sm font-medium">{name}</p>
                                <p className="text-xs text-slate-400">{check.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <CopyCell value={check.surname} />
                          </TableCell>
                          <TableCell>
                            <CopyCell value={formatDobForCopy(check.date_of_birth)} />
                          </TableCell>
                          <TableCell>
                            <CopyCell value={check.wwcc_number} />
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-slate-600">
                              {check.wwcc_verification_method
                                ? methodLabels[check.wwcc_verification_method] || check.wwcc_verification_method
                                : "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-slate-500">
                              {formatRelativeTime(check.created_at)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              variant={
                                isConfirmed
                                  ? "verified"
                                  : getStatusBadgeVariant(check.verification_status)
                              }
                            >
                              {isConfirmed
                                ? "Confirmed"
                                : STATUS_LABELS[check.verification_status] || `Unknown (${check.verification_status})`}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-center">
                            {isConfirmed ? (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white mx-auto">
                                <Check className="h-4 w-4" />
                              </div>
                            ) : isConfirming ? (
                              <div className="flex items-center gap-1 justify-center">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-green-600 hover:bg-green-50"
                                  disabled={isLoading}
                                  onClick={() => handleConfirmWWCC(check.id)}
                                >
                                  {isLoading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Yes"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setConfirmingId(null)}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmingId(check.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-colors mx-auto"
                                title="Mark as verified"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No pending WWCC checks"
                  description="All WWCC verifications have been confirmed."
                />
              )}
            </CardContent>
          </Card>
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
