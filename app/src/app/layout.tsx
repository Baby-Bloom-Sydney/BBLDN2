import type { Metadata } from "next";
import localFont from "next/font/local";
import {
  APP_LOCALE,
  BRAND,
  OG_LOCALE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/constants";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { VisitorTracker } from "@/components/providers/VisitorTracker";
import { DevToolbar } from "@/components/dev/DevToolbar";
import { DevSidebar } from "@/components/dev/DevSidebar";
import { KatieShell } from "@/components/katie/KatieShell";
import { Analytics } from "@vercel/analytics/next";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import { MiniFooter } from "@/components/layout/MiniFooter";
import Script from "next/script";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";
const isProd = process.env.NODE_ENV === "production";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: `%s | ${SITE_NAME}`,
    default: `${SITE_NAME} — Verified Nannies for ${BRAND.city} Families`,
  },
  description: SITE_DESCRIPTION,
  // Declares the icon links explicitly so Safari stops probing
  // /apple-touch-icon.png + /apple-touch-icon-precomposed.png on
  // every page load (those 404s were cosmetic but cluttered the
  // dev console — Bailey 2026-05-14). Points at the existing
  // favicon + logo so no new assets are required.
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/logo.svg",
  },
  openGraph: {
    siteName: SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    alternateName: "Baby Bloom",
    url: SITE_URL,
    // `logo.png` never existed in `public/` — only `logo.svg` (inventory C 8.13).
    logo: `${SITE_URL}/logo.svg`,
    description: SITE_DESCRIPTION,
    foundingDate: "2020",
    areaServed: {
      "@type": "City",
      name: BRAND.city,
      addressRegion: "England",
      addressCountry: BRAND.countryCode,
    },
    sameAs: [],
  };

  return (
    <html lang={APP_LOCALE} className="overflow-x-hidden">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-x-hidden`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c"),
          }}
        />
        <SessionProvider>
          <VisitorTracker />
          {isDevMode && <DevSidebar />}
          {/* MiniFooter passed as a separate slot so the shell can
              wrap the page content in a flex-grow div above it.
              Result: footer sticks to viewport bottom when the page
              is shorter than the viewport, and sits at the end of
              scrolled content when the page is taller. (Sticky-
              footer pattern, applied globally per user feedback
              2026-05-07.) */}
          <KatieShell footer={<MiniFooter />}>{children}</KatieShell>
          <Analytics />
          <CookieConsentBanner />
          {isDevMode && <DevToolbar />}
        </SessionProvider>
        {isProd && (
          <>
            <Script
              src="https://browser.sentry-cdn.com/8.46.0/bundle.min.js"
              crossOrigin="anonymous"
              strategy="afterInteractive"
            />
            <Script id="sentry-init" strategy="afterInteractive">
              {`
                if (typeof Sentry !== 'undefined') {
                  Sentry.init({
                    dsn: "https://0a45d54c5424e8f1ee27c7143617571f@o4511097907904512.ingest.us.sentry.io/4511097920225280",
                    tracesSampleRate: 0.1,
                  });
                }
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
