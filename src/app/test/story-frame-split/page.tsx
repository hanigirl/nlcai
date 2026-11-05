"use client"

/**
 * State preview — the story card shows the stories its script becomes
 * (Hani, 2026-11-05). The frames are exactly what the generator makes
 * (lib/story-text-split storyFrames); a change to the split is written back
 * as "סטורי N" lines, which the same split reads.
 *
 *   ?variant=a — one box per story; she writes inside the stories.
 *   ?variant=b — the text box as today, a strip of the stories under it.
 *   &state=auto | mine | one | long | empty
 *
 * The side panel shows what the generator receives for this exact text, and
 * a live check that no "סטורי N" line reaches a picture, a burned caption or
 * the copy text (lib/story-text-split frameMarkerLeaks).
 *
 * Sample text only: nothing is saved, nothing is generated.
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Smartphone } from "lucide-react"
import { RichBodyEditor } from "@/components/rich-body-editor"
import { StoryFrameStrip, StoryFramesEditor, type StoryFramesVariant } from "@/components/story-frames"
import { frameMarkerLeaks, storyFrames } from "@/lib/story-text-split"

const SAMPLES = {
  auto: "כשקלוד נהיה מטומטם אני בודקת 3 דברים\n\nקונטקסט: עברתם 70%? הביצועים כבר נחלשים.\nמודל: אולי עברתם בטעות להייקו.\nולשאול אותו ישירות מה קרה.\n\nיש לכם דבר רביעי? כתבו לי",
  mine: "סטורי 1\nכשקלוד נהיה מטומטם אני בודקת 3 דברים\nקונטקסט, מודל, ולשאול אותו ישירות\n\nסטורי 2\nיש לכם דבר רביעי? כתבו לי",
  one: "כשקלוד נהיה מטומטם אני בודקת 3 דברים: קונטקסט, מודל, ולשאול אותו ישירות.",
  long:
    "כשקלוד נהיה מטומטם אני בודקת 3 דברים. קודם כל את חלון הקונטקסט, כי אחרי 70% הביצועים מתחילים להיחלש ואז הוא שוכח מה ביקשתם בהתחלה. אחר כך את המודל, כי לפעמים עברתם בטעות למודל קטן יותר באמצע השיחה. ולבסוף פשוט לשאול אותו ישירות מה השתנה, הוא בדרך כלל יודע להגיד. יש לכם דבר רביעי? כתבו לי בתגובות.",
  empty: "",
} as const
type State = keyof typeof SAMPLES

const STATES: { id: State; label: string }[] = [
  { id: "auto", label: "חלוקה אוטומטית (פסקאות)" },
  { id: "mine", label: "חלוקה שלה (2 סטוריז)" },
  { id: "one", label: "טקסט קצר — סטורי אחד" },
  { id: "long", label: "בלוק ארוך — מחולק לפי אורך" },
  { id: "empty", label: "ריק" },
]

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}

function Preview() {
  const params = useSearchParams()
  const variant: StoryFramesVariant = params.get("variant") === "b" ? "b" : "a"
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "auto") as State
  return <Card key={`${variant}-${state}`} variant={variant} state={state} />
}

function Card({ variant, state }: { variant: StoryFramesVariant; state: State }) {
  const [text, setText] = useState<string>(SAMPLES[state])
  const editor =
    "rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-none text-small leading-relaxed select-text"
  const href = (v: StoryFramesVariant, s: State) => `/test/story-frame-split?variant=${v}&state=${s}`
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      on ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`
  const generated = storyFrames(text)
  // "סטורי 1" lives in the card only — never in a picture or caption.
  const leaks = frameMarkerLeaks(text)

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-neutral-default">איך החלוקה נראית:</span>
        <Link href={href("a", state)} className={pill(variant === "a")}>A · תיבה לכל סטורי</Link>
        <Link href={href("b", state)} className={pill(variant === "b")}>B · רצועת סטוריז מתחת לטקסט</Link>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={href(variant, s.id)} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* The story format card on the canvas. */}
        <div className="flex w-[420px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white pb-6 dark:bg-gray-10">
          <div className="flex items-center gap-2 rounded-t-[20px] bg-bg-surface px-6 py-3">
            <span className="text-p-bold text-text-primary-default">סטורי</span>
            <Smartphone className="size-4 text-text-neutral-default" />
          </div>
          <div className="flex flex-col gap-3 px-6">
            {variant === "a" ? (
              <StoryFramesEditor value={text} onChange={setText} editorClassName={`min-h-[64px] ${editor}`} />
            ) : (
              <>
                <RichBodyEditor value={text} onChange={setText} className={`min-h-[200px] ${editor}`} />
                <StoryFrameStrip value={text} onChange={setText} />
              </>
            )}
          </div>
        </div>

        {/* Review aid: what the generator will draw from this exact text. */}
        <div className="flex w-[300px] flex-col gap-2 rounded-[20px] border border-dashed border-border-neutral-default p-4 text-xs-body text-text-neutral-default">
          <span className={`rounded-md px-2 py-1 font-medium ${leaks.length ? "bg-red-95 text-button-danger-default" : "bg-gray-95 text-text-primary-default dark:bg-gray-20"}`}>
            {leaks.length
              ? `בדיקה: "סטורי N" דלף אל ${leaks.join(", ")}`
              : "בדיקה: שורות \"סטורי N\" לא מגיעות לתמונה, לכיתוב או להעתקה ✓"}
          </span>
          <span className="font-medium text-text-primary-default">מה שיצירת המדיה תקבל ({generated.length})</span>
          {generated.map((f, i) => (
            <div key={i} className="rounded-md bg-white p-2 dark:bg-gray-10">
              <span className="font-medium">פריים {i + 1}: </span>
              <span className="whitespace-pre-line">{f}</span>
            </div>
          ))}
          <span className="mt-2 font-medium text-text-primary-default">הטקסט שנשמר</span>
          <pre className="whitespace-pre-wrap rounded-md bg-white p-2 font-sans dark:bg-gray-10">{text || "—"}</pre>
        </div>
      </div>
    </div>
  )
}
