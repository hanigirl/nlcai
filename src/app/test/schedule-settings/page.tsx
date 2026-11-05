"use client"

import { useState } from "react"
import { ScheduleSettingsForm } from "@/components/schedule-settings-form"
import { defaultPostingSchedule } from "@/lib/posting-schedule"

/** Review page: the schedule settings form on sample data, nothing saved. */
export default function ScheduleSettingsTestPage() {
  const [draft, setDraft] = useState(defaultPostingSchedule)
  return (
    <main dir="rtl" className="mx-auto max-w-3xl p-8">
      <ScheduleSettingsForm draft={draft} onChange={setDraft} />
    </main>
  )
}
