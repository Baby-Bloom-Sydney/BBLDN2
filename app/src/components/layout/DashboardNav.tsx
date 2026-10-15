"use client";

import Link from "next/link";
import { Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { displayName, displayFullName } from "@/lib/auth/display-name";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trackEvent } from "@/lib/analytics/trackEvent";
import { NannyEarningsBadge } from "./NannyEarningsBadge";
import { payoutsEnabled } from "@/lib/payments/flags";

interface DashboardNavProps {
  role: "nanny" | "parent";
}

export function DashboardNav({ role }: DashboardNavProps) {
  const { user, profile, role: authRole, signOut } = useAuth();

  const fullName = displayFullName(profile, user);
  const firstName = displayName(profile, user);

  // No border-b on <header> below: the violet horizontal divider on
  // the tab strip (KatieShell → KatieTabs) is the only line between
  // the chrome zone and the deck body. Header + tab strip read as
  // one continuous chrome zone.
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-white px-4 lg:px-6">
      {/* Left: Logo → hub. A-07 fix: Baby lucide icon dropped per
          user feedback — wordmark alone carries the brand. */}
      <Link
        href={`/${role}`}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        onClick={() =>
          trackEvent({ event_name: "logo_clicked", user_role: role })
        }
      >
        <span className="text-xl font-bold">
          <span className="text-slate-900">Baby</span>
          <span className="text-violet-500">Bloom</span>
        </span>
      </Link>

      {/* Right: Avatar dropdown.
          A-07: the KatieSwapButton was removed when the new top-tab
          strip (KatieShell → KatieTabs) became the swap control.
          A-07 fix: the Bell notifications button is commented out
          per user feedback — the inbox surface is no longer the
          primary notification channel. Restored as easily as
          re-uncommenting if/when notifications come back. */}
      <div className="flex items-center gap-2">
        {/*
        <Button variant="ghost" size="icon" className="relative" asChild>
          <Link
            href={`/${role}/inbox`}
            onClick={() =>
              trackEvent({
                event_name: "notifications_bell_clicked",
                user_role: role,
              })
            }
          >
            <Bell className="h-5 w-5" />
            <span className="sr-only">Notifications</span>
          </Link>
        </Button>
        */}

        {/* DSS §8 Q2 — nanny earnings wallet, only on nanny-side routes.
            Renders inline with the avatar; hides until data lands AND
            the nanny has at least one connected child. Click routes to
            /nanny/payouts where the breakdown lives. */}
        {/* 4a-i (P-23): hidden unless PAYOUTS_ENABLED. */}
        {role === "nanny" && payoutsEnabled() && <NannyEarningsBadge />}

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <UserAvatar
                name={fullName || firstName}
                imageUrl={profile?.profile_picture_url || undefined}
                className="h-8 w-8"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {fullName || firstName}
                </p>
                <p className="text-xs leading-none text-muted-foreground capitalize">
                  {authRole}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link
                href={`/${role}/settings`}
                onClick={() =>
                  trackEvent({
                    event_name: "settings_clicked",
                    user_role: role,
                  })
                }
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                trackEvent({ event_name: "sign_out_clicked", user_role: role });
                signOut();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
