"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MatchCard } from "@/components/MatchCard";
import { NannyCardBK } from "./NannyCardBK";
import { NannyMatchCardBK } from "./NannyMatchCardBK";
import { NannyProfileBK, type NannyProfileBKData } from "./NannyProfileBK";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { VerificationProgress } from "@/components/verification/VerificationProgress";
import {
  Users,
  Briefcase,
  TrendingUp,
  ShieldCheck,
  Car,
  Syringe,
  ArrowRight,
  Heart,
  Star,
  CheckCircle,
  ChevronLeft,
  Calendar,
  Check,
} from "lucide-react";
import {
  FALLBACK_NANNY,
  MOCK_MATCH_RESULT,
  MOCK_VERIFICATION_STEPS_PARTIAL,
  MOCK_VERIFICATION_STEPS_COMPLETE,
} from "../ui/mock-data";
import type { MatchResult } from "@/lib/matching/types";
import { SITE_NAME } from "@/lib/constants";

// ── Design rationale helper ──

function Rationale({
  principle,
  children,
}: {
  principle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-2">
        {principle}
      </p>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </div>
  );
}

function SectionTitle({
  number,
  title,
  subtitle,
}: {
  number: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-400 mb-1">
        {number}
      </p>
      <h2 className="text-2xl font-bold text-slate-900 mb-1">{title}</h2>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function ComponentShowcase({
  children,
  rationale,
}: {
  children: React.ReactNode;
  rationale: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 overflow-hidden">
        {children}
      </div>
      {rationale}
    </div>
  );
}

// ── Colour swatch ──

function Swatch({
  name,
  hex,
  css,
  usage,
}: {
  name: string;
  hex: string;
  css: string;
  usage: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <div
        className="w-14 h-14 rounded-xl shadow-sm shrink-0 border border-slate-100"
        style={{ backgroundColor: hex }}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{name}</p>
        <p className="text-xs text-slate-400 font-mono">{css}</p>
        <p className="text-xs text-slate-500 mt-0.5">{usage}</p>
      </div>
    </div>
  );
}

// ── Main ──

const matchResult = MOCK_MATCH_RESULT as unknown as MatchResult;

interface BrandKitClientProps {
  profilePicUrl: string | null;
}

export function BrandKitClient({ profilePicUrl }: BrandKitClientProps) {
  const nannyWithPic = {
    ...FALLBACK_NANNY,
    ...(profilePicUrl ? { profile_picture_url: profilePicUrl } : {}),
  };
  const matchWithPic = profilePicUrl
    ? {
        ...matchResult,
        nanny: { ...matchResult.nanny, profile_picture_url: profilePicUrl },
      }
    : matchResult;

  const mockProfile: NannyProfileBKData = {
    first_name: "Bailey",
    last_name: "Wright",
    age: 24,
    suburb: "Clapham",
    verification_tier: "tier2",
    verification_level: 3,
    profile_picture_url: profilePicUrl,
    tagline:
      "Experienced and warm nanny with a passion for early childhood development. 4 years of dedicated experience across South West London.",
    bio: "Hi, I\u2019m Bailey! I\u2019m a passionate and experienced nanny based in Clapham with 4 years of dedicated childcare experience. I believe every child deserves a nurturing environment where they feel safe to explore, learn, and grow. My approach combines structured activities with plenty of creative play \u2014 I love getting outside, reading together, and finding little moments of magic in everyday routines. I\u2019m reliable, warm, and genuinely love what I do.",
    about:
      "Originally from Yorkshire, I moved to London three years ago and fell in love with the city and the families I\u2019ve had the privilege of working with. I hold a Certificate III in Early Childhood Education and have completed my First Aid and CPR training. When I\u2019m not with the kids, you\u2019ll find me on the Common, trying new recipes, or exploring London\u2019s hidden caf\u00e9s.",
    experience:
      "6 years total childcare experience including 4 years as a dedicated nanny. I\u2019ve worked with children from newborn through to 8 years old across a variety of family setups \u2014 single children, twins, and families with up to 3 kids. I\u2019m experienced with school and daycare drop-offs/pickups, meal preparation, bath and bedtime routines, and managing activities and playdates.",
    strengths:
      "Patient, creative, and highly organised. I\u2019m great at building genuine connections with children and creating routines that work for the whole family. Parents tell me I have a calm energy that puts kids at ease, especially during transitions.",
    nationality: "British",
    languages: ["English", "French"],
    min_child_age: "Newborn",
    max_child_age: "8 years",
    max_children: 3,
    total_experience_years: 6,
    nanny_experience_years: 4,
    drivers_license: true,
    has_car: true,
    comfortable_with_pets: true,
    vaccination_status: true,
    non_smoker: true,
    highest_qualification: "Certificate III in Early Childhood Education",
    certificates: ["First Aid & CPR", "Working With Children Check"],
    role_types: ["Nanny", "Babysitter"],
    support_levels: ["Sole charge", "Shared care"],
    schedule: {
      monday: [true, true, true, false],
      tuesday: [true, true, true, false],
      wednesday: [true, true, true, false],
      thursday: [true, true, true, false],
      friday: [true, true, false, false],
      saturday: [false, false, false, false],
      sunday: [false, false, false, false],
    },
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-3">
            Brand Kit v1
          </p>
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            Baby Bloom Design System
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl">
            The visual language of an authoritative guru that guides parents and
            nannies through a journey of trust, progression, and connection.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-20">
        {/* ─── 01. COLOUR PALETTE ─── */}
        <section>
          <SectionTitle
            number="01"
            title="Colour Palette"
            subtitle="Violet-forward with purposeful semantic accents"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Confidence through restraint">
                <p className="mb-2">
                  Violet is Baby Bloom speaking. Every violet element is the
                  guru&rsquo;s voice — primary actions, active states, brand
                  moments. It&rsquo;s distinctive without being aggressive.
                </p>
                <p className="mb-2">
                  Colour usage follows funnel position: entry screens are light
                  and open, active steps bring violet forward, milestone moments
                  introduce green celebration.
                </p>
                <p>
                  Semantic colours are strict — green means verified/success,
                  amber means attention needed, red means error. Colour always
                  communicates, never decorates.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Primary
                </p>
                <div className="space-y-3">
                  <Swatch
                    name="Violet 500"
                    hex="#8B5CF6"
                    css="hsl(263, 70%, 50%)"
                    usage="Primary actions, CTAs, active states"
                  />
                  <Swatch
                    name="Violet 100"
                    hex="#EDE9FE"
                    css="bg-violet-100"
                    usage="Accent backgrounds, hover states"
                  />
                  <Swatch
                    name="Violet 600"
                    hex="#7C3AED"
                    css="bg-violet-600"
                    usage="Hover/pressed states on primary"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Neutrals
                </p>
                <div className="space-y-3">
                  <Swatch
                    name="Slate 900"
                    hex="#0F172A"
                    css="text-slate-900"
                    usage="Headings, primary text"
                  />
                  <Swatch
                    name="Slate 500"
                    hex="#64748B"
                    css="text-slate-500"
                    usage="Body text, descriptions"
                  />
                  <Swatch
                    name="Slate 200"
                    hex="#E2E8F0"
                    css="border-slate-200"
                    usage="Borders, dividers, backgrounds"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Semantic
                </p>
                <div className="space-y-3">
                  <Swatch
                    name="Green 500"
                    hex="#22C55E"
                    css="bg-green-500"
                    usage="Verified, success, milestones"
                  />
                  <Swatch
                    name="Amber 500"
                    hex="#F59E0B"
                    css="text-amber-600"
                    usage="Warnings, pending, attention"
                  />
                  <Swatch
                    name="Red 500"
                    hex="#EF4444"
                    css="bg-destructive"
                    usage="Errors, destructive actions (rare)"
                  />
                </div>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 02. TYPOGRAPHY ─── */}
        <section>
          <SectionTitle
            number="02"
            title="Typography"
            subtitle="Hierarchy over decoration — type does the heavy lifting"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="The guru's voice in typography">
                <p className="mb-2">
                  When Baby Bloom speaks directly — encouragements, milestones,
                  next-step prompts — typography is elevated. Larger, bolder,
                  set apart. These are the moments the guru talks.
                </p>
                <p className="mb-2">
                  Semibold for emphasis, not bold. Bold is reserved for true
                  anchors: page titles, names, key metrics. This restraint makes
                  bold elements more impactful.
                </p>
                <p>
                  The constrained scale prevents visual noise. If everything is
                  big, nothing is. Secondary text (labels, timestamps) stays
                  clearly subordinate — lighter weight, muted colour.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-6">
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-3xl / bold — Page titles
                </p>
                <p className="text-3xl font-bold text-slate-900">
                  Find your perfect nanny
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-2xl / bold — Section headings
                </p>
                <p className="text-2xl font-bold text-slate-900">
                  Your matches are ready
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-lg / semibold — Card titles
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  Bailey W.
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-sm / regular — Body text
                </p>
                <p className="text-sm text-slate-600">
                  Experienced and warm nanny with a passion for early childhood
                  development. 4 years of dedicated nanny experience across
                  South West London.
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-xs / medium — Labels, metadata
                </p>
                <p className="text-xs font-medium text-slate-400">
                  Verified · Clapham · 3 km away · £28/hr
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  text-sm / semibold + violet — Guru voice (encouragement)
                </p>
                <p className="text-sm font-semibold text-violet-600">
                  Great choice — let&rsquo;s set up your interview.
                </p>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 03. BUTTONS ─── */}
        <section>
          <SectionTitle
            number="03"
            title="Buttons"
            subtitle="One primary action per moment — the hierarchy tells the user what matters"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Steps, not choices">
                <p className="mb-2">
                  At every funnel stage, one action dominates. The primary
                  button (violet) is the guru saying &ldquo;do this next.&rdquo;
                  It&rsquo;s always the most visually prominent element.
                </p>
                <p className="mb-2">
                  Secondary and outline variants exist for alternatives that
                  don&rsquo;t compete. Ghost buttons are for actions that should
                  be available but never suggested.
                </p>
                <p>
                  Destructive (red) is used sparingly — cancelling interviews,
                  deleting positions. The rarity makes it feel serious.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-6">
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Primary — the guru&rsquo;s CTA
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button>Request Interview</Button>
                  <Button size="sm">Connect</Button>
                  <Button size="lg">View Your Matches</Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Secondary — alternative actions
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary">Save for Later</Button>
                  <Button variant="outline">
                    View Profile <ArrowRight className="ml-1.5 w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Ghost & Link — subtle actions
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="ghost">Skip for Now</Button>
                  <Button variant="link">Learn More</Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Destructive — used sparingly
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="destructive">Cancel Interview</Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Disabled — not yet available
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled>Complete Verification First</Button>
                </div>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 04. BADGES & STATUS ─── */}
        <section>
          <SectionTitle
            number="04"
            title="Badges & Status"
            subtitle="Trust signals as social proof — visible, earned, meaningful"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Progressive trust, progressive access">
                <p className="mb-2">
                  Badges function like blue ticks — visible proof of earned
                  status. The green &ldquo;Verified&rdquo; badge is the most
                  important trust signal on the platform. It&rsquo;s always
                  visible, never hidden.
                </p>
                <p className="mb-2">
                  StatusBadges use strict colour coding: green =
                  active/verified, violet = earned tier, amber = pending, red =
                  failed. Users learn this language quickly and can scan status
                  at a glance.
                </p>
                <p>
                  Qualification badges (License, Languages) are secondary —
                  slate background, smaller. They inform without competing with
                  trust signals.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-6">
              <div>
                <p className="text-xs text-slate-400 mb-3">Trust badges</p>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-green-500 hover:bg-green-500">
                    <ShieldCheck className="mr-1 h-3 w-3" /> Verified
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-violet-100 text-violet-700"
                  >
                    Level 4
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Qualification badges
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="secondary"
                    className="text-xs bg-slate-100 text-slate-600"
                  >
                    <Car className="mr-1 h-3 w-3" /> License
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-xs bg-slate-100 text-slate-600"
                  >
                    <Syringe className="mr-1 h-3 w-3" /> Vaccinated
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-xs bg-slate-100 text-slate-600"
                  >
                    English
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-xs bg-slate-100 text-slate-600"
                  >
                    French
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-3">Status indicators</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge variant="active">Active</StatusBadge>
                  <StatusBadge variant="verified">Verified</StatusBadge>
                  <StatusBadge variant="pending">Pending</StatusBadge>
                  <StatusBadge variant="inactive">Inactive</StatusBadge>
                  <StatusBadge variant="failed">Failed</StatusBadge>
                  <StatusBadge variant="unattempted">Not Started</StatusBadge>
                </div>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 05. FORM ELEMENTS ─── */}
        <section>
          <SectionTitle
            number="05"
            title="Form Elements"
            subtitle="Data collection that feels like conversation, not paperwork"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="The carrot is the holiday, not the flight">
                <p className="mb-2">
                  Forms are the &ldquo;flight&rdquo; — necessary but not the
                  reason users are here. The design makes forms feel as
                  frictionless as possible: clean inputs, clear labels, generous
                  touch targets.
                </p>
                <p className="mb-2">
                  Focus rings use the violet brand colour — even in a form, the
                  user feels Baby Bloom&rsquo;s presence guiding them through
                  each field.
                </p>
                <p>
                  In the V-shaped funnel, forms are broken into single-question
                  steps (Typeform-style). This brandkit shows the atomic
                  elements; the funnel assembles them one at a time.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-5 max-w-sm">
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" placeholder="Bailey Wright" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="bailey@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="suburb">Suburb</Label>
                <Input id="suburb" placeholder="Clapham" />
                <p className="text-xs text-slate-400">
                  We use this to match you with nearby families.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="about">Tell us about yourself</Label>
                <Textarea
                  id="about"
                  placeholder="What do you love about working with children?"
                  rows={3}
                />
              </div>
              <Button className="w-full">Continue</Button>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 06. VERIFICATION PROGRESS ─── */}
        <section>
          <SectionTitle
            number="06"
            title="Verification Progress"
            subtitle="Levelling up, not completing compliance — every step unlocks something"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Encourage, validate, gratify">
                <p className="mb-2">
                  Verification is Baby Bloom&rsquo;s trust engine. But it could
                  feel like bureaucracy. The stepper design reframes it as
                  progression — each green checkmark is an achievement, each
                  violet dot is &ldquo;you are here,&rdquo; each grey circle is
                  aspiration.
                </p>
                <p className="mb-2">
                  The current step is visually elevated (larger circle, ring
                  glow, bolder text). Completed steps recede. Future steps are
                  visible but clearly locked — creating anticipation without
                  overwhelming.
                </p>
                <p>
                  This pattern maps directly to the funnel: the user sees how
                  far they&rsquo;ve come and how close they are to &ldquo;fully
                  verified&rdquo; status.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-8">
              <div>
                <p className="text-xs text-slate-400 mb-4">
                  In progress — step 2 of 4
                </p>
                <VerificationProgress steps={MOCK_VERIFICATION_STEPS_PARTIAL} />
              </div>
              <div className="border-t border-slate-100 pt-6">
                <p className="text-xs text-slate-400 mb-4">
                  Complete — all verified
                </p>
                <VerificationProgress
                  steps={MOCK_VERIFICATION_STEPS_COMPLETE}
                />
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 07. STATS CARD ─── */}
        <section>
          <SectionTitle
            number="07"
            title="Stats Card"
            subtitle="The hub's vital signs — what matters right now"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="A feed you return to">
                <p className="mb-2">
                  Stats cards turn the hub into a living home screen. They
                  answer the question every returning user has:
                  &ldquo;What&rsquo;s changed since I was last here?&rdquo;
                </p>
                <p className="mb-2">
                  Each card has one metric, one icon, one trend. The icon
                  background uses a muted version of the semantic colour —
                  violet for platform metrics, green for positive states, amber
                  for attention-needed.
                </p>
                <p>
                  Trend indicators (+12%, -3%) add temporal context. Users
                  don&rsquo;t just see a number — they see momentum. This
                  reinforces the progression philosophy.
                </p>
              </Rationale>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <StatsCard
                icon={Users}
                value={127}
                label="Active Nannies"
                trend={{ value: 12, isPositive: true }}
              />
              <StatsCard
                icon={Briefcase}
                value={34}
                label="Open Positions"
                trend={{ value: 8, isPositive: true }}
                iconColor="text-blue-500"
                iconBgColor="bg-blue-100"
              />
              <StatsCard
                icon={Heart}
                value="86%"
                label="Average Match Score"
                iconColor="text-green-500"
                iconBgColor="bg-green-100"
              />
              <StatsCard
                icon={TrendingUp}
                value={23}
                label="Connections This Week"
                trend={{ value: 3, isPositive: false }}
                iconColor="text-amber-500"
                iconBgColor="bg-amber-100"
              />
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 08. NANNY CARD ─── */}
        <section>
          <SectionTitle
            number="08"
            title="Nanny Card"
            subtitle="Profiles over listings — the first impression that drives connection"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="The social platform paradigm">
                <p className="mb-2">
                  The NannyCard is the most-seen component on the platform. It
                  mirrors the MatchCard&rsquo;s horizontal layout — photo and
                  info side by side — but is shorter and lighter, designed for
                  browsing rather than evaluating a match.
                </p>
                <p className="mb-2">
                  No &ldquo;View Profile&rdquo; or &ldquo;Connect&rdquo;
                  buttons. The entire card is clickable. This reduces visual
                  noise and follows the social platform paradigm — you tap a
                  profile to visit it, you don&rsquo;t click a button.
                </p>
                <p className="mb-2">
                  Tags replace match data. Experience years, verification tier,
                  driver&rsquo;s license, languages — scannable at a glance.
                  Violet badges for earned status, slate for qualifications.
                </p>
                <p>
                  The verified badge overlays the profile photo (like a social
                  media blue tick) — always visible, never hidden. The AI
                  headline adds personality in the nanny&rsquo;s own voice.
                </p>
              </Rationale>
            }
          >
            <div className="max-w-sm mx-auto">
              <NannyCardBK nanny={nannyWithPic} />
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 09. MATCH CARD ─── */}
        <section>
          <SectionTitle
            number="09"
            title="Match Card"
            subtitle="The major dopamine hit — 'here's who we found for you'"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="The V-shaped funnel payoff">
                <p className="mb-2">
                  The MatchCard appears at P5 — the parent&rsquo;s biggest
                  payoff moment. After creating a position and waiting, they see
                  real, verified nannies ranked by compatibility. This is THE
                  moment the funnel exists to deliver.
                </p>
                <p className="mb-2">
                  The card has three sliding views (overview, availability,
                  breakdown) — dense information made digestible through
                  progressive disclosure. The user explores at their pace.
                </p>
                <p className="mb-2">
                  Score bars provide transparency — the match isn&rsquo;t a
                  black box. Parents see exactly why someone matches:
                  experience, schedule overlap, location proximity. This builds
                  trust in the algorithm.
                </p>
                <p>
                  The score badge (top-right) is the anchor — it&rsquo;s the
                  first thing the eye hits. High scores (green) create
                  excitement. Mid scores (violet) create curiosity. The
                  emotional gradient is intentional.
                </p>
              </Rationale>
            }
          >
            <div className="max-w-sm mx-auto">
              <MatchCard
                match={matchWithPic as MatchResult}
                actions={
                  <Button size="sm" className="w-full">
                    Connect
                  </Button>
                }
              />
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 09b. NANNY MATCH CARD (Browse) ─── */}
        <section>
          <SectionTitle
            number="09b"
            title="Nanny Match Card (Browse)"
            subtitle="The browse-friendly match card — scores at a glance without the complexity"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Scan, don't study">
                <p className="mb-2">
                  The NannyMatchCardBK is designed for the &ldquo;Matches&rdquo;
                  tab on the browse page. It combines the familiar NannyCardBK
                  layout with match-specific data: the score badge, distance,
                  and three score bars.
                </p>
                <p className="mb-2">
                  Unlike the full MatchCard (which has three sliding views),
                  this card is scannable in a single glance — optimised for
                  comparing multiple matches in a vertical list.
                </p>
                <p>
                  Score bars (Experience, Schedule, Location) sit below the
                  badges, separated by a subtle border. They use violet-100
                  tracks with violet-500 fills — consistent with the brand
                  palette. The match % badge anchors in the top-right.
                </p>
              </Rationale>
            }
          >
            <div className="max-w-sm mx-auto">
              <NannyMatchCardBK match={matchWithPic as MatchResult} />
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 10. CARDS ─── */}
        <section>
          <SectionTitle
            number="10"
            title="Card System"
            subtitle="The atomic unit — every piece of content lives in a card"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Generous, not sparse">
                <p className="mb-2">
                  Cards are Baby Bloom&rsquo;s primary container. They create
                  consistent visual rhythm across every page — nanny profiles,
                  interview requests, babysitting jobs, stats, positions.
                </p>
                <p className="mb-2">
                  Rounded-xl corners and subtle shadow create depth without
                  weight. Cards feel like objects that can be picked up and
                  interacted with — the shadow is the affordance.
                </p>
                <p>
                  Consistent padding (p-5 for content, p-6 for stats) and
                  border-radius across all cards creates the visual language
                  that says &ldquo;this is one thing, this is another.&rdquo;
                  White space between cards is generous.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <Star className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Interview Request
                      </p>
                      <p className="text-xs text-slate-500">
                        The Smith family in Clapham wants to meet you
                      </p>
                    </div>
                    <Button size="sm" className="ml-auto shrink-0">
                      Respond
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Verification Complete
                      </p>
                      <p className="text-xs text-slate-500">
                        Your identity has been verified — you&rsquo;re now
                        visible to families
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-violet-200 bg-violet-50/30">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-violet-700">
                        Next Step: Share Your Profile
                      </p>
                      <p className="text-xs text-violet-600/70">
                        Share to Facebook to unlock babysitting opportunities
                      </p>
                    </div>
                    <Button size="sm" className="ml-auto shrink-0">
                      Share
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 11. NANNY PROFILE ─── */}
        <section>
          <SectionTitle
            number="11"
            title="Nanny Profile"
            subtitle="The full story — where trust is built and connections begin"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Profiles over listings">
                <p className="mb-2">
                  The profile page is the destination the entire platform
                  funnels toward. When a parent clicks a NannyCard or MatchCard,
                  this is where they land. It must convert curiosity into
                  action.
                </p>
                <p className="mb-2">
                  The hero section mirrors the card layout — photo, name, age,
                  location, verification badge — so the transition feels
                  seamless. The tagline gives an immediate sense of personality.
                </p>
                <p className="mb-2">
                  The tabbed interface (Profile, About, Checklist, Availability)
                  uses progressive disclosure — dense information made
                  digestible. The parent explores at their pace without feeling
                  overwhelmed.
                </p>
                <p className="mb-2">
                  AI-generated content (bio, experience summary, skills) ensures
                  every nanny is presented professionally regardless of writing
                  ability. The platform elevates, never diminishes.
                </p>
                <p>
                  One CTA dominates: &ldquo;Connect with [Name].&rdquo; The guru
                  tells you what to do next. No competing actions, no dead ends.
                </p>
              </Rationale>
            }
          >
            <NannyProfileBK nanny={mockProfile} />
          </ComponentShowcase>
        </section>

        {/* ─── 12. POSITION FORM ─── */}
        <section>
          <SectionTitle
            number="12"
            title="Position Form"
            subtitle="One question at a time — the Typeform pattern that converts"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Steps, not choices">
                <p className="mb-2">
                  The parent position form collects 42 fields — but the user
                  never sees a form. Each question appears alone, centred on the
                  page, with options pinned to the bottom. Auto-advance on
                  selection means zero &ldquo;Next&rdquo; buttons for simple
                  questions.
                </p>
                <p className="mb-2">
                  The violet progress bar at the top is the guru&rsquo;s voice
                  saying &ldquo;you&rsquo;re getting closer.&rdquo; It grows
                  smoothly with each answer, creating momentum. The back arrow
                  is subtle — forward is always the dominant direction.
                </p>
                <p className="mb-2">
                  Pill-style select buttons use the same violet-fills-on-select
                  pattern as verification badges — violet means &ldquo;chosen,
                  done, yours.&rdquo; The consistency reinforces learned
                  behaviour.
                </p>
                <p>
                  Compound questions (children details, availability grid)
                  progressively reveal — select &ldquo;2 children&rdquo; and two
                  detail cards expand below. The form grows with the
                  user&rsquo;s input, never overwhelming upfront.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-8">
              {/* ── Demo 1: Question Shell + SingleSelect ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Question Shell — single select (auto-advance)
                </p>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {/* Progress bar */}
                  <div className="h-1 bg-slate-100">
                    <div
                      className="h-full bg-violet-600 rounded-r-full"
                      style={{ width: "35%" }}
                    />
                  </div>

                  <div
                    className="relative flex flex-col"
                    style={{ height: "280px" }}
                  >
                    {/* Back arrow */}
                    <button className="absolute top-3 left-3 p-1.5 text-slate-400">
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    {/* Question — centered */}
                    <div className="flex-1 flex items-center justify-center px-6">
                      <h2 className="text-xl font-semibold text-slate-800 text-center leading-snug">
                        What type of care are you looking for?
                      </h2>
                    </div>

                    {/* Options — pinned to bottom */}
                    <div className="w-full max-w-sm mx-auto pb-5 px-4">
                      <div className="flex flex-col gap-2">
                        {[
                          { label: "Full-time nanny", selected: false },
                          { label: "Part-time nanny", selected: true },
                          { label: "Casual / Babysitter", selected: false },
                          { label: "After school care", selected: false },
                        ].map((opt) => (
                          <div
                            key={opt.label}
                            className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 ${
                              opt.selected
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {opt.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 2: Two-column select ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Two-column select — binary questions
                </p>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="h-1 bg-slate-100">
                    <div
                      className="h-full bg-violet-600 rounded-r-full"
                      style={{ width: "50%" }}
                    />
                  </div>

                  <div
                    className="relative flex flex-col"
                    style={{ height: "220px" }}
                  >
                    <button className="absolute top-3 left-3 p-1.5 text-slate-400">
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <div className="flex-1 flex items-center justify-center px-6">
                      <h2 className="text-xl font-semibold text-slate-800 text-center leading-snug">
                        Do you need your nanny to drive?
                      </h2>
                    </div>

                    <div className="w-full max-w-sm mx-auto pb-5 px-4">
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Yes", selected: true },
                          { label: "No", selected: false },
                        ].map((opt) => (
                          <div
                            key={opt.label}
                            className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 ${
                              opt.selected
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {opt.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 3: Children Compound ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Compound question — progressive reveal
                </p>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="h-1 bg-slate-100">
                    <div
                      className="h-full bg-violet-600 rounded-r-full"
                      style={{ width: "20%" }}
                    />
                  </div>

                  <div className="relative flex flex-col">
                    <button className="absolute top-3 left-3 p-1.5 text-slate-400">
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <div className="flex items-center justify-center px-6 py-8">
                      <h2 className="text-xl font-semibold text-slate-800 text-center leading-snug">
                        How many children need care?
                      </h2>
                    </div>

                    <div className="w-full max-w-sm mx-auto pb-5 px-4">
                      {/* Number selector */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {["1", "2", "3"].map((n) => (
                          <div
                            key={n}
                            className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 ${
                              n === "2"
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {n}
                          </div>
                        ))}
                      </div>

                      {/* Expanded child cards */}
                      <div className="flex flex-col gap-3">
                        {["First Child", "Second Child"].map((label, i) => (
                          <div
                            key={label}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-col gap-3"
                          >
                            <p className="text-sm font-semibold text-slate-700">
                              {label}
                            </p>

                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-slate-500">
                                Age
                              </label>
                              <div className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                                {i === 0 ? "1–2 years" : "3–4 years"}
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-medium text-slate-500">
                                Gender
                              </label>
                              <div className="grid grid-cols-3 gap-1.5">
                                {["Boy", "Girl", "Other"].map((g) => (
                                  <div
                                    key={g}
                                    className={`px-2 py-2 rounded-lg border text-xs font-medium text-center transition-colors ${
                                      (i === 0 && g === "Girl") ||
                                      (i === 1 && g === "Boy")
                                        ? "bg-violet-500 text-white border-violet-500"
                                        : "bg-white text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    {g}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* Continue button */}
                        <Button className="mt-1 bg-violet-600 hover:bg-violet-700 text-white py-2.5 px-6 rounded-lg font-medium text-sm">
                          Continue
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 4: Suburb Autocomplete ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Autocomplete — dropdown above input
                </p>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="h-1 bg-slate-100">
                    <div
                      className="h-full bg-violet-600 rounded-r-full"
                      style={{ width: "65%" }}
                    />
                  </div>

                  <div
                    className="relative flex flex-col"
                    style={{ height: "340px" }}
                  >
                    <button className="absolute top-3 left-3 p-1.5 text-slate-400">
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <div className="flex-1 flex items-center justify-center px-6">
                      <h2 className="text-xl font-semibold text-slate-800 text-center leading-snug">
                        What suburb do you live in?
                      </h2>
                    </div>

                    <div className="w-full max-w-sm mx-auto pb-5 px-4">
                      <div className="relative">
                        {/* Dropdown — positioned above */}
                        <div className="absolute z-10 bottom-full mb-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                          {[
                            { suburb: "Clapham", postcode: "SW4" },
                            { suburb: "Balham", postcode: "SW12" },
                            { suburb: "Brixton", postcode: "SW2" },
                            { suburb: "Chelsea", postcode: "SW3" },
                          ].map((entry) => (
                            <div
                              key={`${entry.suburb}-${entry.postcode}`}
                              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors cursor-pointer"
                            >
                              {entry.suburb}, {entry.postcode}
                            </div>
                          ))}
                        </div>

                        {/* Input */}
                        <input
                          type="text"
                          readOnly
                          value="Bon"
                          className="w-full py-2.5 px-3 rounded-lg border border-violet-500 ring-1 ring-violet-500 text-sm text-slate-800 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── 13. DATE & TIME PICKERS ─── */}
        <section>
          <SectionTitle
            number="13"
            title="Date &amp; Time Pickers"
            subtitle="Schedules made visual — grids replace dropdowns, brackets replace hours"
          />
          <ComponentShowcase
            rationale={
              <Rationale principle="Show, don&rsquo;t list">
                <p className="mb-2">
                  Traditional datetime inputs are replaced with visual grids
                  wherever possible. Days &times; time brackets creates a
                  heatmap mental model — users see their week at a glance rather
                  than parsing dropdown menus.
                </p>
                <p className="mb-2">
                  Time brackets (Morning, Midday, Afternoon, Evening) are Baby
                  Bloom&rsquo;s universal time language. Every scheduling
                  surface uses the same four columns, so the pattern becomes
                  second nature across position creation, availability
                  proposals, and time confirmation.
                </p>
                <p className="mb-2">
                  The three-tier drill-down (bracket &rarr; 15-min slots &rarr;
                  confirmation) matches the funnel philosophy: broad selection
                  first, then refine. The green confirmation bar provides
                  instant validation feedback.
                </p>
                <p>
                  Start week presets (This week, Next week, In 2 weeks) reduce
                  cognitive load — most placements start within 2 weeks. The
                  &ldquo;Different date&rdquo; option exists but isn&rsquo;t the
                  default path. The &ldquo;TBC&rdquo; option respects
                  uncertainty without blocking progress.
                </p>
              </Rationale>
            }
          >
            <div className="space-y-8">
              {/* ── Demo 1: Days & Times Compound ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Weekly schedule — days + time brackets (position form)
                </p>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-col gap-4 max-w-md mx-auto">
                    {/* Day selection — 2 rows: 4 + 3 */}
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-4 gap-2">
                        {["Mon", "Tue", "Wed", "Thu"].map((day) => (
                          <div
                            key={day}
                            className={`px-2 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 ${
                              ["Mon", "Tue", "Wed"].includes(day)
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {day}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {["Fri", "Sat", "Sun"].map((day) => (
                          <div
                            key={day}
                            className={`px-2 py-2.5 rounded-lg border text-sm font-medium text-center transition-all duration-150 ${
                              day === "Fri"
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-white text-slate-600 border-slate-200"
                            }`}
                          >
                            {day}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Time bracket grid */}
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium text-slate-700 text-center">
                        When during the day?
                      </p>
                      <div>
                        {/* Column headers */}
                        <div className="grid grid-cols-[80px_repeat(4,1fr)] gap-1 mb-1">
                          <div />
                          {[
                            { label: "Morning", sub: "6am–10am" },
                            { label: "Midday", sub: "10am–2pm" },
                            { label: "Afternoon", sub: "2pm–6pm" },
                            { label: "Evening", sub: "6pm–10pm" },
                          ].map((block) => (
                            <div key={block.label} className="text-center">
                              <p className="text-[11px] font-semibold text-slate-600">
                                {block.label}
                              </p>
                              <p className="text-[9px] text-slate-400">
                                {block.sub}
                              </p>
                            </div>
                          ))}
                        </div>

                        {/* Day rows — only selected days shown */}
                        {[
                          { day: "Mon", slots: [true, true, true, false] },
                          { day: "Tue", slots: [true, true, true, false] },
                          { day: "Wed", slots: [false, true, true, false] },
                          { day: "Fri", slots: [true, true, false, false] },
                        ].map((row) => (
                          <div
                            key={row.day}
                            className="grid grid-cols-[80px_repeat(4,1fr)] gap-1 mb-1"
                          >
                            <div className="flex items-center">
                              <p className="text-xs font-semibold text-slate-600">
                                {row.day}
                              </p>
                            </div>
                            {row.slots.map((on, i) => (
                              <div
                                key={i}
                                className={`h-9 rounded-md border text-xs font-medium flex items-center justify-center transition-colors ${
                                  on
                                    ? "bg-violet-500 text-white border-violet-500"
                                    : "bg-white text-slate-400 border-slate-200"
                                }`}
                              >
                                {on ? <Check className="h-3.5 w-3.5" /> : ""}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button className="mt-1 bg-violet-600 hover:bg-violet-700 text-white py-2.5 px-6 rounded-lg font-medium text-sm">
                      Continue
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── Demo 2: Availability Grid ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Interview availability — nanny proposes slots
                </p>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">
                        When are you available for a meet and greet?
                      </p>
                      <p className="text-xs text-slate-500">
                        Select at least 5 slots across all time brackets and 3+
                        days.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50">
                        Anytime
                      </div>
                      <div className="flex gap-x-3 ml-auto">
                        <p className="text-xs text-green-600">
                          {"\u2713"} 8/5 slots
                        </p>
                        <p className="text-xs text-green-600">
                          {"\u2713"} 4/4 brackets
                        </p>
                        <p className="text-xs text-green-600">
                          {"\u2713"} 5/3 days
                        </p>
                      </div>
                    </div>

                    {/* Grid */}
                    <div>
                      <div className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                        <div />
                        {["Morning", "Midday", "Afternoon", "Evening"].map(
                          (label) => (
                            <div key={label} className="text-center">
                              <p className="text-xs font-semibold text-slate-600">
                                {label}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {label === "Morning"
                                  ? "8–11am"
                                  : label === "Midday"
                                    ? "11–2pm"
                                    : label === "Afternoon"
                                      ? "2–5pm"
                                      : "5–8pm"}
                              </p>
                            </div>
                          ),
                        )}
                      </div>

                      {[
                        {
                          day: "Wed",
                          date: "12 Mar",
                          slots: [true, false, true, false],
                        },
                        {
                          day: "Thu",
                          date: "13 Mar",
                          slots: [true, true, false, false],
                        },
                        {
                          day: "Fri",
                          date: "14 Mar",
                          slots: [false, true, true, false],
                        },
                        {
                          day: "Sat",
                          date: "15 Mar",
                          slots: [false, false, false, true],
                        },
                        {
                          day: "Sun",
                          date: "16 Mar",
                          slots: [true, false, false, false],
                        },
                      ].map((row) => (
                        <div
                          key={row.day}
                          className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1"
                        >
                          <div className="flex items-center">
                            <div>
                              <p className="text-xs font-semibold text-slate-600">
                                {row.day}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {row.date}
                              </p>
                            </div>
                          </div>
                          {row.slots.map((on, i) => (
                            <div
                              key={i}
                              className={`h-10 rounded-md border text-xs font-medium flex items-center justify-center transition-colors ${
                                on
                                  ? "bg-violet-600 text-white border-violet-600"
                                  : "bg-white text-slate-400 border-slate-200"
                              }`}
                            >
                              {on ? <Check className="h-3.5 w-3.5" /> : ""}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1">
                        Back
                      </Button>
                      <Button className="flex-1 bg-violet-500 hover:bg-violet-600">
                        Confirm Availability
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 3: Schedule Time Grid ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Time picker — parent selects from nanny&rsquo;s proposed slots
                </p>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Bailey&apos;s availability
                    </p>

                    {/* Date/bracket grid */}
                    <div>
                      <div className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                        <div />
                        {["Morning", "Midday", "Afternoon", "Evening"].map(
                          (label) => (
                            <div key={label} className="text-center">
                              <p className="text-xs font-semibold text-slate-600">
                                {label}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {label === "Morning"
                                  ? "8–11am"
                                  : label === "Midday"
                                    ? "11–2pm"
                                    : label === "Afternoon"
                                      ? "2–5pm"
                                      : "5–8pm"}
                              </p>
                            </div>
                          ),
                        )}
                      </div>

                      {[
                        {
                          day: "Thu",
                          date: "13 Mar",
                          slots: [true, false, true, false],
                          selectedIdx: 2,
                        },
                        {
                          day: "Fri",
                          date: "14 Mar",
                          slots: [false, true, true, false],
                          selectedIdx: -1,
                        },
                        {
                          day: "Sat",
                          date: "15 Mar",
                          slots: [true, false, false, true],
                          selectedIdx: -1,
                        },
                      ].map((row) => (
                        <div
                          key={row.day}
                          className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1"
                        >
                          <div className="flex items-center">
                            <div>
                              <p className="text-xs font-semibold text-slate-600">
                                {row.day}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {row.date}
                              </p>
                            </div>
                          </div>
                          {row.slots.map((available, i) => (
                            <div
                              key={i}
                              className={`h-10 rounded-md border text-xs font-medium flex items-center justify-center transition-colors ${
                                i === row.selectedIdx
                                  ? "bg-violet-600 text-white border-violet-600"
                                  : available
                                    ? "bg-violet-50 text-violet-600 border-violet-200"
                                    : "bg-slate-50 text-slate-200 border-slate-100"
                              }`}
                            >
                              {i === row.selectedIdx ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                ""
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* 4×3 time picker — shown for selected bracket */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">
                        Select a time
                      </p>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            "2:00pm",
                            "2:15pm",
                            "2:30pm",
                            "2:45pm",
                            "3:00pm",
                            "3:15pm",
                            "3:30pm",
                            "3:45pm",
                            "4:00pm",
                            "4:15pm",
                            "4:30pm",
                            "4:45pm",
                          ].map((time) => (
                            <div
                              key={time}
                              className={`py-2.5 rounded-md border text-sm font-medium text-center transition-colors ${
                                time === "3:15pm"
                                  ? "bg-violet-600 text-white border-violet-600"
                                  : "bg-white text-slate-700 border-slate-200"
                              }`}
                            >
                              {time}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Green confirmation */}
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-sm font-medium text-green-800">
                        Thursday 13 March at 3:15pm
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1">
                        Back
                      </Button>
                      <Button className="flex-1 bg-violet-500 hover:bg-violet-600">
                        Confirm Time
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 4: Start Week Picker ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Start week — preset options + custom date
                </p>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="space-y-3 max-w-sm mx-auto">
                    <p className="text-xs font-medium text-slate-500">
                      When would you like them to start?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          label: "This week",
                          display: "Week of 10 March",
                          selected: false,
                        },
                        {
                          label: "Next week",
                          display: "Week of 17 March",
                          selected: true,
                        },
                        {
                          label: "In 2 weeks",
                          display: "Week of 24 March",
                          selected: false,
                        },
                        {
                          label: "Different date",
                          display: "",
                          selected: false,
                        },
                        {
                          label: "To be confirmed",
                          display: "",
                          selected: false,
                        },
                      ].map((opt) => (
                        <div
                          key={opt.label}
                          className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                            opt.selected
                              ? "border-green-500 bg-green-50 text-green-700 font-medium"
                              : "border-slate-200 text-slate-600"
                          }`}
                        >
                          <span className="block">{opt.label}</span>
                          {opt.display && (
                            <span className="block text-[10px] opacity-70">
                              {opt.display}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Demo 5: Proposed Times (read-only) ── */}
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Proposed times — compact read-only display
                </p>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="max-w-sm mx-auto">
                    <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 space-y-2">
                      <p className="text-xs font-medium text-violet-800 flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Proposed Times
                      </p>
                      <div className="grid grid-cols-5 gap-1 text-xs">
                        <div />
                        {["Morn", "Mid", "Aftn", "Eve"].map((b) => (
                          <div
                            key={b}
                            className="text-center text-violet-600 font-medium"
                          >
                            {b}
                          </div>
                        ))}
                        {[
                          {
                            label: "Thu, 13 Mar",
                            slots: [true, false, true, false],
                          },
                          {
                            label: "Fri, 14 Mar",
                            slots: [false, true, true, false],
                          },
                          {
                            label: "Sat, 15 Mar",
                            slots: [true, false, false, true],
                          },
                        ].map((row) => (
                          <div key={row.label} className="contents">
                            <div className="text-violet-700 font-medium truncate pr-1">
                              {row.label}
                            </div>
                            {row.slots.map((on, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-center"
                              >
                                <div
                                  className={`h-3 w-3 rounded-full ${on ? "bg-violet-400" : "bg-violet-100"}`}
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ComponentShowcase>
        </section>

        {/* ─── FOOTER ─── */}
        <footer className="border-t border-slate-100 pt-8 pb-4">
          <p className="text-xs text-slate-400 text-center">
            {SITE_NAME} &mdash; Brand Kit v1 &mdash; Based on the Design
            Ethos document
          </p>
        </footer>
      </main>
    </div>
  );
}
