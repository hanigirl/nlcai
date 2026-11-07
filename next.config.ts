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
      // Frankfurt (eu-central-1) is the project's home since 2026-11; Tokyo
      // stays listed for any link that still points at the old project.
      { hostname: "fdinwqwujcahsoamcxqk.supabase.co" },
      { hostname: "mwogbieylrteorftphhi.supabase.co" },
    ],
  },
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static", "puppeteer-core", "@sparticuz/chromium"],
  // The story video route spawns the ffmpeg-static binary at runtime. Next's
  // file tracer doesn't follow a binary loaded via a path string, so include
  // it explicitly or it's missing from the serverless bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/story/generate-video-media": ["./node_modules/ffmpeg-static/ffmpeg"],
    // Talking-head transcript: the audio is pulled out with ffmpeg first.
    "/api/talking-head/transcribe": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/talking-head/edit": ["./node_modules/ffmpeg-static/ffmpeg","./node_modules/@sparticuz/chromium/bin/**"],
    "/api/talking-head/captions": ["./node_modules/ffmpeg-static/ffmpeg","./node_modules/@sparticuz/chromium/bin/**"],
    "/api/talking-head/plan": ["./node_modules/ffmpeg-static/ffmpeg","./node_modules/@sparticuz/chromium/bin/**"],
    // The b-roll renders Opus's animation in a headless Chromium and encodes
    // with ffmpeg; both ship as files the tracer can't see.
    "/api/b-roll/generate-media": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/b-roll/edit": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    // The AI carousel lays its slides out in HTML and screenshots them.
    "/api/carousel/generate-ai": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/media/ai-edit": ["./node_modules/@sparticuz/chromium/bin/**"],
    // Her own video: animated caption layer (Chromium) composited with ffmpeg.
    "/api/media/own-edit": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    // Carousel video slide: 4:5 pad + optional animated caption.
    "/api/carousel/video-slide": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  typescript: { ignoreBuildErrors: true },
  // Who may show the app inside a frame: the app itself and Phebe (Hani's
  // dashboard, in production and on her Mac) — for Phebe's live demo
  // (lib/phebe-demo.ts, keep the two lists together). Until now any site
  // could frame it; with the demo's SameSite=None sign-in that would be a
  // clickjacking risk, so the list is closed rather than left open.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://phebe-dashboard.vercel.app http://localhost:* http://127.0.0.1:*",
          },
        ],
      },
    ]
  },
};

export default nextConfig;
