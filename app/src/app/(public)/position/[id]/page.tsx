import { getPublicPositionProfile } from "@/lib/actions/matching";
import { PositionJobView } from "./PositionJobView";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import { BRAND, OG_LOCALE, SITE_NAME, SITE_URL } from "@/lib/constants";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const { data: position } = await getPublicPositionProfile(params.id);

  if (!position) {
    return { title: `Job Not Found | ${SITE_NAME}` };
  }

  const suburb = position.suburb ?? BRAND.city;
  const isAdmin = position.source && position.source !== "parent";
  const familyLabel = isAdmin
    ? position.parentFirstName
    : `The ${position.parentLastName ?? position.parentFirstName} family`;
  const title = `${familyLabel} is looking for a nanny | apply now`;
  const daysStr = position.daysRequired?.join(", ") ?? "";
  const hoursStr = position.hoursPerWeek
    ? `${position.hoursPerWeek} hrs/wk.`
    : "";
  const description = [
    `Nanny needed in ${suburb}.`,
    daysStr ? `${daysStr}.` : "",
    hoursStr,
    `Apply on ${SITE_NAME}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const siteUrl = SITE_URL;
  const ogImageUrl = `${siteUrl}/api/og/position/${params.id}`;
  const pageUrl = `${siteUrl}/position/${params.id}`;

  return {
    title,
    description,
    openGraph: {
      locale: OG_LOCALE,
      title,
      description,
      type: "website",
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

export default async function PositionPublicPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: position, error } = await getPublicPositionProfile(params.id);

  if (error || !position) {
    notFound();
  }

  // Server-side hydration of viewer state. Bailey 2026-05-19 amendment 5 +
  // [[feedback_layout_primitives_url_not_auth]]: client-side `useAuth()` flashes
  // unauthenticated UI before the session resolves (banner persistence bug).
  // We resolve role + nanny-level server-side here and pass them down as props
  // so the gates render correctly on first paint.
  let viewerRole: "nanny" | "parent" | "guest" = "guest";
  let nannyVerificationLevel: number | null = null;
  let alreadyApplied = false;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const admin = createAdminClient();

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleRow?.role === "nanny" || roleRow?.role === "parent") {
      // Cast narrows the Supabase-generated `string` to the literal union.
      // typescript-reviewer 2026-05-19.
      viewerRole = roleRow.role as "nanny" | "parent";
    }

    if (viewerRole === "nanny") {
      const { data: nanny } = await admin
        .from("nannies")
        .select("id, verification_level")
        .eq("user_id", user.id)
        .maybeSingle();

      if (nanny) {
        nannyVerificationLevel = nanny.verification_level ?? 0;

        const { data: existing } = await admin
          .from("connection_requests")
          .select("id")
          .eq("nanny_id", nanny.id)
          .eq("position_id", params.id)
          .eq("connection_stage", CONNECTION_STAGE.NANNY_APPLIED)
          .limit(1);

        alreadyApplied = !!(existing && existing.length > 0);
      }
    }
  }

  return (
    <PositionJobView
      position={position}
      alreadyApplied={alreadyApplied}
      viewerRole={viewerRole}
      nannyVerificationLevel={nannyVerificationLevel}
    />
  );
}
