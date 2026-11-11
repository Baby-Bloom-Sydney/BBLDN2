"use client";

/**
 * Parent settings — tree-driven multi-level drill-down.
 *
 * Top-level tree (2026-05-07):
 *
 *   Profile           — leaf (legal name, DOB, address; edit mode)
 *   Account           — branch
 *     ▸ Contact details (edit mode)
 *     ▸ Security
 *     (small "Close account" link at the bottom)
 *   Linked children   — leaf
 *   Contact Us        — leaf
 *
 * Notes:
 *   - "Communication preferences" is intentionally NOT shipped in
 *     v1 — the placeholder caused confusion. Add it back here when
 *     the email/SMS pref surface is built.
 *   - Profile and Contact details have edit mode: one Edit for the
 *     page, fields in place, one Save with the version she loaded
 *     (`ParentProfileSection`, `ParentContactDetailsSection`, built
 *     from the shared edit-mode parts; each draws its own title row,
 *     so their nodes are `ownHeader`). The address changes only by a
 *     pick from the inline search (town and postcode only), and the
 *     mobile is required and a UK mobile (`parent-profile-rules`).
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
import { deactivateParentAccount } from "@/lib/actions/parent";
import { requestPasswordChange } from "@/lib/actions/account-security";
import { ChildManagementCard } from "@/components/bapp/ChildManagementCard";
import type { ChildClient } from "@/types/bapp";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { IdentityCard } from "@/components/settings/IdentityCard";
import { SettingsSubsection } from "@/components/settings/SettingsSubsection";
import { ContactSection } from "@/components/settings/ContactSection";
import type { SettingsNode } from "@/components/settings/tree";
import { ParentProfileSection } from "./ParentProfileSection";
import { ParentContactDetailsSection } from "./ParentContactDetailsSection";

interface Props {
  profile: {
    first_name: string;
    last_name: string;
    email: string;
    mobile_number: string;
    date_of_birth: string;
    suburb: string;
    postcode: string;
    /** The profile row's version she loaded (null = none yet): her Profile and Contact details Save sends it. */
    updated_at: string | null;
  };
  managedChildren?: ChildClient[];
}

function buildTree(childCount: number): SettingsNode[] {
  return [
    { id: "profile", label: "Profile", icon: User, ownHeader: true },
    {
      id: "account",
      label: "Account",
      icon: Settings,
      children: [
        { id: "contact", label: "Contact details", ownHeader: true },
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
            return <ParentProfileSection title={node.label} profile={profile} />;
          case "contact":
            return <ParentContactDetailsSection title={node.label} contact={profile} />;
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
