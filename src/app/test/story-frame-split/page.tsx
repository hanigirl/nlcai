"use client"

/**
 * State preview — the story card's text as its stories (Hani's design,
 * 2026-11-05): a grey "סטורי 1" label over each story's text, a divider
 * between them. Right-click the text: "הוספת סטורי" / "מחיקת סטורי N".
 *
 * The side panel shows what the generator receives for this exact text, and
 * a live check that no "סטורי N" line reaches a picture, a burned caption or
 * the copy text (lib/story-text-split frameMarkerLeaks).
 *
 *   ?state=auto | mine | one | long | added | empty
 *
 * Sample text only: nothing is saved, nothing is generated.
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Smartphone } from "lucide-react"
import { StorySections } from "@/components/story-frames"
import { frameMarkerLeaks, storyFrames } from "@/lib/story-text-split"

const SAMPLES = {
  auto: "כשקלוד נהיה מטומטם אני בודקת 3 דברים\n\nקונטקסט: עברתם 70%? הביצועים כבר נחלשים.\nמודל: אולי עברתם בטעות להייקו.\nולשאול אותו ישירות מה קרה.\n\nיש לכם דבר רביעי? כתבו לי",
  mine: "סטורי 1\nכשקלוד נהיה מטומטם אני בודקת 3 דברים\nקונטקסט, מודל, ולשאול אותו ישירות\n\nסטורי 2\nיש לכם דבר רביעי? כתבו לי",
  one: "כשקלוד נהיה מטומטם אני בודקת 3 דברים: קונטקסט, מודל, ולשאול אותו ישירות.",
  long:
    "כשקלוד נהיה מטומטם אני בודקת 3 דברים. קודם כל את חלון הקונטקסט, כי אחרי 70% הביצועים מתחילים להיחלש ואז הוא שוכח מה ביקשתם בהתחלה. אחר כך את המודל, כי לפעמים עברתם בטעות למודל קטן יותר באמצע השיחה. ולבסוף פשוט לשאול אותו ישירות מה השתנה, הוא בדרך כלל יודע להגיד. יש לכם דבר רביעי? כתבו לי בתגובות.",
  added: "סטורי 1\nכשקלוד נהיה מטומטם אני בודקת 3 דברים\n\nסטורי 2\nיש לכם דבר רביעי? כתבו לי\n\nסטורי 3",
  empty: "",
} as const
type State = keyof typeof SAMPLES

const STATES: { id: State; label: string }[] = [
  { id: "auto", label: "חלוקה לפי פסקאות" },
  { id: "mine", label: "2 סטוריז" },
  { id: "one", label: "סטורי אחד" },
  { id: "long", label: "בלוק ארוך" },
  { id: "added", label: "אחרי ״הוספת סטורי״" },
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
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "auto") as State
  return <Card key={state} state={state} />
}

function Card({ state }: { state: State }) {
  const [text, setText] = useState<string>(SAMPLES[state])
  const generated = storyFrames(text)
  const leaks = frameMarkerLeaks(text)

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/story-frame-split?state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
        <span className="text-text-neutral-default">· קליק ימני על הטקסט: הוספה ומחיקה של סטורי</span>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* The story format card, as on the canvas. */}
        <div className="flex w-[346px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white pb-6 dark:bg-gray-10">
          <div className="flex items-center gap-2 rounded-t-[20px] bg-bg-surface px-6 py-3">
            <span className="text-p-bold text-text-primary-default">סטורי</span>
            <Smartphone className="size-4 text-text-neutral-default" />
          </div>
          <div className="px-6">
            <div className="min-h-[200px] rounded-[10px] border border-border-neutral-default bg-white px-3 pt-2 pb-12 dark:bg-gray-10">
              <StorySections value={text} onChange={setText} textClassName="text-small leading-relaxed select-text" />
            </div>
          </div>
        </div>

        {/* Review aid: what the generator draws from this exact text. */}
        <div className="flex w-[300px] flex-col gap-2 rounded-[20px] border border-dashed border-border-neutral-default p-4 text-xs-body text-text-neutral-default">
          <span
            className={`rounded-md px-2 py-1 font-medium ${
              leaks.length ? "bg-red-95 text-button-danger-default" : "bg-gray-95 text-text-primary-default dark:bg-gray-20"
            }`}
          >
            {leaks.length
              ? `בדיקה: "סטורי N" דלף אל ${leaks.join(", ")}`
              : 'בדיקה: שורות "סטורי N" לא מגיעות לתמונה, לכיתוב או להעתקה ✓'}
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
