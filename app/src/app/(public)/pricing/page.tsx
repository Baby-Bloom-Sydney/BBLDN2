import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CheckCircle,
  Search,
  MessageCircle,
  Heart,
  GraduationCap,
  BookOpen,
  Brain,
  Palette,
  Handshake,
} from "lucide-react";
import { BRAND, HOURLY_RATE_BOUNDS, SITE_NAME } from "@/lib/constants";

const PRICING_DESCRIPTION = `Personalised nanny matching for ${BRAND.city} families. Choose from DIY search or done-for-you matching with verified, background-checked nannies.`;

export const metadata: Metadata = {
  title: 'Nanny Matching Plans & Pricing',
  description: PRICING_DESCRIPTION,
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: `Nanny Matching Plans & Pricing | ${SITE_NAME}`,
    description: PRICING_DESCRIPTION,
  },
};

const NANNY_CARDS = [
  {
    icon: Brain,
    title: "Developmental milestones",
    description:
      "Tracking and supporting age-appropriate development — cognitive, social, and physical.",
  },
  {
    icon: BookOpen,
    title: "Structured play",
    description:
      "Activities designed around literacy, numeracy, and creative thinking. Not screen time.",
  },
  {
    icon: Palette,
    title: "Creative exploration",
    description:
      "Art, music, sensory play, outdoor learning — nurturing curiosity and self-expression every day.",
  },
  {
    icon: GraduationCap,
    title: "Qualified carers",
    description:
      "Many hold early childhood education qualifications, from certificates to degrees.",
  },
];

const CHECKLIST = [
  "Matching across 12 factors — location, schedule, experience, qualifications, developmental approach, and more",
  "Best matches contacted directly — no cold messages, no browsing",
  "Every nanny WWCC verified and expertly vetted",
  "No subscription, no commission, no placement fees",
];

const HOW_IT_WORKS = [
  {
    icon: Search,
    step: "01",
    title: "Share",
    description: "Schedule. Area. What matters most.",
  },
  {
    icon: Brain,
    step: "02",
    title: "Match",
    description: "Matching across 12 factors. Nannies who genuinely fit.",
  },
  {
    icon: MessageCircle,
    step: "03",
    title: "Connect",
    description:
      "Top matches contacted directly. No cold messages. No browsing through profiles.",
  },
  {
    icon: Handshake,
    step: "04",
    title: "Meet",
    description: "An introduction is arranged. From there — it\u2019s personal.",
  },
];

const NANNY_BENEFITS = [
  "Families who value quality childcare",
  "Own rates. Own schedule. No commission.",
  "Professional development",
  "No commission taken",
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: `How much does a nanny cost in ${BRAND.city}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        // The one rate bound, read from config (Q-1 / Q-7). The old copy
        // carried a second, separately-invented casual range; it is not
        // reproduced because nothing sources it.
        text: `Nanny rates in ${BRAND.city} typically range from £${HOURLY_RATE_BOUNDS.min} to £${HOURLY_RATE_BOUNDS.max} per hour. Rates vary by experience, qualifications, and location.`,
      },
    },
    {
      '@type': 'Question',
      name: 'Are Baby Bloom nannies WWCC verified?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Yes. Every nanny on ${SITE_NAME} has a verified Working With Children Check (WWCC) and undergoes identity verification before being visible to families.`,
      },
    },
    {
      '@type': 'Question',
      name: 'How does the nanny matching process work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "Create a position describing your family's needs, and Baby Bloom matches you with verified nannies based on availability, location, experience, and qualifications. You can then request a meet and greet with your top matches.",
      },
    },
    {
      '@type': 'Question',
      name: 'Can I find a babysitter for a one-off job?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "Yes. Baby Bloom's babysitting request feature lets you post a one-off job and get matched with available, verified babysitters in your area within minutes.",
      },
    },
  ],
};

export default function ServicesPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-slate-50" />
        <div className="absolute top-0 left-1/2 w-[600px] h-[600px] bg-violet-100/30 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />

        <div className="relative container mx-auto px-4 md:px-6 py-20 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-4">
              Services
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] tracking-tight">
              Personalised nanny matching for {BRAND.city} families
            </h1>
            <p className="mt-6 text-lg md:text-xl text-slate-500 leading-relaxed max-w-2xl mx-auto">
              An area. A schedule. What matters most. Nannies matched across
              location, experience, and approach to childcare. No fees for
              families.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ THE NANNIES ═══ */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
              The nannies
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              Nannies who understand child development
            </h2>
            <p className="mt-4 text-slate-500 leading-relaxed">
              Not just available — here because they care about early childhood.
              That commitment is the foundation of every match.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {NANNY_CARDS.map((item) => (
              <div
                key={item.title}
                className="bg-white rounded-2xl p-6 border border-slate-200/80 hover:shadow-md transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-4">
                  <item.icon className="w-5 h-5 text-violet-600" />
                </div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 max-w-2xl mx-auto text-center">
            <p className="text-slate-500 leading-relaxed">
              The nannies who join Baby Bloom do so because they take child
              development seriously. That standard shapes every match.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ HOW MATCHING WORKS ═══ */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            {/* Left — matching description */}
            <div>
              <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
                For families
              </span>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
                Less searching. Better matches.
              </h2>
              <p className="mt-4 text-slate-500 leading-relaxed">
                Area. Schedule. Priorities. A handful of nannies matched across
                12 factors — the strongest fits, contacted directly.
              </p>

              <div className="mt-8 space-y-4">
                {CHECKLIST.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {item}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Button
                  size="lg"
                  asChild
                  className="bg-violet-500 hover:bg-violet-600 text-base h-12 px-8"
                >
                  <Link href="/">
                    Get Matched
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Right — how it works steps */}
            <div className="bg-slate-50 rounded-2xl p-8 md:p-10">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-[0.15em] mb-6">
                How it works
              </p>
              <div className="space-y-6">
                {HOW_IT_WORKS.map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <item.icon className="w-4 h-4 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        <span className="text-violet-400 mr-1.5 tabular-nums">
                          {item.step}
                        </span>
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative bg-slate-900 py-16 md:py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />

        <div className="relative container mx-auto px-4 md:px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Find the right nanny
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              An area. A schedule. The rest is handled.
            </p>
            <div className="mt-8">
              <Button
                size="lg"
                asChild
                className="bg-violet-500 hover:bg-violet-600 text-white text-base h-12 px-8 shadow-lg shadow-violet-500/20"
              >
                <Link href="/">
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOR NANNIES TEASER ═══ */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="relative bg-gradient-to-br from-violet-50 to-slate-50 rounded-2xl p-8 md:p-12 border border-violet-100/50 overflow-hidden">
            <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-violet-200/20 rounded-full blur-3xl" />

            <div className="relative grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
                  For nannies
                </span>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900">
                  A platform for professionals
                </h2>
                <p className="mt-4 text-slate-500 leading-relaxed">
                  Education-focused nannies matched with families who value
                  quality childcare and child development.
                </p>
                <div className="mt-6">
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    className="border-violet-200 text-violet-600 hover:bg-violet-50 text-sm h-11 px-6"
                  >
                    <Link href="/childcare-professionals">
                      Learn more
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {NANNY_BENEFITS.map((benefit) => (
                  <div
                    key={benefit}
                    className="bg-white rounded-xl p-4 border border-slate-200/80"
                  >
                    <div className="flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-medium text-slate-600">
                        {benefit}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
