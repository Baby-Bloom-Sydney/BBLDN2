import { getPublicBsrProfile } from "@/lib/actions/babysitting";
import { BsrJobView } from "./BsrJobView";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { BRAND, SITE_NAME, SITE_URL } from "@/lib/constants";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const { data: bsr } = await getPublicBsrProfile(params.id);

  if (!bsr) {
    return { title: `Job Not Found | ${SITE_NAME}` };
  }

  const suburb = bsr.suburb ?? BRAND.city;
  const dateStr = bsr.time_slots.length > 0
    ? formatDate(bsr.time_slots[0].slot_date)
    : "";
  const surname = bsr.parent_last_name ?? bsr.parent_first_name;
  const title = `The ${surname} family needs an experienced babysitter | apply now`;
  const description = dateStr
    ? `Babysitter needed in ${suburb} on ${dateStr}. $${bsr.hourly_rate ?? 40}/hr. Apply on ${SITE_NAME}.`
    : `Babysitter needed in ${suburb}. $${bsr.hourly_rate ?? 40}/hr. Apply on ${SITE_NAME}.`;

  const siteUrl = SITE_URL;
  const ogImageUrl = `${siteUrl}/api/og/babysitting/${params.id}`;
  const pageUrl = `${siteUrl}/babysitting/${params.id}`;

  return {
    title,
    description,
    openGraph: {
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

export default async function BsrPublicPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: bsr, error } = await getPublicBsrProfile(params.id);

  if (error || !bsr) {
    notFound();
  }

  return <BsrJobView bsr={bsr} />;
}
