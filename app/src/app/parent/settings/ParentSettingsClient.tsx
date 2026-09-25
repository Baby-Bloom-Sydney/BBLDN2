"use client";

/**
 * Parent settings — tree-driven multi-level drill-down.
 *
 * Top-level tree (2026-05-07):
 *
 *   Profile           — leaf (legal name, DOB, address)
 *   Account           — branch
 *     ▸ Contact details
 *     ▸ Security
 *     (small "Close account" link at the bottom)
 *   Linked children   — leaf
 *   Contact Us        — leaf
 *
 * Notes:
 *   - "Communication preferences" is intentionally NOT shipped in
 *     v1 — the placeholder caused confusion. Add it back here when
 *     the email/SMS pref surface is built.
 *   - Address edits route through the GNAF picker
 *     (AddressPickerDialog) — no manual entry, ensures matching-
 *     consistent suburb/postcode and rejects out-of-area selections.
 *   - Mobile number is REQUIRED and validated against the AU mobile
 *     regex from `lib/au-contact.ts`.
 */

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  AlertTriangle,
  X,
  User,
  Settings,
  Users,
  LifeBuoy,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateParentAccountSettings,
  deactivateParentAccount,
} from "@/lib/actions/parent";
import { requestPasswordChange } from "@/lib/actions/account-security";
import { ChildManagementCard } from "@/components/bapp/ChildManagementCard";
import type { ChildClient } from "@/types/bapp";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { IdentityCard } from "@/components/settings/IdentityCard";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { EditFieldDialog } from "@/components/settings/EditFieldDialog";
import { AddressPickerDialog } from "@/components/settings/AddressPickerDialog";
import { ContactSection } from "@/components/settings/ContactSection";
import {
  formatAuMobile,
  isAuMobile,
  normaliseAuMobile,
} from "@/lib/au-contact";
import type { SettingsNode } from "@/components/settings/tree";

