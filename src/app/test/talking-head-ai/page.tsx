"use client"

/**
 * State preview for the talking head AI edit (Notion: "עריכת דיבור למצלמה,
 * עריכה עם כתוביות, שפה ויזואלית שלהם", Hani 2026-11-07). The live version is
 * /project on a real post (Hani + Nataliya only); this page shows every state
 * from sample data — no fetches of hers, no DB writes, no credits. Hani picked
 * the direction where ✨ on the video opens the AI panel on three chips:
 * רק כתוביות / כתוביות + אלמנטים תומכים / לכתוב בעצמי.
 *
 *   ?state=
 *     media          — the media tab: the video + "יצירת קאבר" (default),
 *                      she has cover settings / examples
 *     media-nocover  — no cover settings: "Rubik על רקע שחור" + a link
 *     media-brand    — no cover settings, a brand colour: "Rubik על רקע צבע המותג שלכם"
 *     panel          — the AI panel open on the ways in
 *     plan           — "כתוביות + אלמנטים תומכים": the plan to approve first
 *     done           — after an edit: "לשמור כתבנית לסרטוני דיבור למצלמה"
 *     cover          — the cover made: its preview + "ליצור מחדש"
 *     reminder       — תזמון tab with no cover: the reminder before approving
 *     settings       — Settings → מדיה → העדפות ויזואליות → דיבור למצלמה: her
 *                      template, editable (sample text; saving needs a login)
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaPanelFrame } from "@/components/media-panel"
import { MediaAiChat, type ChatMessage } from "@/components/media-ai-chat"
import {
  FormatPanelMedia,
  FormatPanelSchedule,
  FormatPanelScheduleFooter,
  FormatPanelTabs,
  type FormatPanelTab,
} from "@/components/format-cards/format-cards"
import {
  SAMPLE_TH_PLAN,
  TH_EDIT_MODES,
  TalkingHeadCoverAction,
  TalkingHeadCoverDone,
  TalkingHeadCoverReminder,
  TalkingHeadTemplateSettings,
} from "@/components/talking-head-ai"

const STATES = [
  { id: "media", label: "טאב מדיה · יש הגדרות קאבר" },
  { id: "media-nocover", label: "טאב מדיה · בלי הגדרות קאבר" },
  { id: "media-brand", label: "טאב מדיה · בלי הגדרות, עם צבע מותג" },
  { id: "panel", label: "פאנל AI · דרכי העריכה" },
  { id: "plan", label: "תוכנית לפני עריכה" },
  { id: "done", label: "אחרי עריכה · שמירה כתבנית" },
  { id: "cover", label: "הקאבר נוצר" },
  { id: "reminder", label: "תזמון · תזכורת קאבר" },
  { id: "settings", label: "הגדרות · דיבור למצלמה" },
] as const
type StateId = (typeof STATES)[number]["id"]

const VIDEO = "/images/test/carousel-video-slide.mp4"
const COVER = "/images/carousel-templates/ai-dark.png"
const INTRO =
  "זה הסרטון שלכם, אז מה שצילמתם נשאר בדיוק כמו שהוא. איך לערוך אותו? אפשר לבחור, או לכתוב במילים שלכם מה להוסיף."
const PLUS = TH_EDIT_MODES.find((m) => m.id === "captions_plus")!.request
const DONE = "בגרסה המלאה הסרטון יחזור כאן עם מה שביקשתם, ומה שצילמתם לא ישתנה. (תצוגת עיצוב: עוד לא נערך סרטון.)"

function seededChat(state: StateId): ChatMessage[] | undefined {
  if (state === "plan")
    return [
      { role: "assistant", content: INTRO },
      { role: "user", content: PLUS },
      { role: "assistant", content: "לפני שאני עורכת, זה מה שאדגיש בסרטון:", thPlan: SAMPLE_TH_PLAN },
    ]
  if (state === "done")
    return [
      { role: "assistant", content: INTRO },
      { role: "user", content: TH_EDIT_MODES[0].request },
      { role: "assistant", content: DONE, noStyle: true, thTemplate: TH_EDIT_MODES[0].request },
    ]
  return undefined
}

function Page() {
  const params = useSearchParams()
  const state: StateId = STATES.find((s) => s.id === params.get("state"))?.id ?? "media"
  const [tab, setTab] = useState<FormatPanelTab>(state === "reminder" ? "schedule" : "media")
  const [panelOpen, setPanelOpen] = useState(state === "panel" || state === "plan" || state === "done")
  const [cover, setCover] = useState<string | null>(state === "cover" ? COVER : null)
  const [approved, setApproved] = useState(false)
  const hasSettings = state !== "media-nocover" && state !== "media-brand"
  const href = (s: StateId) => `/test/talking-head-ai?state=${s}`
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      on ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`

  const mediaBody = (
    <div className="flex flex-col gap-4 px-6 py-5">
      <FormatPanelMedia
        fid="talking_head"
        media={{ kind: "video", url: VIDEO }}
        onOpenMedia={() => {}}
        onAiEditMedia={() => setPanelOpen(true)}
        onDeleteMedia={() => {}}
      />
      {cover ? (
        <TalkingHeadCoverDone image={cover} onRemake={() => setCover(COVER)} />
      ) : (
        <TalkingHeadCoverAction
          hasCoverSettings={hasSettings}
          brandBackground={state === "media-brand"}
          onCreate={() => setCover(COVER)}
        />
      )}
    </div>
  )

  const scheduleFooter = cover || approved ? (
    <FormatPanelScheduleFooter
      fid="talking_head"
      approval={{ status: approved ? "approved" : "pending", onApprove: () => setApproved(true), onRevoke: () => setApproved(false) }}
    />
  ) : (
    <TalkingHeadCoverReminder onCreate={() => setCover(COVER)} onApproveWithout={() => setApproved(true)} />
  )

  if (state === "settings") {
    return (
      <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
          {STATES.map((s) => (
            <Link key={s.id} href={href(s.id)} className={pill(s.id === state)}>
              {s.label}
            </Link>
          ))}
        </div>
        <div className="max-w-[560px] rounded-2xl border border-border-neutral-default bg-white p-6 dark:bg-gray-10">
          <TalkingHeadTemplateSettings initial={TH_EDIT_MODES[1].request} />
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex max-w-[60%] flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={href(s.id)} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
      </div>

      <MediaPanelFrame
        open
        title="דיבור למצלמה"
        onClose={() => {}}
        tabs={<FormatPanelTabs value={tab} onChange={setTab} done={{ script: true, media: true }} />}
        footer={tab === "schedule" ? <div className="p-4">{scheduleFooter}</div> : undefined}
      >
        {tab === "schedule" ? (
          <div className="px-6 py-5">
            <FormatPanelSchedule fid="talking_head" hasMedia onGoToMedia={() => setTab("media")} />
          </div>
        ) : (
          mediaBody
        )}
      </MediaPanelFrame>

      {panelOpen && (
        <MediaAiChat
          key={state}
          postId={`test-talking-head-${state}`}
          format="talking_head"
          own
          open
          currentUrls={[VIDEO]}
          initialMessages={seededChat(state)}
          onOpenChange={(open) => {
            if (!open) {
              setPanelOpen(false)
            }
          }}
          onUpdated={() => {}}
        />
      )}
    </div>
  )
}

export default function TalkingHeadAiTestPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  )
}
