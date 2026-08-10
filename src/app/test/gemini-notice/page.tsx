import { GeminiConnectNoticeCard } from "@/components/gemini-connect-notice"

/**
 * Preview of the Gemini connect notice in both shapes, exactly as a pilot user
 * without a key sees them. Renders the card unconditionally — reviewing the
 * copy otherwise means logging in as someone who is in the cohort and has no
 * key connected.
 *
 * Same purpose as the other /test/* routes in this app.
 */
export default function GeminiNoticePreviewPage() {
  return (
    <div className="min-h-screen bg-bg-surface p-10 flex flex-col gap-10" dir="rtl">
      <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-3">
        <span className="text-xs-body text-text-neutral-default">
          banner — /hooks, דף הבית
        </span>
        <GeminiConnectNoticeCard />
      </div>

      {/* The /project canvas is dotted, so the card is previewed on the same
          ground it actually lands on. */}
      <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-3">
        <span className="text-xs-body text-text-neutral-default">
          card — מסך עריכת הפוסט
        </span>
        <div className="rounded-xl bg-white dark:bg-gray-10 p-10 border border-border-neutral-default">
          <GeminiConnectNoticeCard variant="card" />
        </div>
      </div>
    </div>
  )
}
