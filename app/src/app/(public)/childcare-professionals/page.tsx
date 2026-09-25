import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ShieldCheck,
  Clock,
  GraduationCap,
  Heart,
  FileText,
  BadgeCheck,
  Users,
  Sparkles,
  CheckCircle,
} from "lucide-react";
import { BRAND, SITE_NAME } from "@/lib/constants";

const PRO_TITLE = `Work as a Nanny in ${BRAND.city}`;
const PRO_DESCRIPTION = `Join ${SITE_NAME} as a childcare professional in ${BRAND.city}. Get matched with local families who value quality early childhood education and care.`;

export const metadata: Metadata = {
  title: PRO_TITLE,
  description: PRO_DESCRIPTION,
  alternates: { canonical: '/childcare-professionals' },
  openGraph: {
    title: `${PRO_TITLE} | Baby Bloom`,
    description: PRO_DESCRIPTION,
  },
};

const WHY_CARDS = [
  {
    icon: ShieldCheck,
    title: "Families who get it",
    description:
      "The families on Baby Bloom care about quality childcare and child development. Engaged, respectful, and ready to invest in the right person.",
    accent: "from-violet-500 to-violet-600",
  },
  {
    icon: Clock,
    title: "Your terms, always",
    description:
      "Set your own rates. Choose your own schedule. Baby Bloom never takes a cut of what you earn — what you agree with the family is yours.",
    accent: "from-rose-400 to-rose-500",
  },
  {
    icon: Sparkles,
    title: "Babysitting requests",
    description:
      "Babysitting requests sent to verified nannies in the area. Extra income on your terms, with families who are already vetted.",
    accent: "from-amber-400 to-amber-500",
  },
  {
    icon: GraduationCap,
    title: "Professional development",
    description:
      "Resources and tools being built to support nannies on the platform — activity planning, developmental tracking, and more. Coming soon.",
    accent: "from-emerald-400 to-emerald-500",
  },
];

const CHECKLIST = [
  "You understand that play is learning and structure builds confidence",
  "You have real experience with young children — whether formal or family",
  "You hold a current Working With Children Check (or are ready to get one)",
  "You\u2019re reliable, professional, and take pride in the work you do",
  "You want to make a genuine difference in a child\u2019s early years",
];

const WHAT_TO_EXPECT = [
  {
    icon: Heart,
    title: "Families who respect you",
    description:
      "Parents on Baby Bloom care about quality. They treat their nanny as a professional and a valued part of their child\u2019s development.",
  },
  {
    icon: ShieldCheck,
    title: "A vetted platform",
    description:
      "Families are verified too. You know who you\u2019re meeting before you walk through their door.",
  },
  {
    icon: Clock,
    title: "Always in control",
    description:
      "Review each match on your terms. Accept what works, decline what doesn\u2019t. No pressure, no obligation.",
  },
];

const HOW_IT_WORKS = [
  {
    icon: FileText,
    step: "01",
    title: "Apply online",
    description:
      "Complete the application. About 10 minutes — experience, qualifications, and approach to childcare.",
  },
  {
    icon: BadgeCheck,
    step: "02",
    title: "Get verified",
    description:
      "Upload your WWCC and complete the verification process. This is why families trust the platform.",
  },
  {
    icon: Users,
    step: "03",
    title: "Get matched",
    description:
      "Matched with families based on location, schedule, experience, and approach. No scrolling through listings. No cold messages.",
  },
  {
    icon: Sparkles,
    step: "04",
    title: "Start caring",
    description:
      "Meet your family, agree on terms, and do what you do best — help a child grow.",
  },
];

export default function ForNanniesPage() {
  return (
    <div className="min-h-screen">
      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-slate-50" />
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-violet-100/40 rounded-full blur-3xl -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-200/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />

        <div className="relative container mx-auto px-4 md:px-6 py-20 md:py-32">
          <div className="max-w-3xl">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-4">
              For nannies
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.1] tracking-tight">
              Work with families who value what you do
            </h1>
            <p className="mt-6 text-lg md:text-xl text-slate-500 leading-relaxed max-w-2xl">
              Education-focused nannies matched with {BRAND.city} families who care
              about child development. No commission. No middleman. Meaningful
              work with the right people.
            </p>
            <div className="mt-8">
              <Button
                size="lg"
                asChild
                className="bg-violet-500 hover:bg-violet-600 text-white text-base h-12 px-8 shadow-lg shadow-violet-500/20"
              >
                <Link href="/apply">
                  Apply Now
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ WHY BABY BLOOM ═══ */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-2xl mx-auto text-center mb-12 md:mb-16">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
              Why Baby Bloom
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              What nanny work looks like here
            </h2>
            <p className="mt-4 text-slate-500 leading-relaxed">
              Imagine working for a family that truly understands your role —
              parents who respect your expertise, value your approach, and see
              you as an essential part of their child&apos;s development.
              They&apos;re here.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY_CARDS.map((item) => (
              <div
                key={item.title}
                className="relative bg-white rounded-2xl p-6 border border-slate-200/80 overflow-hidden hover:shadow-lg hover:shadow-slate-100 transition-all duration-300"
              >
                <div
                  className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${item.accent}`}
                />
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-4 mt-1">
                  <item.icon className="w-5 h-5 text-violet-600" />
                </div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WHAT WE LOOK FOR ═══ */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
              Who thrives here
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              This is for nannies who take their work seriously
            </h2>
            <p className="mt-4 text-slate-500 leading-relaxed">
              Professionals who understand early childhood development and want
              to work with families who share that standard.
            </p>

            <div className="mt-10 space-y-4">
              {CHECKLIST.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-slate-600 leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ WHAT TO EXPECT ═══ */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
              What to expect
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-10">
              On the other side
            </h2>

            <div className="space-y-6">
              {WHAT_TO_EXPECT.map((item) => (
                <div
                  key={item.title}
                  className="flex gap-5 bg-white rounded-2xl p-6 md:p-8 border border-slate-200/80"
                >
                  <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="py-16 md:py-24 bg-slate-50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto">
            <span className="inline-block text-xs font-semibold text-violet-500 uppercase tracking-[0.2em] mb-3">
              Getting started
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900">
              From application to first family
            </h2>
            <p className="mt-4 text-slate-500 leading-relaxed">
              About 10 minutes to apply. Here&apos;s what to expect.
            </p>

            <div className="mt-10 space-y-6">
              {HOW_IT_WORKS.map((item, i, arr) => (
                <div key={item.step} className="relative flex gap-5">
                  {i < arr.length - 1 && (
                    <div className="absolute left-5 top-12 bottom-0 w-px bg-gradient-to-b from-violet-200 to-transparent" />
                  )}

                  <div className="relative z-10 w-10 h-10 rounded-xl bg-white border border-violet-200 flex items-center justify-center shrink-0 shadow-sm">
                    <item.icon className="w-4 h-4 text-violet-500" />
                  </div>

                  <div className="pb-2">
                    <p className="text-[11px] font-semibold text-violet-400 uppercase tracking-[0.15em] mb-0.5">
                      Step {item.step}
                    </p>
                    <p className="text-base font-semibold text-slate-900">
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
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative bg-slate-900 py-16 md:py-24 overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />

        <div className="relative container mx-auto px-4 md:px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Ready to apply?
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              About 10 minutes. If you care about early childhood and want to
              work with families who share that standard — this is the place.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                asChild
                className="bg-violet-500 hover:bg-violet-600 text-white text-base h-12 px-8 shadow-lg shadow-violet-500/20"
              >
                <Link href="/apply">
                  Apply Now
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