interface Props {
  profile: {
    first_name: string;
    last_name: string;
    email: string;
    mobile_number: string;
    date_of_birth: string;
    suburb: string;
    postcode: string;
  };
  managedChildren?: ChildClient[];
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildTree(childCount: number): SettingsNode[] {
  return [
    { id: "profile", label: "Profile", icon: User },
    {
      id: "account",
      label: "Account",
      icon: Settings,
      children: [
        { id: "contact", label: "Contact details" },
        { id: "security", label: "Security" },
      ],
    },
    {
      id: "linked-children",
      label: "Linked children",
      icon: Users,
      status:
        childCount > 0
          ? { label: String(childCount), tone: "neutral" }
          : undefined,
    },
    { id: "subscription", label: "Subscription", icon: CreditCard },
    { id: "contact-us", label: "Contact Us", icon: LifeBuoy },
    // Hidden danger leaf — reached only via the small link at the
    // bottom of Account's drill-down menu.
    { id: "close-account", label: "Close account", hidden: true, danger: true },
  ];
}

export function ParentSettingsClient({ profile, managedChildren = [] }: Props) {
  const params = useSearchParams();
  const activeId = params.get("s") ?? "";
  const fullName = `${profile.first_name} ${profile.last_name}`.trim();
  const tree = buildTree(managedChildren.length);

  return (
    <SettingsShell
      title="Settings"
      basePath="/parent/settings"
      tree={tree}
      activeId={activeId}
      identityCard={
        <IdentityCard
          fullName={fullName || "Your account"}
          email={profile.email}
          roleLabel="Parent"
        />
      }
      pageBottomLink={
        // Only surface "Close account" on the Account drill-down
        // page itself — not on every settings view. Per user spec
        // (2026-05-07): nested within Account, at the very bottom
        // of the page, separate from the rest of the menu.
        activeId === "account"
          ? { label: "Close account", targetId: "close-account" }
          : undefined
      }
      renderLeaf={(node) => {
        switch (node.id) {
          case "profile":
            return <ProfileSection profile={profile} />;
          case "contact":
            return <ContactDetailsSection profile={profile} />;
          case "security":
            return <SecuritySection />;
          case "linked-children":
            return <ChildrenSection items={managedChildren} />;
          case "subscription":
            return <SubscriptionLinkSection />;
          case "contact-us":
            return <ContactSection />;
          case "close-account":
            return <CloseAccountSection fullName={fullName} />;
          default:
            return null;
        }
      }}
    />
  );
}

// ── Profile (legal name, DOB, address) ────────────────────────

function ProfileSection({ profile }: { profile: Props["profile"] }) {
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [editingDob, setEditingDob] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [first, setFirst] = useState(profile.first_name);
  const [last, setLast] = useState(profile.last_name);
  const [dob, setDob] = useState(profile.date_of_birth);

  return (
    <div className="space-y-6">
      <SettingsSubsection header="Personal information">
        <SettingsRow
          label="Full legal name"
          value={
            `${profile.first_name} ${profile.last_name}`.trim() || undefined
          }
          onClick={() => {
            setFirst(profile.first_name);
            setLast(profile.last_name);
            setEditingName(true);
          }}
        />
        <SettingsRow
          label="Date of birth"
          value={
            profile.date_of_birth
              ? formatDate(profile.date_of_birth)
              : undefined
          }
          isLast
          onClick={() => {
            setDob(profile.date_of_birth);
            setEditingDob(true);
          }}
        />
      </SettingsSubsection>

      <SettingsSubsection header="Address">
        <SettingsRow
          label="Suburb"
          value={profile.suburb}
          onClick={() => setEditingAddress(true)}
        />
        <SettingsRow
          label="Postcode"
          value={profile.postcode}
          isLast
          onClick={() => setEditingAddress(true)}
        />
      </SettingsSubsection>

      <EditFieldDialog
        open={editingName}
        onOpenChange={setEditingName}
        title="Edit your full name"
        canSubmit={first.trim().length > 0 && last.trim().length > 0}
        onSubmit={async () => {
          const r = await updateParentAccountSettings({
            first_name: first.trim(),
            last_name: last.trim(),
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-first">First name</Label>
            <Input
              id="edit-first"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-last">Last name</Label>
            <Input
              id="edit-last"
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          </div>
        </div>
      </EditFieldDialog>

      <EditFieldDialog
        open={editingDob}
        onOpenChange={setEditingDob}
        title="Edit your date of birth"
        canSubmit={dob.length > 0}
        onSubmit={async () => {
          const r = await updateParentAccountSettings({
            date_of_birth: dob || null,
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-dob">Date of birth</Label>
          <Input
            id="edit-dob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            autoFocus
          />
        </div>
      </EditFieldDialog>

      <AddressPickerDialog
        open={editingAddress}
        onOpenChange={setEditingAddress}
        currentSuburb={profile.suburb}
        currentPostcode={profile.postcode}
        onSubmit={async (address) => {
          const r = await updateParentAccountSettings({
            suburb: address.suburb,
            postcode: address.postcode,
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      />
    </div>
  );
}

// ── Contact details ────────────────────────────────────────────

function ContactDetailsSection({ profile }: { profile: Props["profile"] }) {
  const router = useRouter();
  const [editingMobile, setEditingMobile] = useState(false);
  const [mobile, setMobile] = useState(profile.mobile_number);

  // Mobile is required + AU-validated: an empty / invalid value
  // can never be saved. The dialog disables Save until a valid
  // value is in the input, and the server action enforces the
  // same rule at the API boundary as defence-in-depth.
  const trimmed = mobile.trim();
  const mobileValid = trimmed.length > 0 && isAuMobile(trimmed);

  // ── Email change — DISABLED in v1 (2026-05-07) ──────────────────
  // Email is read-only for now. Server-side flow remains wired for
  // when we re-enable: see updateAccountEmail in lib/actions/nanny
  // and the auth callback at /api/auth/callback/route.ts.

  return (
    <div className="space-y-6">
      <SettingsSubsection header="Email">
        <SettingsRow
          label="Email address"
          value={profile.email}
          badge={
            profile.email ? { label: "Verified", tone: "success" } : undefined
          }
          isLast
          // Email change disabled in v1.
        />
      </SettingsSubsection>

      <SettingsSubsection header="Phone">
        <SettingsRow
          label="Mobile number"
          value={
            profile.mobile_number
              ? formatAuMobile(profile.mobile_number)
              : undefined
          }
          isLast
          onClick={() => {
            setMobile(profile.mobile_number);
            setEditingMobile(true);
          }}
        />
      </SettingsSubsection>

      <EditFieldDialog
        open={editingMobile}
        onOpenChange={setEditingMobile}
        title="Edit mobile number"
        canSubmit={mobileValid}
        onSubmit={async () => {
          if (!mobileValid) {
            return {
              success: false,
              error: "Enter a valid Australian mobile number.",
            };
          }
          const r = await updateParentAccountSettings({
            mobile_number: normaliseAuMobile(mobile),
          });
          if (r.success) {
            router.refresh();
            return { success: true };
          }
          return { success: false, error: r.error };
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-mobile">Mobile number</Label>
          <Input
            id="edit-mobile"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="04XX XXX XXX"
            autoFocus
            inputMode="tel"
          />
          {trimmed.length > 0 && !mobileValid && (
            <p className="text-xs text-rose-600">
              That doesn&apos;t look like an Australian mobile number. Format:
              04XX XXX XXX.
            </p>
          )}
          {mobileValid && (
            <p className="text-xs text-emerald-600">{formatAuMobile(mobile)}</p>
          )}
          <p className="text-[11px] text-slate-400">
            We require a valid Australian mobile so we can reach you about
            account-critical updates.
          </p>
        </div>
      </EditFieldDialog>
    </div>
  );
}

// ── Security (password change via email confirmation) ────────

function SecuritySection() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const r = await requestPasswordChange();
      if (!r.success) {
        setError(r.error ?? "Couldn't send the password reset email.");
        return;
      }
      setSent(true);
    });
  }

  return (
    <SettingsSubsection header="Password">
      {sent ? (
        <div className="px-4 py-5 text-sm">
          <p className="font-medium text-emerald-700">
            Password reset email sent
          </p>
          <p className="mt-1 text-slate-600">
            Check your inbox for a link to set a new password. The link expires
            after one hour.
          </p>
        </div>
      ) : (
        <div className="px-4 py-5 text-sm">
          {error && (
            <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}
          <p className="text-slate-600">
            Send a password reset link to your registered email.
          </p>
          <Button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="mt-4 bg-violet-600 text-white hover:bg-violet-700"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send password reset email"
            )}
          </Button>
        </div>
      )}
    </SettingsSubsection>
  );
}

// ── Linked children ───────────────────────────────────────────

function ChildrenSection({ items }: { items: ChildClient[] }) {
  if (items.length === 0) {
    return (
      <SettingsSubsection header="Linked children">
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          No linked children yet.
        </div>
      </SettingsSubsection>
    );
  }
  return (
    <SettingsSubsection header="Linked children">
      <div className="px-4 py-4">
        <ChildManagementCard items={items} role="parent" />
      </div>
    </SettingsSubsection>
  );
}

// ── Subscription (link-only leaf) ────────────────────────────
//
// Per Option A in `04-codebase-reality.md`: the canonical
// subscription-state surface lives at /parent/subscription. This
// leaf navigates there rather than embedding the state-aware UI,
// to avoid duplicating logic + keep one source of truth for
// management actions.

function SubscriptionLinkSection() {
  const router = useRouter();
  return (
    <SettingsSubsection header="Subscription">
      <div className="px-4 py-4">
        <p className="text-sm text-slate-600">
          Manage your Baby Bloom subscription — view current plan, update
          payment method, cancel, or resubscribe.
        </p>
        <Button
          size="lg"
          className="mt-4 bg-violet-600 hover:bg-violet-700"
          onClick={() => router.push("/parent/subscription")}
        >
          Open subscription
        </Button>
      </div>
    </SettingsSubsection>
  );
}

// ── Close account (danger leaf) ──────────────────────────────

function CloseAccountSection({ fullName }: { fullName: string }) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameMatches = confirmName.toLowerCase() === fullName.toLowerCase();

  const handleDeactivate = () => {
    setError(null);
    startTransition(async () => {
      const r = await deactivateParentAccount();
      if (r.success) {
        router.push("/login");
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-rose-200 bg-rose-50/40 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
            aria-hidden="true"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-rose-900">
              Closing your account is permanent
            </p>
            <p className="mt-1 text-sm text-rose-700">
              This closes any active positions, cancels pending connections, and
              signs you out of every device. You will need to contact support to
              reactivate your account.
            </p>
            <Button
              variant="outline"
              onClick={() => setShowModal(true)}
              className="mt-4 border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            >
              Close my account
            </Button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-500" />
                <h3 className="text-lg font-semibold text-slate-900">
                  Close your account
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowModal(false);
                  setConfirmName("");
                  setError(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <p className="mb-4 text-sm text-slate-600">
              This is permanent. You&apos;ll lose access immediately and need to
              contact support to reactivate.
            </p>
            <div className="mb-2">
              <p className="mb-1 text-xs text-slate-500">
                Type{" "}
                <span className="font-semibold text-slate-700">{fullName}</span>{" "}
                to confirm
              </p>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder="Your full name"
                autoFocus
              />
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowModal(false);
                  setConfirmName("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-rose-600 text-white hover:bg-rose-700"
                disabled={!nameMatches || isPending}
                onClick={handleDeactivate}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Closing…
                  </>
                ) : (
                  "Confirm & close"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
