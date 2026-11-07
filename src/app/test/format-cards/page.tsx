"use client"

/**
 * State preview for the format cards + script panel (Notion: "שכפול לפורמטים
 * כותב ברקע את הסקריפט…", Hani, 2026-11-07). The live version is /project
 * with `?cards=a|b` on a real post; this page shows every state from sample
 * data. No fetches, no DB writes, no credits.
 *
 *   ?variant=a|b   — A "החלון" (media window, two-screen panel)
 *                    B "הכרטיס" (uniform card, one-scroll panel)
 *   ?state=
 *     row             — every card state side by side (default)
 *     generating      — right after "שכפל!": every script is being written
 *     script          — scripts ready, no media
 *     media           — media on every card (carousel ‹ ›)
 *     panel-generating— panel opened on a card still writing
 *     panel-script    — panel: script + delete + "צור מדיה"
 *     panel-create    — panel after "צור מדיה": the media options
 *     panel-media     — panel: script + media + "אישור הפוסט לתזמון"
 *     panel-approved  — panel: approved, way to the calendar
 *
 * The cards and panel stay interactive: click a card, press "צור מדיה", go
 * back, page the carousel.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronRight, Film, Image as ImageIcon, Layers, Smartphone } from "lucide-react"
import { InfiniteCanvas } from "@/components/infinite-canvas"
import { MediaPanelFrame } from "@/components/media-panel"
import { RichBodyEditor } from "@/components/rich-body-editor"
import { StorySections } from "@/components/story-frames"
import { AI_HOVER_ZONE, AiHoverEditButton } from "@/components/ai-hover-edit"
import { MediaStylePicker } from "@/components/media-style-picker"
import { Button } from "@/components/ui/button"
import {
  FormatCardsRow,
  FormatPanelFooter,
  FormatPanelMedia,
  FormatPanelNextStep,
  FormatPanelSchedule,
  FormatPanelScript,
  FormatPanelTabs,
  type FormatPanelTab,
  FormatPanelScriptFolded,
  type FormatCardItem,
  type FormatCardMedia,
  type FormatCardState,
  type FormatCardsVariant,
} from "@/components/format-cards/format-cards"
import type { ApprovalStatus } from "@/components/format-approval/use-format-approvals"
import { getTemplate } from "@/lib/carousel-templates"
import type { MediaStyle } from "@/lib/visual-language/types"

const STATES = [
  { id: "row", label: "כל המצבים בשורה" },
  { id: "generating", label: "מייצר סקריפט" },
  { id: "script", label: "סקריפט, בלי מדיה" },
  { id: "media", label: "עם מדיה" },
  { id: "panel-generating", label: "פאנל · עוד נכתב" },
  { id: "panel-script", label: "פאנל · סקריפט" },
  { id: "panel-create", label: "פאנל · צור מדיה" },
  { id: "panel-media", label: "פאנל · יש מדיה" },
  { id: "panel-approved", label: "פאנל · אושר" },
] as const
type StateId = (typeof STATES)[number]["id"]

const SCRIPTS: Record<string, string> = {
  carousel:
    "שלוש טעויות שעולות לכם בלקוחות\n[שקופית 1] רוב היועצים מתמחרים לפי שעה — וזה בדיוק מה שמקטין אתכם.\n[שקופית 2] הלקוח לא קונה שעות. הוא קונה תוצאה.\n[שקופית 3] תמחור לפי תוצאה מתחיל בשאלה אחת: מה זה שווה ללקוח?\n[שקופית 4] טעות שנייה: להגיד כן לכל פרויקט.\n[שקופית 5] שמרו את הפוסט הזה לפני הפגישה הבאה.",
  story:
    "סטורי 1: מי פה מתמחר לפי שעה? 🙋‍♀️\nסטורי 2: עשיתי את זה שנים. ואז לקוח אחד שאל אותי שאלה ששינתה הכל.\nסטורי 3: \"כמה זה שווה לך?\" — ומשם התחלתי לתמחר אחרת.\nסטורי 4: רוצים את הרשימה שלי? כתבו לי \"תמחור\".",
  image_post:
    "הלקוח לא קונה שעות. הוא קונה תוצאה.\n\nכשהבנתי את זה, הפסקתי לשלוח הצעות מחיר לפי שעה והתחלתי לשאול שאלה אחת לפני כל פגישה: מה זה שווה לכם? התשובה משנה את כל השיחה — ואת המחיר.",
  b_roll: "הלקוח לא קונה שעות. הוא קונה תוצאה.",
}

const SLIDES = ["ai-dark", "ai-light", "ai-amber", "ai-minimal", "ai-vibrant"].map(
  (n) => `/images/carousel-templates/${n}.png`,
)
const MEDIA: Record<string, FormatCardMedia> = {
  carousel: { kind: "slides", items: SLIDES },
  story: { kind: "slides", items: ["/images/carousel-templates/ai-neon.png", "/images/carousel-templates/ai-ice.png"] },
  image_post: { kind: "image", url: "/images/carousel-templates/ai-collage.png" },
  b_roll: { kind: "video", url: "/images/test/carousel-video-slide.mp4" },
}

const FORMATS = [
  { fid: "carousel", label: "קרוסלה", icon: Layers },
  { fid: "story", label: "סטורי", icon: Smartphone },
  { fid: "image_post", label: "פוסט תמונה", icon: ImageIcon },
  { fid: "b_roll", label: "בי-רול", icon: Film },
]

/** Which card state each format starts in, per page state. */
function startStates(state: StateId): Record<string, FormatCardState> {
  const all = (s: FormatCardState) => Object.fromEntries(FORMATS.map((f) => [f.fid, s]))
  switch (state) {
    case "generating":
      return all("generating")
    case "script":
    case "panel-script":
    case "panel-create":
      return all("script")
    case "media":
    case "panel-media":
    case "panel-approved":
      return all("media")
    case "panel-generating":
      return { ...all("script"), carousel: "generating" }
    default:
      return { carousel: "media", story: "script", image_post: "media-busy", b_roll: "generating" }
  }
}

