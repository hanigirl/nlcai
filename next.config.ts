import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      { hostname: "files2.heygen.ai" },
      { hostname: "resource2.heygen.ai" },
    ],
  },
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static"],
  // The story video route spawns the ffmpeg-static binary at runtime. Next's
  // file tracer doesn't follow a binary loaded via a path string, so include
  // it explicitly or it's missing from the serverless bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/story/generate-video-media": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
