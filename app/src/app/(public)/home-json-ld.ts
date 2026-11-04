/**
 * The home page's service description as structured data for search engines. Babysitting appears only while
 * `BABYSITTING_ENABLED` is "true" (brief 12 B2, B3; P-23 hide, not delete), read on the server at render.
 */
import { BRAND, SITE_NAME, SITE_URL } from "@/lib/constants";
import { babysittingEnabled } from "@/lib/features/flags";

interface Offer {
  readonly "@type": "Offer";
  readonly itemOffered: { readonly "@type": "Service"; readonly name: string; readonly description: string };
}

const offer = (name: string, description: string): Offer => ({
  "@type": "Offer",
  itemOffered: { "@type": "Service", name, description },
});

const BABYSITTING_OFFER = offer("Casual Babysitting", "On-demand babysitting from verified sitters in your area");

const BASE_OFFERS: readonly Offer[] = [
  offer("Permanent Nanny Matching", "Find a verified permanent nanny matched to your family's needs"),
  offer("Part-Time Nanny Matching", `Flexible part-time nanny arrangements for ${BRAND.city} families`),
  offer("After-School Care", "Verified nannies for school pickups and after-school care"),
];

export function serviceJsonLd() {
  const babysitting = babysittingEnabled();
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Verified Nanny Matching — ${BRAND.city}`,
    serviceType: "Nanny and Childcare Matching Service",
    description: `Baby Bloom matches ${BRAND.city} families with background-checked, ID-verified ${
      babysitting ? "nannies and babysitters" : "nannies"
    }.`,
    provider: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    areaServed: {
      "@type": "City",
      name: BRAND.city,
      addressRegion: "England",
      addressCountry: BRAND.countryCode,
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Childcare Services",
      // Today's order: the babysitting offer sits third when it shows.
      itemListElement: babysitting
        ? [...BASE_OFFERS.slice(0, 2), BABYSITTING_OFFER, ...BASE_OFFERS.slice(2)]
        : [...BASE_OFFERS],
    },
  } as const;
}
