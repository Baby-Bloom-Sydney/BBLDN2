/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // strict: build fails on TS errors
    ignoreBuildErrors: false,
  },
  async redirects() {
    return [
      // `/apply/nanny` has never existed, so this 404'd (LDN2 Stage 0 finding 1).
      // Every nanny call-to-action in the app points at `/apply`; the old
      // `(auth)/signup/nanny/page.tsx` stays unreachable (un-ported AU form).
      { source: '/signup/nanny', destination: '/apply', permanent: true },
      // `/nanny/apply` sat behind the `/nanny` role prefix match, so it demanded
      // a nanny session to show a page about becoming a nanny (Stage 0 finding 5).
      // Redirected rather than un-gated: next.config redirects run before the
      // middleware, so the gate never sees the path and no prefix match widens.
      { source: '/nanny/apply', destination: '/apply', permanent: true },
      { source: '/nanny/register', destination: '/nanny/profile', permanent: true },
    ];
  },
  experimental: {
    serverComponentsExternalPackages: ["sharp"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "fcngfbbvrcsuwzgqodtn.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "randomuser.me",
        pathname: "/api/portraits/**",
      },
    ],
  },
};

export default nextConfig;
