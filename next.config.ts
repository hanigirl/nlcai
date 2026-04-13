import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      { hostname: "files2.heygen.ai" },
      { hostname: "resource2.heygen.ai" },
    ],
  },
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
