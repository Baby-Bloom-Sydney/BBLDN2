import type { Metadata } from "next";
import { BRAND } from "@/lib/constants";

export const metadata: Metadata = {
  title: 'How Baby Bloom Works — Find a Nanny in 3 Steps',
  description: `See how Baby Bloom matches ${BRAND.city} families with verified nannies. Browse profiles, get matched, and arrange a meet and greet — it's simple.`,
  alternates: { canonical: '/how-it-works' },
};

export default function HowItWorksPage() {
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold">How It Works</h1>
    </div>
  );
}