function Preview() {
  const params = useSearchParams()
  const vp = params.get("variant")
  const variant: FormatCardsVariant = vp === "b" || vp === "c" ? vp : "a"
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "row") as StateId

  const [cardStates, setCardStates] = useState(() => startStates(state))
  const [scripts, setScripts] = useState(SCRIPTS)
  const [approval, setApproval] = useState<ApprovalStatus>(state === "panel-approved" ? "approved" : "pending")
  const [hidden, setHidden] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(state.startsWith("panel-") ? "carousel" : null)
  const [step, setStep] = useState<FormatPanelTab>(
    state === "panel-create" || state === "panel-media" ? "media" : state === "panel-approved" ? "schedule" : "script",
  )
  const [replacing, setReplacing] = useState(false)
  const goTo = (tab: FormatPanelTab) => {
    setStep(tab)
    setReplacing(false)
  }
  const [style, setStyle] = useState<MediaStyle>("blank")

  const items: FormatCardItem[] = FORMATS.filter((f) => !hidden.includes(f.fid)).map((f) => {
    const s = cardStates[f.fid]
    return {
      ...f,
      script: scripts[f.fid],
      state: s,
      media: s === "media" ? MEDIA[f.fid] : null,
      approval: s === "media" ? (f.fid === "carousel" ? approval : "pending") : "no-media",
    }
  })
  const item = items.find((i) => i.fid === selected) ?? null

  // Stand-in for her analysed visual language (exists per user on /project).
  const base = getTemplate("ai-dark")
  const brandTile = base
    ? { ...base, id: "brand", name: "השפה הוויזואלית שלך", thumbnailUrl: "/images/carousel-templates/ai-amber.png" }
    : null

  const editor = item && (
    <div className={`${AI_HOVER_ZONE} group`}>
      {item.fid === "story" ? (
        <div className="min-h-[320px] rounded-[10px] border border-border-neutral-default bg-white px-3 pb-12 pt-2 dark:bg-gray-10">
          <StorySections
            value={item.script}
            onChange={(t) => setScripts((p) => ({ ...p, story: t }))}
            textClassName="text-small leading-relaxed select-text"
          />
        </div>
      ) : (
        <RichBodyEditor
          value={item.script}
          onChange={(t) => setScripts((p) => ({ ...p, [item.fid]: t }))}
          className="min-h-[320px] rounded-[10px] border border-border-neutral-default bg-white px-3 pb-12 pt-2 text-small leading-relaxed shadow-none select-text dark:bg-gray-10"
        />
      )}
      {/* "עריכה עם AI" on the script — the page's real sparkle. */}
      <AiHoverEditButton target="text" visible onClick={() => {}} />
    </div>
  )

  // The panel's content per step — the same pieces /project?cards= uses.
  let panelBody: React.ReactNode = null
  let footer: React.ReactNode = undefined
  let title: string | null = item?.label ?? null
  let headerStart: React.ReactNode = null
  let tabs: React.ReactNode = undefined
  if (item) {
    // Sample of the existing options. On /project the real flow mounts
    // here (CarouselFlow / MediaUploadFlow) — same tiles, "או", Drive.
    const options = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border-neutral-default bg-white px-6 py-4 dark:bg-gray-10">
          <MediaStylePicker
            value={style}
            onChange={setStyle}
            brandTemplate={brandTile}
            aspect={item.fid === "story" || item.fid === "b_roll" ? "9/16" : "4/5"}
            // Same as the real panel: "עריכה עם AI" on the picked tile, before any media exists.
            onAiEdit={() => {}}
          />
          <Button
            className="w-full"
            onClick={() => {
              setCardStates((p) => ({ ...p, [item.fid]: "media" }))
              setStep("script")
            }}
          >
            יצירה עם AI
          </Button>
        </div>
        <div className="flex items-center gap-3" role="separator">
          <span className="h-px flex-1 bg-border-neutral-default" />
          <span className="text-xs text-text-neutral-default">או</span>
          <span className="h-px flex-1 bg-border-neutral-default" />
        </div>
        <Button variant="outline" className="w-full gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/google-drive.svg" alt="" className="size-4 shrink-0" />
          המדיה שלכם מ Google Drive
        </Button>
      </div>
    )
    if (variant === "c") {
      // C (shipped): סקריפט / מדיה / תזמון tabs, each holding only its part.
      const hasMedia = item.state === "media"
      tabs = <FormatPanelTabs value={step} onChange={goTo} />
      if (step === "media") {
        if (hasMedia && !replacing) footer = <FormatPanelNextStep label="תזמון" onNext={() => goTo("schedule")} />
        panelBody =
          hasMedia && !replacing ? (
            <FormatPanelMedia
              fid={item.fid}
              media={item.media}
              onOpenMedia={() => setReplacing(true)}
              onAiEditMedia={() => {}}
              onDeleteMedia={() => setCardStates((p) => ({ ...p, [item.fid]: "script" }))}
            />
          ) : (
            options
          )
      } else if (step === "schedule") {
        panelBody = (
          <FormatPanelSchedule
            fid={item.fid}
            hasMedia={hasMedia}
            approval={
              hasMedia && item.approval
                ? {
                    status: item.approval,
                    onApprove: () => setApproval("approved"),
                    onRevoke: () => setApproval("pending"),
                    calendarHref: "/test/format-cards",
                  }
                : undefined
            }
            onGoToMedia={() => goTo("media")}
          />
        )
      } else if (item.state === "generating") {
        panelBody = (
          <div className="flex flex-col items-center gap-2 py-16" role="status">
            <span className="text-small text-text-neutral-default">מייצר סקריפט</span>
          </div>
        )
      } else {
        panelBody = (
          <FormatPanelScript fid={item.fid} editor={editor} onOpenMedia={() => goTo("media")} onDeleteMedia={() => {}} />
        )
        footer = (
          <FormatPanelNextStep
            label="מדיה"
            onNext={() => goTo("media")}
            onDelete={
              item.state === "script"
                ? () => {
                    setHidden((p) => [...p, item.fid])
                    setSelected(null)
                  }
                : undefined
            }
          />
        )
      }
    } else if (step === "media") {
      if (variant !== "b") {
        title = "יצירת מדיה"
        headerStart = (
          <button
            type="button"
            onClick={() => setStep("script")}
            aria-label="חזרה לסקריפט"
            className="p-0.5 rounded-lg hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors cursor-pointer"
          >
            <ChevronRight className="size-4 text-text-neutral-default" aria-hidden />
          </button>
        )
        panelBody = options
      } else {
        panelBody = (
          <>
            <div className="mb-6">
              <FormatPanelScriptFolded fid={item.fid} script={item.script} onUnfold={() => setStep("script")} />
            </div>
            {options}
          </>
        )
      }
    } else if (item.state === "generating") {
      panelBody = (
        <div className="flex flex-col items-center gap-2 py-16" role="status">
          <span className="text-small text-text-neutral-default">מייצר סקריפט</span>
        </div>
      )
    } else {
      panelBody = (
        <FormatPanelScript
          fid={item.fid}
          editor={editor}
          media={item.state === "media" ? item.media : null}
          mediaBusy={item.state === "media-busy"}
          onOpenMedia={() => setStep("media")}
          onAiEditMedia={() => {}}
          onDeleteMedia={() => setCardStates((p) => ({ ...p, [item.fid]: "script" }))}
        />
      )
      footer = (
        <FormatPanelFooter
          fid={item.fid}
          hasMedia={item.state === "media"}
          approval={
            item.approval
              ? {
                  status: item.approval,
                  onApprove: () => setApproval("approved"),
                  onRevoke: () => setApproval("pending"),
                  calendarHref: "/test/format-cards",
                }
              : undefined
          }
          onCreateMedia={() => setStep("media")}
          onDelete={() => {
            setHidden((p) => [...p, item.fid])
            setSelected(null)
          }}
          createDisabled={item.state === "media-busy"}
        />
      )
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-bg-surface" dir="rtl">
      {/* Review-only state toggle — every state has its own link. */}
      <nav
        aria-label="מצבי סקירה"
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 overflow-x-auto border-b border-border-neutral-default bg-white px-4 dark:bg-gray-10"
      >
        <span className="text-small-bold text-text-primary-default shrink-0">אופציה</span>
        {(["a", "b", "c"] as const).map((v) => (
          <a
            key={v}
            href={`?variant=${v}&state=${state}`}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-small ${variant === v ? "bg-gray-90 text-text-primary-default" : "text-text-neutral-default hover:bg-gray-95"}`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        <span className="mx-2 h-5 w-px shrink-0 bg-border-neutral-default" />
        {STATES.map((s) => (
          <a
            key={s.id}
            href={`?variant=${variant}&state=${s.id}`}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-small ${state === s.id ? "bg-gray-90 text-text-primary-default" : "text-text-neutral-default hover:bg-gray-95"}`}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <MediaPanelFrame
        open={!!item}
        title={item ? title : null}
        onClose={() => setSelected(null)}
        headerStart={headerStart}
        footer={footer}
        tabs={tabs}
      >
        {panelBody}
      </MediaPanelFrame>

      <InfiniteCanvas>
        <div className="flex items-start pt-28 pr-16" dir="rtl">
          {/* The formats card, as a stand-in — the row hangs off it. */}
          <div className="w-[346px] shrink-0 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10">
            <div className="flex items-center gap-2 rounded-t-[20px] bg-bg-surface px-6 py-3">
              <span className="text-p-bold text-text-primary-default">לאיזה פורמטים לשכפל?</span>
            </div>
            <div className="h-40" />
          </div>
          <FormatCardsRow
            variant={variant}
            items={items}
            selected={selected}
            onSelect={(fid) => {
              setSelected((cur) => (cur === fid ? null : fid))
              goTo("script")
            }}
          />
        </div>
      </InfiniteCanvas>
    </div>
  )
}

export default function FormatCardsPreviewPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
