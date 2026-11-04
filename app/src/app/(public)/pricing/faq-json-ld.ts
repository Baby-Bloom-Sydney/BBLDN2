/**
 * The pricing page's FAQ as structured data for search engines. The babysitting question shows only while
 * `BABYSITTING_ENABLED` is "true" (brief 12 B4; P-23 hide, not delete), read on the server at render.
 */
import { BRAND, HOURLY_RATE_BOUNDS, SITE_NAME } from "@/lib/constants";
import { babysittingEnabled } from "@/lib/features/flags";

interface FaqQuestion {
  readonly "@type": "Question";
  readonly name: string;
  readonly acceptedAnswer: { readonly "@type": "Answer"; readonly text: string };
}

const BABYSITTING_QUESTION: FaqQuestion = {
  "@type": "Question",
  name: "Can I find a babysitter for a one-off job?",
  acceptedAnswer: {
    "@type": "Answer",
    text: "Yes. Baby Bloom's babysitting request feature lets you post a one-off job and get matched with available, verified babysitters in your area within minutes.",
  },
};

const BASE_QUESTIONS: readonly FaqQuestion[] = [
  {
    "@type": "Question",
    name: `How much does a nanny cost in ${BRAND.city}?`,
    acceptedAnswer: {
      "@type": "Answer",
      // The one rate bound, read from config (Q-1 / Q-7). The old copy
      // carried a second, separately-invented casual range; it is not
      // reproduced because nothing sources it.
      text: `Nanny rates in ${BRAND.city} typically range from £${HOURLY_RATE_BOUNDS.min} to £${HOURLY_RATE_BOUNDS.max} per hour. Rates vary by experience, qualifications, and location.`,
    },
  },
  {
    "@type": "Question",
    // [LEGAL] marketing claim (3g, LEDGER/3g.md legal section)
    name: 'Are Baby Bloom nannies DBS checked?',
    acceptedAnswer: {
      "@type": "Answer",
      text: `Yes. Every nanny on ${SITE_NAME} holds an enhanced DBS certificate, checked with the DBS Update Service, and completes identity verification before families can book her.`,
    },
  },
  {
    "@type": "Question",
    name: 'How does the nanny matching process work?',
    acceptedAnswer: {
      "@type": "Answer",
      text: "Create a position describing your family's needs, and Baby Bloom matches you with verified nannies based on availability, location, experience, and qualifications. You can then request a meet and greet with your top matches.",
    },
  },
];

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: babysittingEnabled() ? [...BASE_QUESTIONS, BABYSITTING_QUESTION] : [...BASE_QUESTIONS],
  } as const;
}
