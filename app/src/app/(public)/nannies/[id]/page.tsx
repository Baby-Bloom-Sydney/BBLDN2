import { getPublicNannyProfile } from "@/lib/actions/nanny";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_CONNECTION_STAGES } from "@/lib/position/constants";
import { ParentNannyProfileView } from "@/app/parent/browse/[id]/ParentNannyProfileView";
import { parseFunnelSource, parseFunnelLead } from "@/lib/funnel/source";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { BRAND, OG_LOCALE, SITE_NAME, SITE_URL } from "@/lib/constants";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const { data: nanny } = await getPublicNannyProfile(params.id);

  if (!nanny) {
    return { title: `Nanny Not Found | ${SITE_NAME}` };
  }

  const firstName = nanny.first_name ?? "Nanny";
  const title = `${firstName} now has availability to Nanny & Babysit | see availability now`;

  // Use AI bio summary or fallback
  const suburb = nanny.suburb ?? BRAND.city;
  const bioSummary = nanny.ai_content?.bio_summary;
  const bioAbout =
    typeof bioSummary === "object" && bioSummary !== null
      ? (bioSummary as Record<string, string>).about
      : null;
  const bioRaw =
    bioAbout ?? (nanny.ai_content?.parent_pitch as string | undefined) ?? "";
  const description =
    String(bioRaw)
      .replace(/<[^>]*>/g, "") // strip HTML tags
      .slice(0, 155)
      .trim() ||
    `Find a verified, trusted nanny in ${suburb} on ${SITE_NAME}.`;

  const siteUrl = SITE_URL;
  const ogImageUrl = `${siteUrl}/api/og/nanny-v2/${params.id}`;
  const pageUrl = `${siteUrl}/nannies/${params.id}`;

  return {
    title,
    description,
    alternates: { canonical: `/nannies/${params.id}` },
    openGraph: {
      locale: OG_LOCALE,
      title,
      description,
      type: "profile",
      url: pageUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    other: {
      "fb:app_id": "4009164676060901",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function NannyProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    from?: string;
    src?: string | string[];
    lead?: string | string[];
  };
}) {
  const funnelSource = parseFunnelSource(searchParams.src);
  const funnelLead = parseFunnelLead(searchParams.lead);
  const hidePromoTile =
    searchParams.from === "matchmaking" ||
    searchParams.from === "onboarding" ||
    funnelSource === "std" ||
    funnelSource === "adv";
  const { data: nanny, error } = await getPublicNannyProfile(params.id);

  if (error || !nanny) {
    notFound();
  }

  // Check auth state for connect button logic
  let isOwner = false;
  let isParent = false;
  let isGuest = true;
  let pendingRequestCount = 0;
  let existingRequestStatus: string | null = null;
  let hasActivePlacement = false;
  let isActiveNanny = false;

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      isGuest = false;
      if (user.id === nanny.user_id) {
        isOwner = true;
      } else {
        // Check if user is a parent
        const { data: role } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (role?.role === "parent") {
          isParent = true;

          // Look up parent table ID (connection_requests.parent_id = parents.id, NOT auth.users.id)
          const adminClient = createAdminClient();
          const { data: parentRecord } = await adminClient
            .from("parents")
            .select("id")
            .eq("user_id", user.id)
            .single();

          if (parentRecord) {
            // Count pending connection requests
            const { count } = await adminClient
              .from("connection_requests")
              .select("id", { count: "exact", head: true })
              .eq("parent_id", parentRecord.id)
              .eq("status", "pending");

            pendingRequestCount = count ?? 0;

            // Check existing request with this nanny (exclude terminal stages)
            const { data: existing } = await adminClient
              .from("connection_requests")
              .select("status, connection_stage")
              .eq("parent_id", parentRecord.id)
              .eq("nanny_id", nanny.nanny_id)
              .in("status", ["pending", "accepted", "confirmed"])
              .not(
                "connection_stage",
                "in",
                `(${HIDDEN_CONNECTION_STAGES.join(",")})`,
              )
              .limit(1)
              .maybeSingle();

            existingRequestStatus = existing?.status ?? null;

            // Check if parent has any active placement
            const { data: activePlacement } = await adminClient
              .from("nanny_placements")
              .select("id, nanny_id")
              .eq("parent_id", parentRecord.id)
              .eq("status", "active")
              .limit(1)
              .maybeSingle();

            if (activePlacement) {
              hasActivePlacement = true;
              if (activePlacement.nanny_id === nanny.nanny_id) {
                isActiveNanny = true;
              }
            }
          }
        }
      }
    }
  } catch {
    // Not authenticated — that's fine
  }

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: `${nanny.first_name ?? "Nanny"} ${(nanny.last_name ?? "").charAt(0) || ""}.`.trim(),
    jobTitle: "Verified Nanny",
    description:
      String(nanny.ai_content?.parent_pitch ?? "")
        .replace(/<[^>]*>/g, "")
        .slice(0, 200)
        .trim() || undefined,
    image: nanny.profile_picture_url || undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: nanny.suburb ?? BRAND.city,
      addressRegion: "England",
      addressCountry: BRAND.countryCode,
    },
    worksFor: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Nannies",
        item: `${SITE_URL}/nannies`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: nanny.first_name ?? "Nanny",
        item: `${SITE_URL}/nannies/${params.id}`,
      },
    ],
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(personJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <ParentNannyProfileView
        nanny={nanny}
        isOwner={isOwner}
        isParent={isParent}
        isGuest={isGuest}
        pendingRequestCount={pendingRequestCount}
        existingRequestStatus={existingRequestStatus}
        hasActivePlacement={hasActivePlacement}
        isActiveNanny={isActiveNanny}
        hidePromoTile={hidePromoTile}
        funnelSource={funnelSource}
        funnelLead={funnelLead}
      />
    </div>
  );
}
