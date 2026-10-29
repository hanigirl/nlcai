"use client"

/**
 * State preview for the hover AI sparkle + the icon action row (Hani,
 * 2026-10-29).
 *
 * Route: /test/hover-ai-icon[?hover=0]
 * The core post card, a format's text card and two media cards (carousel,
 * story), built from the same shared pieces /project uses: AiHoverEditButton,
 * MediaPreviewZone, IconActionButton, ApprovalCardFooter. By default every
 * sparkle is forced visible; `?hover=0` shows them on hover only, as on /project.
 * Sample data only — no fetch, no DB, the buttons just toast.
 */

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Check, Download, Layers, Plus, RotateCw, Smartphone, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichBodyEditor } from "@/components/rich-body-editor"
import { StoryPlayer } from "@/components/story-player"
import { AI_HOVER_ZONE, AiHoverEditButton } from "@/components/ai-hover-edit"
import { MediaPreviewZone } from "@/components/media-preview-zone"
import { IconActionButton } from "@/components/icon-action-button"
import { ApprovalCardFooter } from "@/components/format-approval/approval-card-footer"
import type { ApprovalStatus } from "@/components/format-approval/use-format-approvals"

const CORE_POST = `תיק העבודות שלי מעודכן. ל-2024.

ובאמת, זה אחד הדברים שאני הכי שומעת עכשיו.

"חני, אני לא יודעת מה לשים בתיק. כל מה שיש לי נראה לי ישן."

אז שמעו סיפור.

מעצבת שפנתה אליי לפני כמה חודשים, עם ניסיון של שלוש שנים, תיק מלא בעבודות אמיתיות, ופרויקטים שהיא באמת גאה בהם.

אבל כשישבנו ביחד, הבנו שהתיק מספר את הסיפור הלא נכון.

הוא הראה מה היא עשתה. לא איך היא חושבת.

ההבדל.`

const CAROUSEL_COPY = `שקופית 1
תיק העבודות שלי מעודכן. ל-2024.

שקופית 2
ובאמת, זה אחד הדברים שאני הכי שומעת עכשיו.

"חני, אני לא יודעת מה לשים בתיק. כל מה שיש לי נראה לי ישן."`

const SAMPLE_IMAGE = "/images/onboarding-hero.png"

/**
 * A sample story frame. StoryPlayer reads a bare path as base64, so the
 * frame is a self-contained SVG data URL (sample content, not UI chrome).
 */
const STORY_FRAME =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="slategray"/><stop offset="1" stop-color="black"/></linearGradient></defs><rect width="270" height="480" fill="url(#g)"/><rect x="24" y="300" width="222" height="90" rx="6" fill="black"/><text x="135" y="338" fill="white" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" direction="rtl">תיק העבודות שלי</text><text x="135" y="368" fill="white" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" direction="rtl">מעודכן. ל-2024.</text></svg>`,
  )

function Card({
  title,
  icon: Icon,
  yellow = false,
  headerEnd,
  children,
}: {
  title: string
  icon?: typeof Layers
  yellow?: boolean
  headerEnd?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex w-[346px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white pb-6 dark:bg-gray-10">
      <div
        className={`flex items-center gap-2 rounded-t-[20px] px-6 py-3 ${yellow ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}
      >
        <span className="text-p-bold text-text-primary-default">{title}</span>
        {Icon && <Icon className="size-4 text-text-neutral-default" />}
        {headerEnd}
      </div>
      {children}
    </div>
  )
}

