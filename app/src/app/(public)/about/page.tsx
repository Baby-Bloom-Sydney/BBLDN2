import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { BRAND, OG_LOCALE, SITE_NAME } from "@/lib/constants";

const ABOUT_DESCRIPTION = `Baby Bloom connects ${BRAND.city} families with verified, education-focused nannies. Learn about our mission, our verification process, and why families trust us.`;

export const metadata: Metadata = {
  title: `About Us — ${BRAND.city}'s Trusted Nanny Platform`,
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    locale: OG_LOCALE,
    title: `About ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ═══ HERO ═══ */}
      <section className="relative pt-20 pb-24 md:pt-32 md:pb-36 lg:pt-40 lg:pb-44 overflow-hidden">
        {/* Subtle warm wash — not a gradient blob */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_40%,rgba(139,92,246,0.04),transparent)]" />

        <div className="relative container mx-auto px-4 md:px-6">
          <div className="max-w-4xl">
            <h1 className="text-[2.5rem] md:text-[3.5rem] lg:text-[4.25rem] font-bold text-slate-900 leading-[1.08] tracking-tight">
              The early years shape{" "}
              <span className="text-violet-500">everything</span>{" "}
              that follows.
            </h1>
          </div>
        </div>
      </section>

      {/* ═══ THE CHILD ═══ */}
      <section className="pb-20 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-20 items-start">
            {/* Left — anchor statement */}
            <div>
              <div className="w-10 h-1 bg-violet-500 rounded-full mb-8" />
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 leading-snug">
                A child who explores with confidence at two asks better questions at five.
              </h2>
            </div>

            {/* Right — the narrative */}
            <div className="space-y-5 text-slate-600 leading-relaxed text-[15px] md:text-base lg:pt-2">
              <p>
                How a child plays. How they are spoken to. How their curiosity
                is received. It all compounds — quietly, relentlessly — into
                the person they become.
              </p>
              <p>
                The first five years are not preparation for life. They are the
                most formative stretch of it. The patterns laid down here shape
                how a child learns, how they relate to others, how they see
                themselves.
              </p>
              <p className="text-slate-900 font-medium">
                The people who care for a child during this time are among the
                most important people in that child&apos;s life.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ THE CARE ═══ */}
      <section className="py-20 md:py-32 bg-slate-50">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-2xl mx-auto space-y-6 text-slate-600 leading-relaxed text-[15px] md:text-base">
            <p>
              Structured play that builds towards something. Milestones
              noticed, not just waited for. A carer who sees your child — not
              as a routine, but as a person becoming.
            </p>
            <p>
              This is what it looks like when the care is right. The child
              is calmer. More curious. More willing to try. Not because
              anyone is pushing — because the environment makes growth feel
              natural.
            </p>
            <p className="text-slate-900 font-medium">
              Everything starts here.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ BRIDGE + CTA ═══ */}
      <section className="py-24 md:py-36">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl">
            <div className="w-10 h-1 bg-violet-500 rounded-full mb-8" />
            <p className="text-2xl md:text-3xl lg:text-[2.125rem] font-bold text-slate-900 leading-snug tracking-tight">
              The right care changes everything.
            </p>
            <p className="mt-3 text-lg md:text-xl text-slate-400 leading-relaxed">
              Forever.
            </p>
            <div className="mt-10">
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

      {/* ═══ NANNY CTA ═══ */}
      <section className="py-8 border-t border-slate-100">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
            <p className="text-sm text-slate-500">
              Childcare professional?
            </p>
            <Link
              href="/apply"
              className="text-sm font-medium text-violet-600 hover:text-violet-700 transition-colors inline-flex items-center gap-1"
            >
              Apply here
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
