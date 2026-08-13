import { GeminiConnectNoticeCard } from "@/components/gemini-connect-notice"
import { FloatingNoticePreview } from "./floating-preview"

/**
 * Preview of the Gemini connect notice, exactly as a pilot user without a key
 * sees it. Renders the card unconditionally — reviewing it otherwise means
 * logging in as someone who is in the cohort and has no key connected.
 *
 * `?v=floating` previews the pinned /project variant on a dotted canvas, since
 * a fixed element can't be shown inline next to the banner.
 *
 * Same purpose as the other /test/* routes in this app.
 */
export default async function GeminiNoticePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; close?: string; state?: string }>
}) {
  const { v, close, state } = await searchParams

  if (v === "floating") {
    return (
      <div className="min-h-screen bg-bg-surface" dir="rtl">
        {/* Stand-ins for the real page chrome, so the pinned offsets can be
            judged against something: h-14 header, 3rem collapsed rail. */}
        <div className="sticky top-0 z-50 h-14 border-b border-border-neutral-default bg-white flex items-center px-4">
          <span className="text-small text-text-neutral-default">כותרת המסך</span>
        </div>
        <div className="fixed top-0 right-0 h-full w-12 border-l border-border-neutral-default bg-white" />
        <div
          className="h-[calc(100vh-3.5rem)] bg-bg-surface"
          style={{
            backgroundImage: "radial-gradient(circle, #d4d4d4 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <FloatingNoticePreview close={close} state={state} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-surface p-10" dir="rtl">
      <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-3">
        <span className="text-xs-body text-text-neutral-default">
          banner — /hooks, דף הבית
        </span>
        <GeminiConnectNoticeCard />
      </div>
    </div>
  )
}
