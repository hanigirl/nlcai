import { GeminiConnectNoticeCard } from "@/components/gemini-connect-notice"

/**
 * Preview of the Gemini connect notice exactly as a pilot user without a key
 * sees it, sitting in the same 1200px container /hooks uses. Renders the card
 * unconditionally — reviewing the copy otherwise means logging in as someone
 * who is in the cohort and has no key connected.
 *
 * Same purpose as the other /test/* routes in this app.
 */
export default function GeminiNoticePreviewPage() {
  return (
    <div className="min-h-screen bg-bg-surface p-10">
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        <GeminiConnectNoticeCard />
      </div>
    </div>
  )
}