function Preview() {
  const forced = useSearchParams().get("hover") !== "0"
  const [corePost, setCorePost] = useState(CORE_POST)
  const [copy, setCopy] = useState(CAROUSEL_COPY)
  const [slide, setSlide] = useState(0)
  const [status, setStatus] = useState<ApprovalStatus>("pending")
  // What the last click did — shown on the page, so a review can see that a
  // click on the media opens the panel and a click on a control doesn't.
  const [last, setLast] = useState("")
  const say = (what: string) => () => {
    setLast(what)
    toast(what)
  }

  const footer = (actions: React.ReactNode) => (
    <ApprovalCardFooter
      status={status}
      formatNoun="הקרוסלה"
      onApprove={() => setStatus("approved")}
      onRevoke={() => setStatus("pending")}
      calendarHref="/calendar"
      actions={actions}
    />
  )
  const actions = (
    <>
      <IconActionButton label="הורדה" icon={Download} onClick={say("הורדה")} />
      <IconActionButton label="מחיקה" icon={Trash2} destructive onClick={say("מחיקה")} />
    </>
  )

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="mb-1 text-xs-body text-text-neutral-default">סביבת בדיקה · /test/hover-ai-icon</p>
          <h1 className="mb-2 text-2xl font-bold text-text-primary-default">עריכה עם AI במעבר עכבר + שורת כפתורי אייקון</h1>
          <p className="text-small text-text-neutral-default">
            {forced
              ? "כל הספרקלים מוצגים קבוע לבדיקת העיצוב."
              : "הספרקל מופיע במעבר עכבר על הטקסט או על המדיה, כמו ב-/project."}{" "}
            <a
              className="underline underline-offset-2"
              href={forced ? "/test/hover-ai-icon?hover=0" : "/test/hover-ai-icon"}
            >
              {forced ? "להתנהגות האמיתית (במעבר עכבר)" : "להצגה קבועה"}
            </a>
            . לחיצה על המדיה = פתיחת פאנל המדיה (כאן: הודעה).
          </p>
          <p className="mt-2 text-small text-text-primary-default" role="status" data-testid="last-action">
            פעולה אחרונה: {last || "—"}
          </p>
        </header>

        <div className="flex flex-wrap items-start gap-8">
          {/* Format text card + its carousel media card */}
          <div className="flex flex-col items-center">
            <Card
              title="קרוסלה"
              icon={Layers}
              headerEnd={
                <span className="ms-auto flex size-8 items-center justify-center rounded-lg text-text-neutral-default">
                  <RotateCw className="size-4" />
                </span>
              }
            >
              <div className="flex flex-col gap-3 px-6">
                <div className={AI_HOVER_ZONE}>
                  <RichBodyEditor
                    value={copy}
                    onChange={setCopy}
                    className="min-h-[200px] rounded-[10px] border border-border-neutral-default bg-white px-3 pt-2 pb-12 text-small leading-relaxed shadow-none dark:bg-gray-10"
                  />
                  <AiHoverEditButton target="text" visible={forced} onClick={say("עריכת טקסט עם AI")} />
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2 rounded-[10px] border-border-neutral-default text-small text-text-primary-default"
                  onClick={say("פאנל המדיה")}
                >
                  <Plus className="size-4" />
                  הוספת מדיה
                </Button>
              </div>
            </Card>
            <div className="h-7 w-[2px] bg-gray-80" />
            <Card title="הקרוסלה שלכם" icon={Layers} yellow>
              <div className="flex flex-col items-center gap-4 px-6">
                <MediaPreviewZone
                  onOpen={say("פאנל המדיה של הקרוסלה")}
                  openLabel="החלפת הקרוסלה"
                  onAiEdit={say("עריכת מדיה עם AI")}
                  aiVisible={forced}
                  className="w-full"
                >
                  <div className="relative w-full overflow-hidden rounded-xl bg-gray-95">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={SAMPLE_IMAGE} alt={`סלייד ${slide + 1}`} className="h-auto w-full" />
                  </div>
                </MediaPreviewZone>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="הסלייד הקודם"
                    onClick={() => setSlide((s) => Math.max(0, s - 1))}
                    className="rounded-lg p-1.5 hover:bg-bg-surface"
                  >
                    ‹
                  </button>
                  <span className="text-small text-text-neutral-default">{slide + 1} / 3</span>
                  <button
                    type="button"
                    aria-label="הסלייד הבא"
                    onClick={() => setSlide((s) => Math.min(2, s + 1))}
                    className="rounded-lg p-1.5 hover:bg-bg-surface"
                  >
                    ›
                  </button>
                </div>
                <div className="w-full">{footer(actions)}</div>
              </div>
            </Card>
          </div>

          {/* Core post card */}
          <div className="flex w-[567px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white pb-6 dark:bg-gray-10">
            <div className="flex items-center rounded-t-[20px] bg-bg-surface px-6 py-3">
              <span className="text-p-bold text-text-primary-default">פוסט ליבה</span>
              <span className="ms-auto flex items-center gap-1 text-xs text-text-neutral-default">
                <Check className="size-3" />
                <span>נשמר</span>
              </span>
            </div>
            <div className="flex flex-col items-end gap-4 px-6">
              <div className={`${AI_HOVER_ZONE} w-full`}>
                <RichBodyEditor
                  value={corePost}
                  onChange={setCorePost}
                  className="min-h-[250px] w-full rounded-[10px] border border-border-neutral-default bg-white px-3 pt-2 pb-12 text-small leading-relaxed shadow-none dark:bg-gray-10"
                />
                <AiHoverEditButton target="text" visible={forced} onClick={say("עריכת טקסט עם AI")} />
              </div>
              <Button className="w-full" onClick={say("שיכפול לפורמטים")}>
                שיכפול לפורמטים
              </Button>
            </div>
          </div>

          {/* Story media card */}
          <Card title="הסטורי שלכם" icon={Smartphone} yellow>
            <div className="flex flex-col items-center gap-4 px-6">
              <MediaPreviewZone
                onOpen={say("פאנל המדיה של הסטורי")}
                openLabel="החלפת הסטורי"
                onAiEdit={say("עריכת מדיה עם AI")}
                aiVisible={forced}
              >
                <StoryPlayer
                  frames={[STORY_FRAME]}
                  className="aspect-[9/16] w-[200px] border border-border-neutral-default"
                />
              </MediaPreviewZone>
              <div className="w-full">{footer(actions)}</div>
            </div>
          </Card>

          {/* Disabled sparkle — core post after duplication */}
          <section className="flex w-[346px] flex-col gap-2">
            <h2 className="text-p-bold text-text-primary-default">אחרי שיכפול לפורמטים</h2>
            <p className="text-xs-body text-text-neutral-default">פוסט הליבה נעול: הספרקל אפור, והטולטיפ מסביר למה.</p>
            <div className={AI_HOVER_ZONE}>
              <div className="min-h-[120px] rounded-[10px] border border-border-neutral-default bg-white px-3 pt-2 pb-12 text-small leading-relaxed text-text-primary-default dark:bg-gray-10">
                תיק העבודות שלי מעודכן. ל-2024.
              </div>
              <AiHoverEditButton
                target="text"
                visible={forced}
                disabled
                disabledLabel="אי אפשר לערוך בשיחה אחרי שיכפול לפורמטים"
                onClick={say("לא אמור לקרות")}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default function HoverAiIconPreviewPage() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
