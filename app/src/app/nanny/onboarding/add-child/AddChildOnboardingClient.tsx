"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, HeartHandshake, Plus, ShieldCheck, Users } from "lucide-react";
import { AddChildSheet } from "@/components/bapp/AddChildSheet";

// T-022 — Pixel-for-pixel React port of the locked mockup at
// `system/forms/nanny-profile/Updates/Onboarding Flow/mockup/index.html`.
// The mockup is the literal layout contract (Bailey 2026-05-18 explicit
// directive); deviations require a written change to the spec, not a
// coder judgment call. The dev banner + preview-toggle pills from the
// mockup are stripped; the dynamic violet callout that mocked-toggles
// in the HTML is driven here by the `currentlyCaringForU3` prop from
// the server component which reads `nanny_leads.lead_signals.external_u3_position`.

interface AddChildOnboardingClientProps {
  /** TRUE when the nanny IS currently caring for a U3 (action-ready
   * default) or when the signal is missing — the page reads as a
   * normal call to action. FALSE flips the violet "not caring for a
   * child under 3 right now? that's okay" callout under the hero. */
  currentlyCaringForU3: boolean;
}

const VERIFICATION_RESUME_HREF = "/nanny/onboarding-verification?startAt=1";

export function AddChildOnboardingClient({
  currentlyCaringForU3,
}: AddChildOnboardingClientProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div
      className="min-h-screen text-slate-800"
      style={{
        background:
          "radial-gradient(80% 50% at 50% 0%, #f5f3ff 0%, transparent 60%), radial-gradient(60% 40% at 100% 100%, #ecfdf5 0%, transparent 55%), #ffffff",
      }}
    >
      <style>{`
        @keyframes onboardingFadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .reveal {
          opacity: 0;
          animation: onboardingFadeInUp 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .reveal-1 { animation-delay:  60ms; }
        .reveal-2 { animation-delay: 140ms; }
        .reveal-3 { animation-delay: 220ms; }
        .reveal-4 { animation-delay: 300ms; }
        .reveal-5 { animation-delay: 380ms; }
        .reveal-6 { animation-delay: 460ms; }
        .reveal-7 { animation-delay: 540ms; }
        @media (prefers-reduced-motion: reduce) {
          .reveal,
          .reveal-1, .reveal-2, .reveal-3, .reveal-4,
          .reveal-5, .reveal-6, .reveal-7 {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      <main className="relative mx-auto max-w-2xl px-4 lg:px-6 pt-2 pb-32">
        {/* HERO ----------------------------------------------------------- */}
        <section className="flex flex-col items-center gap-5 pt-10 pb-8 text-center">
          <div className="reveal reveal-1 relative">
            <div className="absolute inset-0 -z-10 rounded-full bg-violet-200/60 blur-xl" />
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-emerald-50 ring-1 ring-violet-200">
              <HeartHandshake
                className="text-violet-600"
                size={32}
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="reveal reveal-2 flex flex-col gap-3">
            <h1 className="max-w-lg text-3xl sm:text-[2.4rem] font-bold leading-tight tracking-tight text-slate-900">
              Setup your account so we can contribute!
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-slate-600">
              We contribute up to{" "}
              <span className="font-semibold text-slate-900">£1000</span> to
              you for every child under 3 you look after — to support your work
              developing young minds.
            </p>
          </div>
        </section>

        {/* WHAT TO DO TILE ------------------------------------------------ */}
        <section className="reveal reveal-3 mb-2">
          <div className="rounded-2xl border border-slate-200 bg-violet-50/40 p-4 text-center shadow-sm">
            <p className="mb-1.5 text-sm font-semibold text-slate-800">
              What to do
            </p>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-600">
              Add your existing families to support their children&apos;s
              development, keep parents up to date, and manage your day to day.
            </p>
          </div>
        </section>

        {/* DYNAMIC CALLOUT — only when not currently caring for a U3 ----- */}
        {!currentlyCaringForU3 && (
          <section className="reveal reveal-3 mb-4">
            <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 ring-1 ring-violet-200">
                <Clock size={18} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-slate-900">
                  Not caring for a child under 3 right now? That&apos;s okay.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  This stays open for whenever you are. Have a look around so
                  you know what&apos;s here, and come back whenever you start
                  with a new family.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* WHAT EVERYONE GETS — FOR YOU first, then family ---------------- */}
        <section className="reveal reveal-4 mt-6">
          <h2 className="mb-4 text-center text-lg font-semibold text-slate-800">
            What everyone gets
          </h2>

          <div className="space-y-3">
            {/* FOR YOU — violet emphasis */}
            <article className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50/70 via-white to-emerald-50/40 p-4 shadow-sm">
              <div className="mb-2.5 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                  <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                  What you get
                </p>
              </div>

              <p className="mb-2.5 text-sm leading-snug text-slate-800">
                Full access to the suite of tools to assist your work — and our
                contribution towards it.
              </p>

              <ul className="space-y-1.5">
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-violet-500"
                  />
                  <span>
                    Use of every Baby Bloom tool to support you at work
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900">£100</span>{" "}
                    for every month of continued developmental support with
                    every family you work with
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900">
                      £1,000
                    </span>{" "}
                    for every family that pre-plans for long-term development
                  </span>
                </li>
              </ul>
            </article>

            {/* FAMILY + CHILD — sky accent */}
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2.5 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-100 text-sky-700">
                  <Users size={13} strokeWidth={2} aria-hidden="true" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                  What families get
                </p>
              </div>

              <p className="mb-2.5 text-sm leading-snug text-slate-800">
                Immediate access to Baby Bloom&apos;s full suite of
                developmental services for their child.
              </p>

              <ul className="space-y-1.5">
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      Developmental milestone planning
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      Unlimited activities
                    </span>
                    , custom-made for their child
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">Katie</span>{" "}
                    <span className="align-middle text-[9px] uppercase tracking-wide text-violet-700">
                      beta
                    </span>{" "}
                    — AI for plans, ideas and reports
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      A live feed
                    </span>{" "}
                    of observations, photos and moments
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      A growing developmental journal
                    </span>{" "}
                    of their first three years
                  </span>
                </li>
                <li className="flex items-start gap-2 text-[13px] leading-snug text-slate-700">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-sky-500"
                  />
                  <span>
                    <span className="font-medium text-slate-900">Reports</span>{" "}
                    drafted by Katie
                  </span>
                </li>
              </ul>

              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-800">
                <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
                30-day love-it-or-leave-it guarantee
              </div>
            </article>
          </div>
        </section>

        {/* STEPPER — 4 steps, all at full weight ------------------------- */}
        <section className="reveal reveal-5 mt-8">
          <h2
            id="contributions-stepper-heading"
            className="mb-5 text-center text-lg font-semibold text-slate-800"
          >
            How to get your contributions
          </h2>

          <ol
            className="mx-auto max-w-xs"
            aria-labelledby="contributions-stepper-heading"
          >
            {/* Step 1 — current (violet ring + dot) */}
            <li className="flex items-stretch gap-4" aria-current="step">
              <div aria-hidden="true" className="flex flex-col items-center">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[2.5px] border-violet-500 bg-white">
                  <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                </div>
                <div className="w-0.5 min-h-[28px] flex-1 bg-slate-200" />
              </div>
              <div className="pb-5 text-left">
                <p className="text-sm font-semibold leading-tight text-slate-800">
                  Add Children
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Add children (under 3yrs) in your care
                </p>
              </div>
            </li>

            {/* Step 2 — upcoming (NOT faded) */}
            <li className="flex items-stretch gap-4">
              <div aria-hidden="true" className="flex flex-col items-center">
                <div className="h-8 w-8 shrink-0 rounded-full border-2 border-slate-200 bg-white" />
                <div className="w-0.5 min-h-[28px] flex-1 bg-slate-200" />
              </div>
              <div className="pb-5 text-left">
                <p className="text-sm font-semibold leading-tight text-slate-800">
                  Invite Parent
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Share the private invite link
                </p>
              </div>
            </li>

            {/* Step 3 — upcoming */}
            <li className="flex items-stretch gap-4">
              <div aria-hidden="true" className="flex flex-col items-center">
                <div className="h-8 w-8 shrink-0 rounded-full border-2 border-slate-200 bg-white" />
                <div className="w-0.5 min-h-[28px] flex-1 bg-slate-200" />
              </div>
              <div className="pb-5 text-left">
                <p className="text-sm font-semibold leading-tight text-slate-800">
                  Use Baby Bloom
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Plan, log and observe day-to-day
                </p>
              </div>
            </li>

            {/* Step 4 — upcoming (no connector) */}
            <li className="flex items-stretch gap-4">
              <div aria-hidden="true" className="flex flex-col items-center">
                <div className="h-8 w-8 shrink-0 rounded-full border-2 border-slate-200 bg-white" />
              </div>
              <div className="pb-0 text-left">
                <p className="text-sm font-semibold leading-tight text-slate-800">
                  Get Contributions
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Receive ongoing payouts for doing great work!
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* CTA — dashed emerald empty-state button ----------------------- */}
        <section className="reveal reveal-6 mt-10">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-describedby="add-child-cta-description"
            className="group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-8 shadow-sm transition-all hover:border-emerald-400 hover:bg-emerald-50/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-transform group-hover:scale-105">
              <Plus size={26} strokeWidth={2.2} aria-hidden="true" />
            </div>
            <p className="text-base font-semibold text-slate-900">Add Child</p>
            <p
              id="add-child-cta-description"
              className="max-w-xs text-center text-xs text-slate-500"
            >
              To start supporting their developmental journey.
            </p>
          </button>
        </section>

        {/* Soft escape — kept at smaller scale so it stays subordinate to
            the primary CTA, but bumped to slate-500 + underline so it
            still meets AA contrast and reads as a link affordance. */}
        <div className="reveal reveal-7 mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => router.push(VERIFICATION_RESUME_HREF)}
            className="inline-flex min-h-[24px] items-center justify-center rounded px-3 py-2 text-xs text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            Add child later
          </button>
        </div>
      </main>

      {/* No `successHref` override: when the nanny successfully adds a child
          we want them to land on that child's feed (the default AddChildSheet
          behaviour: /nanny/development/<childId>). Verification is reserved
          for the "Add child later" escape above. */}
      <AddChildSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        hideGuardianCheckbox
        title="Add child to start their journey"
        fromBonusProgram
      />
    </div>
  );
}
