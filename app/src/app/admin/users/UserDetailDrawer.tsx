"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LEVEL_LABELS, STATUS_LABELS } from "@/lib/verification";
import { adminDeleteUser, adminChangeRole, adminResetVerification, adminRegenerateNannyBio } from "@/lib/actions/admin";
import { CheckCircle2, Clock, XCircle, MapPin, Mail, Phone, Calendar, Shield, Baby, Loader2, Trash2, RefreshCw, UserCog, ExternalLink, Send, Eye } from "lucide-react";
import { ContactUserModal } from "./ContactUserModal";
import type { UserData } from "./page";

interface UserDetailDrawerProps {
  user: UserData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getLevelVariant(level: number | null): "inactive" | "pending" | "active" | "verified" | "info" {
  if (level === null) return "inactive";
  if (level === 0) return "inactive";
  if (level === 1) return "pending";
  if (level === 2) return "info";
  if (level === 3) return "active";
  return "verified";
}

function getStatusVariant(status: number | null): "unattempted" | "pending" | "failed" | "verified" | "active" | "info" {
  if (status === null) return "unattempted";
  if (status === 0) return "unattempted";
  if (status === 20) return "info";
  if (status === 12 || status === 22 || status === 23 || status === 26 || status === 27 || status === 28) return "failed";
  if (status === 30) return "active";
  if (status === 40) return "verified";
  return "pending";
}

function AdminActions({ user, onClose }: { user: UserData; onClose: () => void }) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(user.role);
  const [showRoleConfirm, setShowRoleConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unknown";

  const handleChangeRole = async () => {
    if (selectedRole === user.role) return;
    setLoading("role");
    setResult(null);
    const res = await adminChangeRole(user.user_id, selectedRole as 'nanny' | 'parent' | 'admin');
    setLoading(null);
    if (res.success) {
      setResult({ type: "success", message: `Role changed to ${selectedRole}` });
      setShowRoleConfirm(false);
      router.refresh();
    } else {
      setResult({ type: "error", message: res.error || "Failed" });
    }
  };

  const handleRegenerateBio = async () => {
    setLoading("regenerate");
    setResult(null);
    const res = await adminRegenerateNannyBio(user.user_id);
    setLoading(null);
    if (res.success) {
      setResult({ type: "success", message: "AI profile regenerated" });
      router.refresh();
    } else {
      setResult({ type: "error", message: res.error || "Failed" });
    }
  };

  const handleResetVerification = async () => {
    setLoading("reset");
    setResult(null);
    const res = await adminResetVerification(user.user_id);
    setLoading(null);
    if (res.success) {
      setResult({ type: "success", message: "Verification reset to zero" });
      setShowResetConfirm(false);
      router.refresh();
    } else {
      setResult({ type: "error", message: res.error || "Failed" });
    }
  };

  const handleDelete = async () => {
    setLoading("delete");
    setResult(null);
    const res = await adminDeleteUser(user.user_id);
    setLoading(null);
    if (res.success) {
      onClose();
      router.refresh();
    } else {
      setResult({ type: "error", message: res.error || "Failed" });
    }
  };

  return (
    <Card className="border-red-200">
      <CardContent className="p-4 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <UserCog className="h-4 w-4 text-slate-500" />
          Admin Actions
        </h3>

        {result && (
          <p className={`text-sm ${result.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {result.message}
          </p>
        )}

        {/* Change Role */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase">Change Role</p>
          <div className="flex gap-2">
            <select
              value={selectedRole}
              onChange={(e) => { setSelectedRole(e.target.value); setShowRoleConfirm(false); }}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="nanny">Nanny</option>
              <option value="parent">Parent</option>
              <option value="admin">Admin</option>
            </select>
            {selectedRole !== user.role && !showRoleConfirm && (
              <Button size="sm" variant="outline" onClick={() => setShowRoleConfirm(true)}>
                Change
              </Button>
            )}
          </div>
          {showRoleConfirm && selectedRole !== user.role && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
              <p className="text-sm text-amber-800 flex-1">
                Change to <span className="font-semibold">{selectedRole}</span>?
              </p>
              <Button size="sm" variant="ghost" onClick={() => setShowRoleConfirm(false)}>No</Button>
              <Button size="sm" onClick={handleChangeRole} disabled={loading === "role"}>
                {loading === "role" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
              </Button>
            </div>
          )}
        </div>

        {/* Reset Verification (nannies only) */}
        {user.role === "nanny" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase">Reset Verification</p>
            {!showResetConfirm ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setShowResetConfirm(true)}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Reset to Level 0
              </Button>
            ) : (
              <div className="rounded-lg bg-amber-50 px-3 py-2 space-y-2">
                <p className="text-sm text-amber-800">
                  This deletes all verification records and resets to zero. Continue?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => setShowResetConfirm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={handleResetVerification} disabled={loading === "reset"}>
                    {loading === "reset" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reset"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Regenerate AI Profile (nannies only) */}
        {user.role === "nanny" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase">Regenerate AI Profile</p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={handleRegenerateBio}
              disabled={loading === "regenerate"}
            >
              {loading === "regenerate" ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              {loading === "regenerate" ? "Regenerating..." : "Regenerate Profile"}
            </Button>
          </div>
        )}

        {/* Delete User */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase">Delete User</p>
          {!showDeleteConfirm ? (
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete User
            </Button>
          ) : (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-3 space-y-2">
              <p className="text-sm text-red-800">
                Type <span className="font-mono font-semibold">{name}</span> to confirm deletion.
                This cannot be undone.
              </p>
              <Input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder="Type user name..."
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(""); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={deleteConfirmName !== name || loading === "delete"}
                  onClick={handleDelete}
                >
                  {loading === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete Forever"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function UserDetailDrawer({ user, open, onOpenChange }: UserDetailDrawerProps) {
  const [showContactModal, setShowContactModal] = useState(false);

  if (!user) return null;

  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unknown";
  const level = user.verification_level;
  const status = user.verification_status;

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Profile Header */}
          <div className="flex items-center gap-4">
            <UserAvatar
              name={name}
              imageUrl={user.profile_picture_url || undefined}
              className="h-16 w-16"
            />
            <div>
              <p className="text-lg font-semibold">{name}</p>
              <p className="capitalize text-sm text-slate-500">{user.role.replace("_", " ")}</p>
              {user.role === "nanny" && (
                <div className="mt-1">
                  <StatusBadge variant={getLevelVariant(level)}>
                    {LEVEL_LABELS[level ?? 0] || `Unknown (${level})`}
                  </StatusBadge>
                </div>
              )}
            </div>
          </div>

          {/* View Profile + View as User + Contact */}
          <div className="flex gap-2">
            {user.role === "nanny" && user.nanny_id && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(`/nannies/${user.nanny_id}`, '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View Profile
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(`/admin/viewer/${user.user_id}`, '_blank')}
            >
              <Eye className="mr-2 h-4 w-4" />
              View as User
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={!user.email}
              onClick={() => setShowContactModal(true)}
            >
              <Send className="mr-2 h-4 w-4" />
              Contact
            </Button>
          </div>

          {/* Personal Info */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Personal Information</h3>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>{user.email || "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span>{user.mobile_number || "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>DOB: {formatDate(user.date_of_birth)}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>
                    {user.suburb
                      ? `${user.suburb}${user.postcode ? ` (${user.postcode})` : ""}`
                      : "-"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Role & Status */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Role & Status</h3>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Role</span>
                  <span className="capitalize font-medium">{user.role.replace("_", " ")}</span>
                </div>
                {user.role === "nanny" && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Babysitter</span>
                      {user.babysitter_eligible ? (
                        <span className="flex items-center gap-1 text-green-600 font-medium">
                          <Baby className="h-3.5 w-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Joined</span>
                  <span>{formatDate(user.created_at)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Verification Summary (nannies only) */}
          {user.role === "nanny" && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-violet-500" />
                  Verification
                </h3>

                {/* Level */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Level</span>
                  <StatusBadge variant={getLevelVariant(level)}>
                    {LEVEL_LABELS[level ?? 0] || `Unknown (${level})`}
                  </StatusBadge>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Status</span>
                  <StatusBadge variant={getStatusVariant(status)}>
                    {STATUS_LABELS[status ?? 0] || `Unknown (${status})`}
                  </StatusBadge>
                </div>

                <hr className="border-slate-100" />

                {/* ID + WWCC breakdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Identity (Passport)</span>
                    {user.identity_verified ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                      </span>
                    ) : status !== null && status >= 10 && status < 20 ? (
                      status === 12 ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3.5 w-3.5" /> Rejected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Clock className="h-3.5 w-3.5" /> Pending
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">Not started</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">WWCC</span>
                    {user.wwcc_verified ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                      </span>
                    ) : status !== null && status >= 20 && status < 40 ? (
                      status === 22 && user.nanny_status === 'suspended' ? (
                        <span className="flex items-center gap-1 text-red-700 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> BARRED
                        </span>
                      ) : status === 22 ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3.5 w-3.5" /> Rejected
                        </span>
                      ) : status === 23 ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3.5 w-3.5" /> Expired
                        </span>
                      ) : status === 26 ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3.5 w-3.5" /> OCG Not Found
                        </span>
                      ) : status === 27 ? (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3.5 w-3.5" /> Closed
                        </span>
                      ) : status === 28 ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Clock className="h-3.5 w-3.5" /> Application Pending
                        </span>
                      ) : status === 30 ? (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Clock className="h-3.5 w-3.5" /> Provisional
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Clock className="h-3.5 w-3.5" /> Pending
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">Not started</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Admin Actions */}
          <AdminActions user={user} onClose={() => onOpenChange(false)} />
        </div>

        {/* Contact User Modal */}
        {user.email && (
          <ContactUserModal
            userEmail={user.email}
            userName={name}
            userId={user.user_id}
            open={showContactModal}
            onOpenChange={setShowContactModal}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
