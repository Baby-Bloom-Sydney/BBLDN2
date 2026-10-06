"use client";

import { useAuth } from "@/contexts/AuthContext";
import { displayName, displayFullName } from "@/lib/auth/display-name";
import { SidebarItem } from "./SidebarItem";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { Button } from "@/components/ui/button";
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
  LogIn,
  UserPlus,
  BookOpen,
  PlusCircle,
  HelpCircle,
  Eye,
  Inbox,
  Link2,
  Award,
  Share2,
  CreditCard,
  Wallet,
  LifeBuoy,
  Phone,
} from "lucide-react";
import Link from "next/link";

type UserRole = "nanny" | "parent" | "admin" | "super_admin" | "guest";

interface SidebarProps {
  role: UserRole;
  collapsed?: boolean;
  onToggle?: () => void;
}

const nannyNavItems = [
  { href: "/nanny", icon: Home, label: "Dashboard" },
  { href: "/nanny/profile", icon: User, label: "My Profile" },
  { href: "/nanny/team", icon: Users, label: "Our Team" },
  { href: "/nanny/verification", icon: ShieldCheck, label: "Verification" },
  { href: "/nanny/share", icon: Share2, label: "Share Profile" },
  { href: "/nanny/inbox", icon: Inbox, label: "Inbox" },
  { href: "/nanny/positions", icon: Award, label: "My Positions" },
  { href: "/nanny/babysitting", icon: Briefcase, label: "Babysitting Jobs" },
  { href: "/nanny/apply", icon: PlusCircle, label: "Apply" },
  { href: "/nanny/settings", icon: Settings, label: "Settings" },
];

const parentNavItems = [
  { href: "/parent", icon: Home, label: "Dashboard" },
  { href: "/parent/browse", icon: Search, label: "Browse Nannies" },
  { href: "/parent", icon: ClipboardList, label: "My Childcare" },
  { href: "/parent/matches", icon: Filter, label: "My Matches" },
  { href: "/parent/request", icon: PlusCircle, label: "Nanny Request" },
  { href: "/parent", icon: Link2, label: "Connections" },
  { href: "/parent/inbox", icon: Inbox, label: "Inbox" },
  { href: "/parent/babysitting", icon: Baby, label: "Babysitting" },
  { href: "/parent/settings", icon: Settings, label: "Settings" },
];

const adminNavItems = [
  { href: "/admin/dashboard", icon: Home, label: "Dashboard" },
  { href: "/admin/pipeline", icon: Filter, label: "User Pipeline" },
  { href: "/admin/leads", icon: Phone, label: "Contacts" },
  { href: "/admin/positions", icon: Briefcase, label: "Positions" },
  { href: "/admin/users", icon: Users, label: "User Management" },
  { href: "/admin/subscriptions", icon: CreditCard, label: "Subscriptions" },
  { href: "/admin/payouts", icon: Wallet, label: "Payouts" },
  { href: "/admin/support", icon: LifeBuoy, label: "Support" },
  {
    href: "/admin/verification-reference",
    icon: BookOpen,
    label: "Verification Ref",
  },
  { href: "/admin/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

const publicNavItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/nannies", icon: Search, label: "Browse Nannies" },
  { href: "/about", icon: HelpCircle, label: "About" },
  { href: "/how-it-works", icon: Eye, label: "How It Works" },
];

const navItemsByRole: Record<UserRole, typeof nannyNavItems> = {
  nanny: nannyNavItems,
  parent: parentNavItems,
  admin: adminNavItems,
  super_admin: adminNavItems,
  guest: publicNavItems,
};

export function Sidebar({ role: propRole, collapsed, onToggle }: SidebarProps) {
  const { user, role: authRole, profile, signOut } = useAuth();

  // Use auth role if user is logged in, otherwise fall back to prop
  const role: UserRole = user && authRole ? (authRole as UserRole) : propRole;
  const isGuest = role === "guest";
  const navItems = navItemsByRole[role] || publicNavItems;

  const fullName = displayFullName(profile, user);
  const firstName = displayName(profile, user);

  return (
    <aside
      className={`flex h-full flex-col border-r bg-white transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}
    >
      {/* Logo — click to toggle collapse */}
      <button
        onClick={onToggle}
        className="flex h-16 items-center border-b px-4 hover:bg-slate-50 transition-colors cursor-pointer w-full"
      >
        {collapsed ? (
          <div className="flex w-full items-center justify-center">
            <Baby className="h-7 w-7 text-violet-500" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Baby className="h-7 w-7 text-violet-500 flex-shrink-0" />
            <span className="text-xl font-bold">
              <span className="text-slate-900">Baby</span>
              <span className="text-violet-500">Bloom</span>
            </span>
          </div>
        )}
      </button>

      {/* Navigation */}
      <nav className={`flex-1 space-y-1 py-4 ${collapsed ? "px-2" : "px-3"}`}>
        {navItems.map((item) => (
          <SidebarItem
            key={item.href + item.label}
            href={item.href}
            icon={item.icon}
            label={item.label}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Bottom Section — auth buttons for guests, user info for logged-in */}
      {isGuest && (
        <div className="border-t p-4">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link href="/login">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-500 hover:text-violet-600"
                >
                  <LogIn className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/signup">
                <Button
                  size="icon"
                  className="h-8 w-8 bg-violet-500 hover:bg-violet-600"
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button variant="outline" asChild className="w-full">
                <Link href="/login">Log in</Link>
              </Button>
              <Button
                asChild
                className="w-full bg-violet-500 hover:bg-violet-600"
              >
                <Link href="/signup">Sign Up</Link>
              </Button>
            </div>
          )}
        </div>
      )}
      {!isGuest && (
        <div className="border-t p-4">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <UserAvatar
                name={fullName || firstName}
                imageUrl={profile?.profile_picture_url || undefined}
                className="h-8 w-8"
              />
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
          ) : (
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
          )}
        </div>
      )}
    </aside>
  );
}
