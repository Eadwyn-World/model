import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TypeScript source; Next compiles them in place.
  transpilePackages: ["@eadwyn/ui", "@eadwyn/shared-protocol", "@eadwyn/federation-sdk"],
};

export default nextConfig;
