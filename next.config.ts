import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      { hostname: "files2.heygen.ai" },
      { hostname: "resource2.heygen.ai" },
      // Our own storage bucket. Without this entry next/image refuses the
      // host and every preview falls back to a raw <img> — which meant a
      // 200px slot downloading the full 1080x1920 PNG the generator saved
      // (~2.3MB) instead of a resized WebP (~tens of KB). Supabase's own
      // image transformation would do the same job, but it's a paid add-on
      // and returns FeatureNotEnabled on this project.
      { hostname: "mwogbieylrteorftphhi.supabase.co" },
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
