/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // strict: build fails on TS errors
    ignoreBuildErrors: false,
  },
  async redirects() {
    return [
      { source: '/signup/nanny', destination: '/apply/nanny', permanent: true },
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
