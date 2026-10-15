"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { displayName, displayFullName } from "@/lib/auth/display-name";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  Home,
  User,
  ShieldCheck,
  Briefcase,
  Settings,
  Search,
  ClipboardList,
  Baby,
  Filter,
  Users,
  BarChart3,
  LogOut,
  PlusCircle,
  LucideIcon,
  HelpCircle,
  Eye,
  Inbox,
  Link2,
  Share2,
  CreditCard,
  Wallet,
  LifeBuoy,
  Phone,
  BadgeCheck,
} from "lucide-react";
import { payoutsEnabled } from "@/lib/payments/flags";

type UserRole = "nanny" | "parent" | "admin" | "super_admin" | "guest";

interface MobileNavProps {
  role: UserRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const nannyNavItems: NavItem[] = [
  { href: "/nanny", icon: Home, label: "Dashboard" },
  { href: "/nanny/profile", icon: User, label: "My Profile" },
  { href: "/nanny/team", icon: Users, label: "Our Team" },
  { href: "/nanny/verification", icon: ShieldCheck, label: "Verification" },
  { href: "/nanny/share", icon: Share2, label: "Share Profile" },
  { href: "/nanny/inbox", icon: Inbox, label: "Inbox" },
  { href: "/nanny/babysitting", icon: Briefcase, label: "Babysitting Jobs" },
  { href: "/nanny/apply", icon: PlusCircle, label: "Apply" },
  { href: "/nanny/settings", icon: Settings, label: "Settings" },
];

const parentNavItems: NavItem[] = [
  { href: "/parent", icon: Home, label: "Dashboard" },
  { href: "/parent/browse", icon: Search, label: "Browse Nannies" },
  { href: "/parent", icon: ClipboardList, label: "My Childcare" },
  { href: "/parent/matches", icon: Filter, label: "My Matches" },
  { href: "/parent/request", icon: PlusCircle, label: "Nanny Request" },
  { href: "/parent/connections", icon: Link2, label: "Connections" },
  { href: "/parent/inbox", icon: Inbox, label: "Inbox" },
  { href: "/parent/babysitting", icon: Baby, label: "Babysitting" },
  { href: "/parent/settings", icon: Settings, label: "Settings" },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/dashboard", icon: Home, label: "Dashboard" },
  { href: "/admin/pipeline", icon: Filter, label: "User Pipeline" },
  { href: "/admin/leads", icon: Phone, label: "Contacts" },
  { href: "/admin/verifications", icon: ShieldCheck, label: "Verifications" },
  { href: "/admin/users", icon: Users, label: "User Management" },
  { href: "/admin/subscriptions", icon: CreditCard, label: "Subscriptions" },
  { href: "/admin/guarantees", icon: BadgeCheck, label: "Guarantees" },
  { href: "/admin/payouts", icon: Wallet, label: "Payouts" },
  { href: "/admin/support", icon: LifeBuoy, label: "Support" },
  { href: "/admin/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

const publicNavItems: NavItem[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/nannies", icon: Search, label: "Browse Nannies" },
  { href: "/about", icon: HelpCircle, label: "About" },
  { href: "/how-it-works", icon: Eye, label: "How It Works" },
];

const navItemsByRole: Record<UserRole, NavItem[]> = {
  nanny: nannyNavItems,
  parent: parentNavItems,
  admin: adminNavItems,
  super_admin: adminNavItems,
  guest: publicNavItems,
};

export function MobileNav({
  role: propRole,
  open,
  onOpenChange,
}: MobileNavProps) {
  const pathname = usePathname();
  const { user, role: authRole, profile, signOut } = useAuth();

  // Use auth role if user is logged in, otherwise fall back to prop
  const role: UserRole = user && authRole ? (authRole as UserRole) : propRole;
  const isGuest = role === "guest";
  // 4a-i (P-23): the admin Payouts entry is hidden unless PAYOUTS_ENABLED.
  const navItems = (navItemsByRole[role] || publicNavItems).filter(
    (item) => payoutsEnabled() || item.href !== "/admin/payouts",
  );

  const fullName = displayFullName(profile, user);
  const firstName = displayName(profile, user);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="text-left">
            <Link
              href="/"
              className="flex items-center gap-0.5 text-xl font-bold"
            >
              <span className="text-slate-900">Baby</span>
              <span className="text-violet-500">Bloom</span>
            </Link>
          </SheetTitle>
        </SheetHeader>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-violet-500 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: auth buttons for guests, user info for logged-in */}
        {isGuest && (
          <div className="border-t p-4 flex flex-col gap-2">
            <Button
              variant="outline"
              asChild
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              <Link href="/login">Log in</Link>
            </Button>
            <Button
              asChild
              className="w-full bg-violet-500 hover:bg-violet-600"
              onClick={() => onOpenChange(false)}
            >
              <Link href="/signup">Sign Up</Link>
            </Button>
          </div>
        )}
        {!isGuest && (
          <div className="border-t p-4">
            <div className="flex items-center gap-3">
              <UserAvatar
                name={fullName || firstName}
                imageUrl={profile?.profile_picture_url || undefined}
              />
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-slate-900">
                  {firstName}
                </p>
                <p className="truncate text-xs text-slate-500 capitalize">
                  {role}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                className="h-8 w-8 text-slate-400 hover:text-slate-600"
              >
                <LogOut className="h-4 w-4" />
                <span className="sr-only">Sign out</span>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
