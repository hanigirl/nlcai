"use client"

/**
 * State preview for the schedule settings modal.
 *
 * Route: /test/schedule-settings?variant=a|b[&state=first|empty|error]
 * Public on local dev only (middleware), behind auth in production. Renders
 * the real `ScheduleSettingsDialog`, held open, over an empty page. Saves
 * stay in memory here — nothing is written, nothing is fetched.
 */

import { ScheduleSettingsDialog } from "@/components/schedule-settings"

export default function ScheduleSettingsPreviewPage() {
  return (
    <main dir="rtl" className="min-h-dvh bg-bg-surface">
      {/* Held open: a preview has nothing behind the modal to go back to. */}
      <ScheduleSettingsDialog open onOpenChange={() => {}} persist={false} />
    </main>
  )
}
