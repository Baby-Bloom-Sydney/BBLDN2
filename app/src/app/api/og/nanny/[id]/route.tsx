import { ImageResponse } from "next/og";
import { getPublicNannyProfile } from "@/lib/actions/nanny";
import sharp from "sharp";
import { BRAND } from "@/lib/constants";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { data: nanny } = await getPublicNannyProfile(params.id);

  if (!nanny) {
    return new Response("Nanny not found", { status: 404 });
  }

  const suburb = nanny.suburb ?? BRAND.city;
  const profilePicUrl = nanny.profile_picture_url;

  // Fetch profile picture and use sharp to auto-rotate based on EXIF orientation
  let profilePicSrc: string | null = null;
  if (profilePicUrl) {
    try {
      const res = await fetch(profilePicUrl);
      const buffer = await res.arrayBuffer();
      const rotated = await sharp(Buffer.from(buffer))
        .rotate() // auto-rotate based on EXIF orientation
        .png()
        .toBuffer();
      const base64 = rotated.toString("base64");
      profilePicSrc = `data:image/png;base64,${base64}`;
    } catch {
      // Fall back to no image
    }
  }

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
        {/* Background: Exponential Growth Layers */}
        <svg
          viewBox="0 0 1200 630"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
          }}
        >
          <path
            d="M0 630 L0 625 C300 620, 600 610, 800 570 C950 535, 1050 460, 1120 340 C1160 265, 1185 150, 1200 0 L1200 630 Z"
            fill="#DDD6FE"
          />
          <path
            d="M0 630 L0 628 C350 625, 650 618, 840 585 C980 555, 1070 490, 1135 380 C1170 310, 1190 200, 1200 70 L1200 630 Z"
            fill="#E9D5FF"
          />
          <path
            d="M0 630 L0 630 C400 628, 700 624, 880 598 C1010 572, 1090 515, 1150 420 C1180 355, 1195 250, 1200 140 L1200 630 Z"
            fill="#F3E8FF"
          />
          <path
            d="M0 630 C450 630, 750 628, 920 610 C1040 595, 1110 545, 1165 460 C1190 400, 1198 300, 1200 210 L1200 630 Z"
            fill="#FAF5FF"
          />
        </svg>

        {/* Profile Photo + Text */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            width: "100%",
            height: "100%",
            paddingLeft: 5,
          }}
        >
          {/* Profile Picture */}
          {profilePicSrc ? (
            <img
              src={profilePicSrc}
              width={620}
              height={620}
              style={{
                width: 620,
                height: 620,
                borderRadius: "50%",
                border: "16px solid #DDD6FE",
                objectFit: "cover",
                flexShrink: 0,
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              }}
            />
          ) : (
            <div
              style={{
                width: 620,
                height: 620,
                borderRadius: "50%",
                border: "16px solid #DDD6FE",
                backgroundColor: "#F3E8FF",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="200"
                height="200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="1.5"
              >
                <path d="M9 12h.01" />
                <path d="M15 12h.01" />
                <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
                <path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
              </svg>
            </div>
          )}

          {/* Text */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginLeft: 20,
              marginBottom: 160,
              gap: 0,
            }}
          >
            {/* Verified + Shield */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 84,
                fontWeight: 700,
                lineHeight: 1,
                color: "#16a34a",
              }}
            >
              verified
              <svg
                width="90"
                height="90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#16a34a"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>

            {/* nanny */}
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                lineHeight: 1,
                color: "#0f172a",
              }}
            >
              nanny
            </div>
            {/* babysitter */}
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                lineHeight: 1,
                color: "#0f172a",
                marginTop: 4,
              }}
            >
              babysitter
            </div>
          </div>
        </div>

        {/* Suburb */}
        <div
          style={{
            position: "absolute",
            top: 400,
            left: 645,
            display: "flex",
            fontSize: 32,
            fontWeight: 600,
            lineHeight: 1,
            color: "#0f172a",
            opacity: 0.33,
          }}
        >
          {suburb}, {BRAND.city}
        </div>

        {/* BabyBloom Logo */}
        <div
          style={{
            position: "absolute",
            bottom: 6,
            right: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8B5CF6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 12h.01" />
            <path d="M15 12h.01" />
            <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
            <path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
          </svg>
          <span
            style={{
              fontSize: 30,
              fontWeight: 700,
              display: "flex",
            }}
          >
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
