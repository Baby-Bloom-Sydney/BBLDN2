import { ImageResponse } from "next/og";
import { getPublicBsrProfile } from "@/lib/actions/babysitting";
import { BRAND } from "@/lib/constants";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { data: bsr } = await getPublicBsrProfile(params.id);

  if (!bsr) {
    return new Response("Babysitting request not found", { status: 404 });
  }

  const suburb = bsr.suburb ?? BRAND.city;
  const rate = bsr.hourly_rate ? `$${bsr.hourly_rate}/hr` : "";
  const childCount = bsr.children.length;
  const childLabel = childCount === 1 ? "1 child" : `${childCount} children`;
  const refCode = params.id.slice(-5);

  // Fetch Inter Bold font
  const fontData = await fetch(
    "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
  ).then((res) => res.arrayBuffer());

  const response = new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          position: "relative",
          display: "flex",
          overflow: "hidden",
          backgroundColor: "white",
        }}
      >
        {/* Background curves */}
        <svg
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630 }}
        >
          <path d="M0 630 L0 625 C300 620, 600 610, 800 570 C950 535, 1050 460, 1120 340 C1160 265, 1185 150, 1200 0 L1200 630 Z" fill="#DDD6FE" />
          <path d="M0 630 L0 628 C350 625, 650 618, 840 585 C980 555, 1070 490, 1135 380 C1170 310, 1190 200, 1200 70 L1200 630 Z" fill="#E9D5FF" />
          <path d="M0 630 L0 630 C400 628, 700 624, 880 598 C1010 572, 1090 515, 1150 420 C1180 355, 1195 250, 1200 140 L1200 630 Z" fill="#F3E8FF" />
          <path d="M0 630 C450 630, 750 628, 920 610 C1040 595, 1110 545, 1165 460 C1190 400, 1198 300, 1200 210 L1200 630 Z" fill="#FAF5FF" />
        </svg>

        {/* Main content */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            width: "100%",
            height: "100%",
            paddingLeft: 80,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Babysitter Needed! */}
            <div style={{ display: "flex", fontSize: 110, fontWeight: 700, lineHeight: 1.05, color: "#0f172a" }}>
              Babysitter
            </div>
            <div style={{ display: "flex", fontSize: 110, fontWeight: 700, lineHeight: 1.05, color: "#0f172a", marginTop: 4 }}>
              Needed!
            </div>

            {/* Suburb */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 32, fontSize: 54, fontWeight: 700, color: "#8B5CF6" }}>
              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {suburb}
            </div>

            {/* Details row */}
            <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 20, fontSize: 34, fontWeight: 600, color: "#64748b" }}>
              {rate && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {rate}
                </div>
              )}
              {rate && childCount > 0 && (
                <div style={{ display: "flex", color: "#cbd5e1" }}>|</div>
              )}
              {childCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {childLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reference code */}
        <div
          style={{
            position: "absolute",
            bottom: 52,
            right: 16,
            display: "flex",
            fontSize: 24,
            fontWeight: 700,
            color: "#94a3b8",
            letterSpacing: 1,
          }}
        >
          {refCode}
        </div>

        {/* BabyBloom Logo */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 12,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700, display: "flex" }}>
            <span style={{ color: "#0f172a", display: "flex" }}>Baby</span>
            <span style={{ color: "#8B5CF6", display: "flex" }}>Bloom</span>
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    }
  );

  response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return response;
}
