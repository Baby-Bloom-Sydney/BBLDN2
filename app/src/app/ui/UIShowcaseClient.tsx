"use client";

import { useState, useEffect, Suspense } from "react";
import type { NannyCardData } from "@/components/NannyCard";
import type { MockParentData } from "./mock-data";
import {
  MOCK_POSITION,
  MOCK_NANNY_SCHEDULE,
  MOCK_VERIFICATION_STEPS_PARTIAL,
  MOCK_VERIFICATION_STEPS_COMPLETE,
  MOCK_FUNNEL_STEPS,
  MOCK_UPCOMING_INTRO,
  MOCK_PROPOSED_TIMES,
  MOCK_MATCH_RESULT,
  MOCK_DFY_STATUS,
  MOCK_CONNECTION_MATCH_DATA,
} from "./mock-data";
import {
  MOCK_INTERVIEW_REQUESTS,
  MOCK_NANNY_BABYSITTING_JOBS,
  MOCK_INBOX_MESSAGES,
  MOCK_CONNECTION_REQUESTS,
  MOCK_VERIFICATION_DATA,
  MOCK_NANNY_SHARE_DATA,
  MOCK_NANNY_PLACEMENTS,
  MOCK_NANNY_UPCOMING_INTROS,
  MOCK_POSITION_WITH_CHILDREN,
  MOCK_POSITION_SHARE_DATA,
  MOCK_PARENT_BSR_REQUESTS,
  MOCK_DISTRICTS,
  MOCK_BSR_PROFILE,
  MOCK_BSR_SHARE_DATA,
  MOCK_PARENT_VERIFICATION_DATA,
  MOCK_ADMIN_USERS,
  MOCK_ADMIN_USER_STATS,
  MOCK_ADMIN_VERIFICATION_STATS,
  MOCK_ADMIN_IDENTITY_CHECKS,
  MOCK_ADMIN_WWCC_CHECKS,
  MOCK_ADMIN_PARENT_VERIFICATION_STATS,
  MOCK_ADMIN_PARENT_CHECKS,
} from "./page-client-mocks";
import { ShowcaseErrorBoundary } from "./ErrorBoundary";

// ── UI Primitives ──
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FunnelProgress } from "@/components/ui/funnel-progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// ── Layout ──
import { Logo } from "@/components/layout/Logo";
import { NavLink } from "@/components/layout/NavLink";
import { Footer } from "@/components/layout/Footer";
import { SidebarItem } from "@/components/layout/SidebarItem";
import { DashboardHeader } from "@/components/layout/DashboardHeader";

// ── Dashboard ──
import { StatsCard } from "@/components/dashboard/StatsCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { UserAvatar } from "@/components/dashboard/UserAvatar";
import { StatusBadge } from "@/components/dashboard/StatusBadge";

// ── Position/Connection ──
import { ConnectionProgress } from "@/components/position/ConnectionProgress";
import { AvailabilityGrid } from "@/components/position/AvailabilityGrid";
import { ScheduleTimeGrid } from "@/components/position/ScheduleTimeGrid";
import { ConnectionDetailPopup } from "@/components/position/ConnectionDetailPopup";
import { PositionAccordion } from "@/components/position/PositionAccordion";

// ── Matching ──
import { MatchCard } from "@/components/MatchCard";
import {
  ScoreBar,
  getScoreBadgeStyle,
  AvailabilityTable,
} from "@/components/match/match-helpers";

// ── Verification ──
import { VerificationProgress } from "@/components/verification/VerificationProgress";

// ── Auth ──
import { LoginModal } from "@/components/auth/LoginModal";

// ── Feature Components ──
import {
  NannyCard,
  NannyCardSkeleton,
  EmptyNannyState,
} from "@/components/NannyCard";
import { InterviewRequestModal } from "@/components/InterviewRequestModal";
import { ConnectModal } from "@/components/ConnectModal";

// ── Page Clients ──

import { MatchResultsClient } from "@/app/parent/matches/MatchResultsClient";
import { NannyRegistrationFunnel } from "@/app/nanny/register/NannyRegistrationFunnel";
import { NannyInterviewsClient } from "@/app/nanny/interviews/NannyInterviewsClient";
import { NannyBabysittingClient } from "@/app/nanny/babysitting/NannyBabysittingClient";
import { NannyInboxClient } from "@/app/nanny/inbox/NannyInboxClient";
import { VerificationPageClient } from "@/app/nanny/verification/VerificationPageClient";
import { NannyShareClient } from "@/app/nanny/share/NannyShareClient";
import { NannyPositionsClient } from "@/app/nanny/positions/NannyPositionsClient";
import { ParentInterviewsClient } from "@/app/parent/interviews/ParentInterviewsClient";
import { ParentInboxClient } from "@/app/parent/inbox/ParentInboxClient";
import { PositionPageClient } from "@/app/parent/position/PositionPageClient";
import { PositionShareClient } from "@/app/parent/matches/share/PositionShareClient";
import { ParentBabysittingClient } from "@/app/parent/babysitting/ParentBabysittingClient";
import BsrPaymentClient from "@/app/parent/babysitting/[id]/payment/BsrPaymentClient";
import { BsrShareClient } from "@/app/parent/babysitting/[id]/share/BsrShareClient";
import { ParentConnectionsClient } from "@/app/parent/connections/ParentConnectionsClient";
import { ParentVerificationPageClient } from "@/app/parent/verification/ParentVerificationPageClient";
import { AdminUsersClient } from "@/app/admin/users/AdminUsersClient";

