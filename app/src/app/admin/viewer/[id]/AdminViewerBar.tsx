"use client";

/**
 * Admin "view as user" bar. Unit 3d: the level badge reads 3a's LEVEL_LABELS instead of a local copy
 * (brief change 14). Never: shows verification to a parent (3h).
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { ChevronUp, ChevronDown, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_LABELS } from "@/lib/verification";

interface TargetUser {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  profilePictureUrl: string | null;
  role: "nanny" | "parent";
  verificationLevel: number;
}

// 3d: the level labels are 3a's (`lib/verification.ts`), not a local copy.

export function AdminViewerBar({ user }: { user: TargetUser }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const base = `/admin/viewer/${user.userId}`;

  // Verification exists for nannies only (LDN2 3h: parents are never verified).
  const isNanny = user.role === "nanny";
  const tabs = [
    { label: "Hub", href: base },
    ...(isNanny
      ? [{ label: "Verification", href: `${base}/verification` }]
      : []),
    { label: "Profile", href: `${base}/profile` },
    { label: "Inbox", href: `${base}/inbox` },
  ];

  const name = `${user.firstName} ${user.lastName}`.trim() || "Unknown";

  if (collapsed) {
    return (
      <div
        className="sticky top-0 z-50 flex items-center justify-between bg-violet-600 px-4 py-1 text-white cursor-pointer"
        onClick={() => setCollapsed(false)}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{name}</span>
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs capitalize">{user.role}</span>
        </div>
        <ChevronDown className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-50 bg-violet-600 text-white shadow-md">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/users"
            className="flex items-center gap-1 text-sm text-violet-200 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Users
          </Link>
          <div className="h-5 w-px bg-violet-400" />
          <UserAvatar
            name={name}
            imageUrl={user.profilePictureUrl || undefined}
            className="h-8 w-8 border-2 border-white/30"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">{name}</span>
              <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs capitalize">{user.role}</span>
              {isNanny && (
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-xs">
                  {LEVEL_LABELS[user.verificationLevel] ??
                    `L${user.verificationLevel}`}
                </span>
              )}
            </div>
            <p className="text-xs text-violet-200 truncate">
              {user.email}
              <span className="ml-2 font-mono opacity-70">{user.userId}</span>
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 px-4 pb-1">
        {tabs.map((tab) => {
          const isActive =
            tab.href === base
              ? pathname === base
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-t px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white text-violet-700"
                  : "text-violet-200 hover:bg-white/10 hover:text-white"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
