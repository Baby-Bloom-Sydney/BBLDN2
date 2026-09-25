import type { Metadata } from "next";
import { Mail, Clock, MapPin } from "lucide-react";
import { PublicContactForm } from "@/components/settings/PublicContactForm";
import { BRAND, SENDERS, SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Contact Us — ${SITE_NAME}`,
  description: `Get in touch with ${SITE_NAME}. We help families find verified nannies and help childcare professionals connect with great families.`,
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 lg:px-6 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-slate-900 lg:text-4xl">
          Contact us
        </h1>
        <p className="mt-3 text-base text-slate-600">
          Questions about Baby Bloom, your account, or your verification? Send
          us a message — we typically reply within one business day.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Sidebar — direct channels */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Email
                </p>
                <a
                  href={`mailto:${SENDERS.admin}`}
                  className="mt-0.5 block text-sm font-medium text-slate-900 hover:text-violet-700"
                >
                  {SENDERS.admin}
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Response time
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">
                  Within 1 business day
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Mon–Fri, {BRAND.city} time
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                <MapPin className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Based in
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">
                  {BRAND.city}, {BRAND.country}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Form */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <h2 className="text-lg font-semibold text-slate-900">
            Send a message
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            All fields are required so we can reply to the right person.
          </p>
          <div className="mt-6">
            <PublicContactForm />
          </div>
        </section>
      </div>
    </main>
  );
}