// ── Icons ──
import {
  Users,
  Briefcase,
  DollarSign,
  Star,
  Search,
  Home,
  User,
  Settings,
  ChevronDown,
  FileText,
} from "lucide-react";

// ── Types ──
import type { MatchResult } from "@/lib/matching/types";

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function RefBadge({ code }: { code: string }) {
  return (
    <span className="inline-block rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-white">
      {code}
    </span>
  );
}

function ShowcaseCard({
  code,
  name,
  children,
  className = "",
}: {
  code: string;
  name: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-6 ${className}`}
    >
      <div className="mb-4 flex items-center gap-2">
        <RefBadge code={code} />
        <h3 className="text-sm font-semibold text-slate-700">{name}</h3>
      </div>
      {children}
    </div>
  );
}

function SectionHeader({
  id,
  title,
  range,
  count,
}: {
  id: string;
  title: string;
  range: string;
  count: number;
}) {
  return (
    <div id={id} className="mb-6 scroll-mt-20">
      <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
      <p className="text-sm text-slate-500">
        {range} &middot; {count} component{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

const noop = () => {};
const noopAsync = async () => ({ success: true, error: null });

/** Defers rendering until after hydration to avoid "Server Functions cannot be called during initial render" */
function ClientOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback ?? <div className="p-4 text-sm text-slate-400">Loading...</div>}</>;
  return <>{children}</>;
}

function PageClientShowcase({
  code,
  name,
  slug,
  children,
}: {
  code: string;
  name: string;
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-12">
      <div className="mb-4 flex items-center gap-2">
        <RefBadge code={code} />
        <h3 className="text-sm font-semibold text-slate-700">{name}</h3>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_375px]">
        {/* Desktop — direct render */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Desktop</p>
          <div className="overflow-auto rounded-lg border border-slate-200 bg-white" style={{ maxHeight: 600 }}>
            <ShowcaseErrorBoundary name={`${name} (Desktop)`}>
              {children}
            </ShowcaseErrorBoundary>
          </div>
        </div>
        {/* Mobile — iframe at 375px for true responsive breakpoints */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Mobile (375px)</p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" style={{ width: 375, height: 600 }}>
            <iframe
              src={`/ui/embed/${slug}`}
              width={375}
              height={600}
              className="border-0"
              title={`${name} mobile preview`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════

interface UIShowcaseClientProps {
  nannyCard: NannyCardData;
  nannyCard2: NannyCardData;
  nannyCard3: NannyCardData;
  parentData: MockParentData;
  nannySchedule: Record<string, string[]>;
  nannyProfilePic: string | null;
}

export function UIShowcaseClient({
  nannyCard,
  nannyCard2,
  nannyCard3,
  parentData,
  nannySchedule,
  nannyProfilePic,
}: UIShowcaseClientProps) {
  // Interactive state for modals/sheets/dialogs
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [interviewModalOpen, setInterviewModalOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectionPopupOpen, setConnectionPopupOpen] = useState(false);

  const matchResult = MOCK_MATCH_RESULT as unknown as MatchResult;

  const SECTIONS = [
    { id: "primitives", title: "UI Primitives (shadcn)", range: "CMP-001 to CMP-017", count: 17 },
    { id: "layout", title: "Layout", range: "CMP-018 to CMP-026", count: 9 },
    { id: "dashboard", title: "Dashboard", range: "CMP-027 to CMP-030", count: 4 },
    { id: "position", title: "Position / Connection", range: "CMP-031 to CMP-035", count: 5 },
    { id: "matching", title: "Matching", range: "CMP-036 to CMP-037", count: 2 },
    { id: "verification", title: "Verification", range: "CMP-038", count: 1 },
    { id: "auth", title: "Auth", range: "CMP-039", count: 1 },
    { id: "providers", title: "Providers", range: "CMP-040", count: 1 },
    { id: "devtools", title: "Dev Tools", range: "CMP-041 to CMP-043", count: 3 },
    { id: "features", title: "Feature Components", range: "CMP-044 to CMP-048", count: 5 },
    { id: "pageclients", title: "Page Clients", range: "CMP-049 to CMP-069", count: 21 },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="border-b bg-white px-6 py-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold text-slate-900">
            Baby Bloom UI Component Showcase
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            69 components indexed (CMP-001 to CMP-069) &middot; Generated
            2026-03-11
          </p>
        </div>
      </div>

      {/* ── Sticky TOC ── */}
      <div className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur px-6 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700"
            >
              {s.title}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-16 px-6 py-10">
        {/* ════════════════════════════════════════════════════════════ */}
        {/* 1. UI PRIMITIVES — CMP-001 to CMP-017                     */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="primitives" title="UI Primitives (shadcn)" range="CMP-001 to CMP-017" count={17} />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* CMP-001 Tabs */}
            <ShowcaseCard code="CMP-001" name="Tabs">
              <Tabs defaultValue="tab1" className="w-full">
                <TabsList>
                  <TabsTrigger value="tab1">Overview</TabsTrigger>
                  <TabsTrigger value="tab2">Details</TabsTrigger>
                  <TabsTrigger value="tab3">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1" className="text-sm text-slate-600">Overview content goes here.</TabsContent>
                <TabsContent value="tab2" className="text-sm text-slate-600">Detail content goes here.</TabsContent>
                <TabsContent value="tab3" className="text-sm text-slate-600">Settings content goes here.</TabsContent>
              </Tabs>
            </ShowcaseCard>

            {/* CMP-002 Card */}
            <ShowcaseCard code="CMP-002" name="Card">
              <Card>
                <CardHeader>
                  <CardTitle>Card Title</CardTitle>
                  <CardDescription>Card description text</CardDescription>
                </CardHeader>
                <CardContent><p className="text-sm">Card body content.</p></CardContent>
                <CardFooter><Button size="sm">Action</Button></CardFooter>
              </Card>
            </ShowcaseCard>

            {/* CMP-003 Sheet */}
            <ShowcaseCard code="CMP-003" name="Sheet">
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline">Open Sheet</Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Sheet Title</SheetTitle>
                  </SheetHeader>
                  <p className="mt-4 text-sm text-slate-600">Sheet content goes here.</p>
                </SheetContent>
              </Sheet>
            </ShowcaseCard>

            {/* CMP-004 Label */}
            <ShowcaseCard code="CMP-004" name="Label">
              <div className="space-y-3">
                <Label>Default Label</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="demo-input">With Input</Label>
                  <Input id="demo-input" placeholder="Type..." className="max-w-[160px]" />
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-005 Avatar */}
            <ShowcaseCard code="CMP-005" name="Avatar">
              <div className="flex items-center gap-3">
                <Avatar>
                  {nannyProfilePic && <AvatarImage src={nannyProfilePic} alt="Profile" />}
                  <AvatarFallback>BW</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>SC</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>?</AvatarFallback>
                </Avatar>
              </div>
            </ShowcaseCard>

            {/* CMP-006 Badge */}
            <ShowcaseCard code="CMP-006" name="Badge">
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </ShowcaseCard>

            {/* CMP-007 Table */}
            <ShowcaseCard code="CMP-007" name="Table" className="md:col-span-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Suburb</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Experience</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[nannyCard, nannyCard2, nannyCard3].map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="font-medium">{n.first_name} {n.last_name}</TableCell>
                      <TableCell>{n.suburb}</TableCell>
                      <TableCell>${n.hourly_rate_min}/hr</TableCell>
                      <TableCell>{n.nanny_experience_years} yrs</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ShowcaseCard>

            {/* CMP-008 Separator */}
            <ShowcaseCard code="CMP-008" name="Separator">
              <div className="space-y-4">
                <p className="text-sm text-slate-600">Above separator</p>
                <Separator />
                <p className="text-sm text-slate-600">Below separator</p>
                <div className="flex h-8 items-center gap-4">
                  <span className="text-sm">Left</span>
                  <Separator orientation="vertical" />
                  <span className="text-sm">Right</span>
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-009 Button */}
            <ShowcaseCard code="CMP-009" name="Button" className="md:col-span-2 lg:col-span-3">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="default">Default</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="link">Link</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon"><Star className="h-4 w-4" /></Button>
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-010 DropdownMenu */}
            <ShowcaseCard code="CMP-010" name="DropdownMenu">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    Options <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Settings</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Sign Out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ShowcaseCard>

            {/* CMP-011 Input */}
            <ShowcaseCard code="CMP-011" name="Input">
              <div className="space-y-3">
                <Input placeholder="Default input" />
                <Input placeholder="Disabled input" disabled />
              </div>
            </ShowcaseCard>

            {/* CMP-012 Skeleton */}
            <ShowcaseCard code="CMP-012" name="Skeleton">
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-013 Form */}
            <ShowcaseCard code="CMP-013" name="Form">
              <p className="text-xs text-slate-500 mb-2">
                Form component (react-hook-form + zod wrapper). Used in auth pages, nanny registration, position creation.
              </p>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="demo-name">Name</Label>
                  <Input id="demo-name" placeholder="Jane Doe" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="demo-email">Email</Label>
                  <Input id="demo-email" type="email" placeholder="jane@example.com" className="mt-1" />
                </div>
                <Button size="sm">Submit</Button>
              </div>
            </ShowcaseCard>

            {/* CMP-014 Dialog */}
            <ShowcaseCard code="CMP-014" name="Dialog">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Dialog Title</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-slate-600">Dialog content goes here.</p>
                </DialogContent>
              </Dialog>
            </ShowcaseCard>

            {/* CMP-015 Textarea */}
            <ShowcaseCard code="CMP-015" name="Textarea">
              <Textarea placeholder="Type your message here..." />
            </ShowcaseCard>

            {/* CMP-016 FunnelProgress */}
            <ShowcaseCard code="CMP-016" name="FunnelProgress" className="md:col-span-2 lg:col-span-3">
              <FunnelProgress currentStep={3} steps={MOCK_FUNNEL_STEPS} />
            </ShowcaseCard>

            {/* CMP-017 Accordion */}
            <ShowcaseCard code="CMP-017" name="Accordion">
              <Accordion type="single" collapsible>
                <AccordionItem value="item-1">
                  <AccordionTrigger>What is Baby Bloom?</AccordionTrigger>
                  <AccordionContent>Baby Bloom is a nanny matching platform for Sydney families.</AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>How does matching work?</AccordionTrigger>
                  <AccordionContent>Our algorithm scores nannies based on location, schedule, experience, and qualifications.</AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>Is it free?</AccordionTrigger>
                  <AccordionContent>Browsing and matching are free. Premium features are available for subscribers.</AccordionContent>
                </AccordionItem>
              </Accordion>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 2. LAYOUT — CMP-018 to CMP-026                            */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="layout" title="Layout" range="CMP-018 to CMP-026" count={9} />
          <div className="grid gap-6">
            {/* CMP-018 Logo */}
            <ShowcaseCard code="CMP-018" name="Logo">
              <Logo />
            </ShowcaseCard>

            {/* CMP-019 NavLink */}
            <ShowcaseCard code="CMP-019" name="NavLink">
              <div className="flex gap-4">
                <NavLink href="/ui">Active Link (current)</NavLink>
                <NavLink href="/nannies">Browse Nannies</NavLink>
                <NavLink href="/about">About</NavLink>
              </div>
            </ShowcaseCard>

            {/* CMP-020 Navbar — skipped inline (legacy, uses scroll detection + Sheet) */}
            <ShowcaseCard code="CMP-020" name="Navbar">
              <p className="text-sm text-slate-500">
                Legacy public navigation bar component. Uses scroll detection and mobile Sheet menu.
                Superseded by PublicHeader + Sidebar in current layout.
              </p>
            </ShowcaseCard>

            {/* CMP-021 Footer */}
            <ShowcaseCard code="CMP-021" name="Footer">
              <div className="relative w-full overflow-hidden rounded-lg border">
                <Footer />
              </div>
            </ShowcaseCard>

            {/* CMP-022 SidebarItem */}
            <ShowcaseCard code="CMP-022" name="SidebarItem">
              <div className="flex gap-6">
                <div className="w-[220px] space-y-1">
                  <p className="mb-2 text-xs text-slate-500">Expanded</p>
                  <SidebarItem href="/ui" icon={Home} label="Dashboard" />
                  <SidebarItem href="/nannies" icon={Users} label="Browse Nannies" />
                  <SidebarItem href="/settings" icon={Settings} label="Settings" />
                </div>
                <div className="w-[60px] space-y-1">
                  <p className="mb-2 text-xs text-slate-500">Collapsed</p>
                  <SidebarItem href="/ui" icon={Home} label="Dashboard" collapsed />
                  <SidebarItem href="/nannies" icon={Users} label="Browse" collapsed />
                  <SidebarItem href="/settings" icon={Settings} label="Settings" collapsed />
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-023 DashboardHeader */}
            <ShowcaseCard code="CMP-023" name="DashboardHeader">
              <div className="relative overflow-hidden rounded-lg border">
                <DashboardHeader title="Dashboard" onMenuClick={noop} />
              </div>
            </ShowcaseCard>

            {/* CMP-024 PublicHeader — depends on useAuth, render note */}
            <ShowcaseCard code="CMP-024" name="PublicHeader">
              <p className="text-sm text-slate-500">
                Top bar for public pages. Shows role-switcher dropdown for authenticated users,
                sign-in/sign-up buttons for guests. Rendered by (public) layout group.
                Requires useAuth() context from SessionProvider.
              </p>
            </ShowcaseCard>

            {/* CMP-025 Sidebar — depends on useAuth for role detection */}
            <ShowcaseCard code="CMP-025" name="Sidebar">
              <p className="text-sm text-slate-500">
                Role-based navigation sidebar (nanny/parent/admin/guest). Uses useAuth() for role detection.
                Collapsed state persists to localStorage. Rendered by dashboard layouts.
              </p>
            </ShowcaseCard>

            {/* CMP-026 MobileNav */}
            <ShowcaseCard code="CMP-026" name="MobileNav">
              <p className="text-sm text-slate-500">
                Mobile navigation overlay using Sheet component. Shows role-specific nav items.
                Triggered by hamburger menu in DashboardHeader on mobile viewports.
              </p>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 3. DASHBOARD — CMP-027 to CMP-030                         */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="dashboard" title="Dashboard" range="CMP-027 to CMP-030" count={4} />
          <div className="grid gap-6 md:grid-cols-2">
            {/* CMP-027 StatsCard */}
            <ShowcaseCard code="CMP-027" name="StatsCard" className="md:col-span-2">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatsCard icon={Users} value={42} label="Active Nannies" trend={{ value: 12, isPositive: true }} iconColor="text-green-500" iconBgColor="bg-green-100" />
                <StatsCard icon={Briefcase} value={18} label="Open Positions" trend={{ value: 5, isPositive: true }} iconColor="text-blue-500" iconBgColor="bg-blue-100" />
                <StatsCard icon={DollarSign} value="$38" label="Avg Rate" iconColor="text-violet-500" iconBgColor="bg-violet-100" />
                <StatsCard icon={Star} value={96} label="Match Score" trend={{ value: 3, isPositive: false }} iconColor="text-amber-500" iconBgColor="bg-amber-100" />
              </div>
            </ShowcaseCard>

            {/* CMP-028 EmptyState */}
            <ShowcaseCard code="CMP-028" name="EmptyState">
              <EmptyState icon={Search} title="No results found" description="Try adjusting your search filters." actionLabel="Clear Filters" onAction={noop} />
            </ShowcaseCard>

            {/* CMP-029 UserAvatar */}
            <ShowcaseCard code="CMP-029" name="UserAvatar">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <UserAvatar name={`${nannyCard.first_name} ${nannyCard.last_name}`} imageUrl={nannyProfilePic ?? undefined} />
                  <p className="mt-1 text-xs text-slate-500">With image</p>
                </div>
                <div className="text-center">
                  <UserAvatar name={`${parentData.first_name} ${parentData.last_name}`} />
                  <p className="mt-1 text-xs text-slate-500">Initials</p>
                </div>
                <div className="text-center">
                  <UserAvatar name="?" />
                  <p className="mt-1 text-xs text-slate-500">Unknown</p>
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-030 StatusBadge */}
            <ShowcaseCard code="CMP-030" name="StatusBadge" className="md:col-span-2">
              <div className="flex flex-wrap gap-2">
                <StatusBadge variant="pending">Pending</StatusBadge>
                <StatusBadge variant="active">Active</StatusBadge>
                <StatusBadge variant="verified">Verified</StatusBadge>
                <StatusBadge variant="inactive">Inactive</StatusBadge>
                <StatusBadge variant="failed">Failed</StatusBadge>
                <StatusBadge variant="unattempted">Unattempted</StatusBadge>
              </div>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 4. POSITION / CONNECTION — CMP-031 to CMP-035             */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="position" title="Position / Connection" range="CMP-031 to CMP-035" count={5} />
          <div className="grid gap-6">
            {/* CMP-031 ConnectionProgress */}
            <ShowcaseCard code="CMP-031" name="ConnectionProgress">
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-xs text-slate-500">Stage: Accepted (Parent view)</p>
                  <ConnectionProgress currentStage={10} role="parent" />
                </div>
                <div>
                  <p className="mb-2 text-xs text-slate-500">Stage: Meet Scheduled (Nanny view)</p>
                  <ConnectionProgress currentStage={20} role="nanny" />
                </div>
                <div>
                  <p className="mb-2 text-xs text-slate-500">Stage: Confirmed (Parent view)</p>
                  <ConnectionProgress currentStage={34} role="parent" />
                </div>
              </div>
            </ShowcaseCard>

            {/* CMP-032 AvailabilityGrid */}
            <ShowcaseCard code="CMP-032" name="AvailabilityGrid">
              <AvailabilityGrid onConfirm={noop} onBack={noop} submitting={false} />
            </ShowcaseCard>

            {/* CMP-033 ScheduleTimeGrid */}
            <ShowcaseCard code="CMP-033" name="ScheduleTimeGrid">
              <ScheduleTimeGrid
                proposedTimes={MOCK_PROPOSED_TIMES}
                otherPartyName={nannyCard.first_name}
                onConfirm={noop}
                onBack={noop}
                submitting={false}
              />
            </ShowcaseCard>

            {/* CMP-034 ConnectionDetailPopup */}
            <ShowcaseCard code="CMP-034" name="ConnectionDetailPopup">
              <Button variant="outline" onClick={() => setConnectionPopupOpen(true)}>
                Open Connection Detail
              </Button>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <ConnectionDetailPopup
                intro={MOCK_UPCOMING_INTRO as any}
                open={connectionPopupOpen}
                onOpenChange={setConnectionPopupOpen}
                role="parent"
                onIntroOutcome={noopAsync}
                onTrialOutcome={noopAsync}
                onConfirmPosition={noopAsync}
                onConfirmPlacement={noopAsync}
                onParentOutcome={noopAsync}
                onRejectHiredClaim={noopAsync}
                onRevertToAwaiting={noopAsync}
                onScheduleTime={noopAsync}
                onDismissConnection={noopAsync}
                onUpdateStartWeek={noopAsync}
                onRemoveConnection={noopAsync}
                onConfirmTrial={noopAsync}
                onDeclineTrial={noopAsync}
                matchData={MOCK_CONNECTION_MATCH_DATA}
              />
            </ShowcaseCard>

            {/* CMP-035 PositionAccordion */}
            <ShowcaseCard code="CMP-035" name="PositionAccordion">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <PositionAccordion position={MOCK_POSITION as any} />
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 5. MATCHING — CMP-036 to CMP-037                          */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="matching" title="Matching" range="CMP-036 to CMP-037" count={2} />
          <div className="grid gap-6 md:grid-cols-2">
            {/* CMP-036 MatchCard */}
            <ShowcaseCard code="CMP-036" name="MatchCard">
              <div className="max-w-sm">
                <MatchCard
                  match={matchResult}
                  actions={
                    <Button size="sm" className="w-full">
                      Connect
                    </Button>
                  }
                />
              </div>
            </ShowcaseCard>

            {/* CMP-037 match-helpers */}
            <ShowcaseCard code="CMP-037" name="match-helpers">
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">ScoreBar</p>
                  <div className="space-y-2">
                    <ScoreBar label="Location" value={90} />
                    <ScoreBar label="Schedule" value={72} />
                    <ScoreBar label="Experience" value={55} />
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">getScoreBadgeStyle</p>
                  <div className="flex gap-2">
                    {[95, 80, 65, 50].map((score) => (
                      <span key={score} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getScoreBadgeStyle(score)}`}>
                        {score}%
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">AvailabilityTable</p>
                  <AvailabilityTable schedule={nannySchedule} />
                </div>
              </div>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 6. VERIFICATION — CMP-038                                 */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="verification" title="Verification" range="CMP-038" count={1} />
          <div className="grid gap-6 md:grid-cols-2">
            <ShowcaseCard code="CMP-038" name="VerificationProgress">
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-xs text-slate-500">Partial (step 2 in progress)</p>
                  <VerificationProgress steps={MOCK_VERIFICATION_STEPS_PARTIAL} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-slate-500">Complete</p>
                  <VerificationProgress steps={MOCK_VERIFICATION_STEPS_COMPLETE} />
                </div>
              </div>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 7. AUTH — CMP-039                                         */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="auth" title="Auth" range="CMP-039" count={1} />
          <div className="grid gap-6">
            <ShowcaseCard code="CMP-039" name="LoginModal">
              <Button variant="outline" onClick={() => setLoginModalOpen(true)}>
                Open Login Modal
              </Button>
              <LoginModal
                open={loginModalOpen}
                onOpenChange={setLoginModalOpen}
                onSuccess={noop}
              />
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 8. PROVIDERS — CMP-040                                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="providers" title="Providers" range="CMP-040" count={1} />
          <div className="grid gap-6">
            <ShowcaseCard code="CMP-040" name="SessionProvider">
              <p className="text-sm text-slate-500">
                Non-visual provider component. Wraps the application to provide auth context
                via AuthContext. Supports both dev mode (mock profiles) and real mode
                (Supabase auth). Rendered in root layout.tsx.
              </p>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 9. DEV TOOLS — CMP-041 to CMP-043                        */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="devtools" title="Dev Tools" range="CMP-041 to CMP-043" count={3} />
          <div className="grid gap-6 md:grid-cols-3">
            <ShowcaseCard code="CMP-041" name="DevSidebar">
              <p className="text-sm text-slate-500">
                Rendered by root layout when NEXT_PUBLIC_DEV_MODE=true.
                Contains 40+ dev links for quick navigation. Visible as the left sidebar on this page.
              </p>
            </ShowcaseCard>

            <ShowcaseCard code="CMP-042" name="DevToolbar">
              <p className="text-sm text-slate-500">
                Rendered by root layout when NEXT_PUBLIC_DEV_MODE=true.
                Provides role switcher + live/mock toggle at bottom of screen.
              </p>
            </ShowcaseCard>

            <ShowcaseCard code="CMP-043" name="DevPrefill">
              <p className="text-sm text-slate-500">
                Auto-fill button for registration forms. Only renders when NEXT_PUBLIC_DEV_MODE=true.
                Used in NannyRegistrationFunnel.
              </p>
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 10. FEATURE COMPONENTS — CMP-044 to CMP-048              */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="features" title="Feature Components" range="CMP-044 to CMP-048" count={5} />
          <div className="grid gap-6 md:grid-cols-2">
            {/* CMP-044 NannyCard */}
            <ShowcaseCard code="CMP-044" name="NannyCard">
              <div className="max-w-sm">
                <NannyCard nanny={nannyCard} showRequestButton onRequestInterview={noop} />
              </div>
            </ShowcaseCard>

            {/* CMP-045 NannyCardSkeleton */}
            <ShowcaseCard code="CMP-045" name="NannyCardSkeleton">
              <div className="max-w-sm">
                <NannyCardSkeleton />
              </div>
            </ShowcaseCard>

            {/* CMP-046 EmptyNannyState */}
            <ShowcaseCard code="CMP-046" name="EmptyNannyState">
              <EmptyNannyState />
            </ShowcaseCard>

            {/* CMP-047 InterviewRequestModal */}
            <ShowcaseCard code="CMP-047" name="InterviewRequestModal">
              <Button variant="outline" onClick={() => setInterviewModalOpen(true)}>
                Open Interview Request
              </Button>
              <InterviewRequestModal
                isOpen={interviewModalOpen}
                onClose={() => setInterviewModalOpen(false)}
                nanny={nannyCard}
              />
            </ShowcaseCard>

            {/* CMP-048 ConnectModal */}
            <ShowcaseCard code="CMP-048" name="ConnectModal">
              <Button variant="outline" onClick={() => setConnectModalOpen(true)}>
                Open Connect Modal
              </Button>
              <ConnectModal
                isOpen={connectModalOpen}
                onClose={() => setConnectModalOpen(false)}
                nanny={{
                  id: nannyCard.id,
                  first_name: nannyCard.first_name,
                  last_name: nannyCard.last_name,
                  suburb: nannyCard.suburb,
                  hourly_rate_min: nannyCard.hourly_rate_min,
                  profile_picture_url: nannyCard.profile_picture_url,
                }}
                pendingRequestCount={2}
              />
            </ShowcaseCard>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* 11. PAGE CLIENTS — CMP-049 to CMP-069                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader id="pageclients" title="Page Clients" range="CMP-049 to CMP-069" count={21} />

          {/* CMP-049 NannyRegistrationFunnel */}
          <PageClientShowcase code="CMP-049" name="NannyRegistrationFunnel" slug="nanny-registration">
            <NannyRegistrationFunnel
              userId="mock-user-001"
              initialData={{ first_name: "Bailey", last_name: "Wright", email: "bailey@example.com" }}
            />
          </PageClientShowcase>

          {/* CMP-050 NannyInterviewsClient */}
          <PageClientShowcase code="CMP-050" name="NannyInterviewsClient" slug="nanny-interviews">
            <NannyInterviewsClient requests={MOCK_INTERVIEW_REQUESTS} />
          </PageClientShowcase>

          {/* CMP-051 NannyBabysittingClient */}
          <PageClientShowcase code="CMP-051" name="NannyBabysittingClient" slug="nanny-babysitting">
            <NannyBabysittingClient jobs={MOCK_NANNY_BABYSITTING_JOBS} banned={false} banUntil={null} />
          </PageClientShowcase>

          {/* CMP-052 NannyInboxClient */}
          <PageClientShowcase code="CMP-052" name="NannyInboxClient" slug="nanny-inbox">
            <NannyInboxClient
              pendingRequests={MOCK_CONNECTION_REQUESTS}
              notifications={MOCK_INBOX_MESSAGES}
              pastConnections={[]}
            />
          </PageClientShowcase>

          {/* CMP-053 VerificationPageClient */}
          <PageClientShowcase code="CMP-053" name="VerificationPageClient" slug="nanny-verification">
            <VerificationPageClient initialData={MOCK_VERIFICATION_DATA} profileData={null} />
          </PageClientShowcase>

          {/* CMP-054 NannyShareClient */}
          <PageClientShowcase code="CMP-054" name="NannyShareClient" slug="nanny-share">
            <NannyShareClient initialData={MOCK_NANNY_SHARE_DATA} />
          </PageClientShowcase>

          {/* CMP-055 NannyPositionsClient */}
          <PageClientShowcase code="CMP-055" name="NannyPositionsClient" slug="nanny-positions">
            <ClientOnly>
              <NannyPositionsClient
                placements={MOCK_NANNY_PLACEMENTS as any}
                upcomingIntros={MOCK_NANNY_UPCOMING_INTROS}
              />
            </ClientOnly>
          </PageClientShowcase>


          {/* CMP-057 ParentInterviewsClient */}
          <PageClientShowcase code="CMP-057" name="ParentInterviewsClient" slug="parent-interviews">
            <ParentInterviewsClient requests={MOCK_INTERVIEW_REQUESTS} />
          </PageClientShowcase>

          {/* CMP-058 ParentInboxClient */}
          <PageClientShowcase code="CMP-058" name="ParentInboxClient" slug="parent-inbox">
            <ParentInboxClient messages={MOCK_INBOX_MESSAGES} />
          </PageClientShowcase>

          {/* CMP-059 PositionPageClient */}
          <PageClientShowcase code="CMP-059" name="PositionPageClient" slug="position-page">
            <PositionPageClient
              position={MOCK_POSITION_WITH_CHILDREN}
              upcomingIntros={MOCK_NANNY_UPCOMING_INTROS}
            />
          </PageClientShowcase>

          {/* CMP-060 MatchResultsClient */}
          <PageClientShowcase code="CMP-060" name="MatchResultsClient" slug="match-results">
            <MatchResultsClient
              matches={[matchResult]}
              stats={{ totalEligible: 45, returned: 1 }}
              dfyStatus={MOCK_DFY_STATUS}
            />
          </PageClientShowcase>

          {/* CMP-061 MatchmakerClient */}
          <ShowcaseCard code="CMP-061" name="MatchmakerClient">
            <p className="text-sm text-slate-500">
              Redirect component. Navigates to /parent/matches/checkout on mount. No visual output.
            </p>
          </ShowcaseCard>

          {/* CMP-062 MatchmakerCheckoutClient */}
          <ShowcaseCard code="CMP-062" name="MatchmakerCheckoutClient" className="mb-12">
            <p className="text-sm text-slate-500">
              DFY matchmaking checkout flow. Calls server action on confirmation. No safe offline render.
            </p>
          </ShowcaseCard>

          {/* CMP-063 PositionShareClient */}
          <PageClientShowcase code="CMP-063" name="PositionShareClient" slug="position-share">
            <PositionShareClient initialData={MOCK_POSITION_SHARE_DATA} />
          </PageClientShowcase>

          {/* CMP-064 ParentBabysittingClient */}
          <PageClientShowcase code="CMP-064" name="ParentBabysittingClient" slug="parent-babysitting">
            <ParentBabysittingClient requests={MOCK_PARENT_BSR_REQUESTS} districts={MOCK_DISTRICTS} />
          </PageClientShowcase>

          {/* CMP-065 BsrPaymentClient */}
          <PageClientShowcase code="CMP-065" name="BsrPaymentClient" slug="bsr-payment">
            <BsrPaymentClient bsr={MOCK_BSR_PROFILE} />
          </PageClientShowcase>

          {/* CMP-066 BsrShareClient */}
          <PageClientShowcase code="CMP-066" name="BsrShareClient" slug="bsr-share">
            <BsrShareClient initialData={MOCK_BSR_SHARE_DATA} />
          </PageClientShowcase>

          {/* CMP-067 ParentConnectionsClient */}
          <PageClientShowcase code="CMP-067" name="ParentConnectionsClient" slug="parent-connections">
            <ParentConnectionsClient requests={MOCK_CONNECTION_REQUESTS} />
          </PageClientShowcase>

          {/* CMP-068 ParentVerificationPageClient */}
          <PageClientShowcase code="CMP-068" name="ParentVerificationPageClient" slug="parent-verification">
            <ParentVerificationPageClient initialData={MOCK_PARENT_VERIFICATION_DATA} />
          </PageClientShowcase>

          {/* CMP-069 AdminUsersClient */}
          <PageClientShowcase code="CMP-069" name="AdminUsersClient" slug="admin-users">
            <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading...</div>}>
              <AdminUsersClient
                users={MOCK_ADMIN_USERS}
                userStats={MOCK_ADMIN_USER_STATS}
                verificationStats={MOCK_ADMIN_VERIFICATION_STATS}
                identityChecks={MOCK_ADMIN_IDENTITY_CHECKS}
                wwccChecks={MOCK_ADMIN_WWCC_CHECKS}
                parentVerificationStats={MOCK_ADMIN_PARENT_VERIFICATION_STATS}
                parentChecks={MOCK_ADMIN_PARENT_CHECKS}
              />
            </Suspense>
          </PageClientShowcase>
        </section>
      </div>
    </div>
  );
}
