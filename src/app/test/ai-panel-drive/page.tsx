"use client"

/**
 * State preview — "מגוגל דרייב" in the AI panel's add-image menu (Hani,
 * 2026-11-06).
 *
 * The real AI panel (MediaAiChat) on its first question. Click the image+
 * icon in the composer: "מהמחשב" (as before) / "מגוגל דרייב" — a gallery of
 * the Drive folder linked to this format in Settings (sample folder here).
 * Pick, press "צירוף": the files land in the tray exactly like files from
 * the computer. A video comes in as one frame, and the panel says so.
 *
 *   ?format=story | b_roll     (story: pictures · b_roll: videos)
 *   &state=ready | nofolder | noaccess | empty
 *
 * Then "להעלות כמו שזה, בלי תוספות" hands the ORIGINALS (a Drive video stays the
 * video) to the media panel's own import — shown by the stand-in card.
 * A video with an instruction (story / b-roll) makes a VIDEO: the clip is
 * imported, then the own-video AI edit runs on it. Here the edit's route is
 * switched off, so the panel shows the honest failure ("הסרטון עלה כמו שהוא,
 * אבל העריכה לא הצליחה"). In a carousel (or image post) a video is refused at
 * once, before anything starts.
 * `&open=drive` = the media panel's "מדיה מוכנה מ Google Drive": the panel
 * opens with the Drive gallery already up.
 *
 * The folder is sample data and `fetch` is stubbed (the Drive download answers
 * with a sample picture) — no Drive calls, no credits, nothing saved.
 */

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaAiChat, mediaChatKey, type AiEditFormat } from "@/components/media-ai-chat"
import { setDrivePreviewState, type DrivePreviewState } from "@/components/drive-folder-review"
import { clearChat } from "@/lib/ai-chat-session-store"
import { openingId, type AiEditOpening } from "@/lib/ai-edit-intent"
import { registerAsIsImporter, requestDrivePicker, type AsIsItem } from "@/lib/as-is-upload"

const POST_ID = "preview-ai-panel-drive"
const SAMPLE = "/images/carousel-templates/ai-dark.png"

const FORMATS: { id: AiEditFormat; label: string }[] = [
  { id: "story", label: "סטורי (תמונות)" },
  { id: "b_roll", label: "בי-רול (סרטונים)" },
  { id: "carousel", label: "קרוסלה (סרטון לא נכנס)" },
]
const STATES: { id: DrivePreviewState; label: string }[] = [
  { id: "ready", label: "תיקייה עם קבצים" },
  { id: "nofolder", label: "לא חוברה תיקייה" },
  { id: "noaccess", label: "תיקייה לא משותפת" },
  { id: "empty", label: "תיקייה ריקה" },
]

/** A sample picture as a data URL — `fetch` is stubbed, so via canvas. */
function sampleDataUrl(): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext("2d")?.drawImage(img, 0, 0)
      resolve(c.toDataURL("image/jpeg", 0.85))
    }
    img.src = SAMPLE
  })
}

function stubFetch() {
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/api/media/drive-reference")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { kind?: string }
      await new Promise((r) => setTimeout(r, 700))
      return new Response(JSON.stringify({ image: await sampleDataUrl(), frame: body.kind === "video" }), { status: 200 })
    }
    return Promise.reject(new Error("preview: network disabled"))
  }) as typeof fetch
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}

function Preview() {
  const params = useSearchParams()
  const format: AiEditFormat = FORMATS.find((f) => f.id === params.get("format"))?.id ?? "story"
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "ready") as DrivePreviewState
  // shortcut: the media panel's "מדיה מוכנה מ Google Drive" — the AI panel opens with Drive up.
  const shortcut = params.get("open") === "drive"
  return <Stage key={`${format}-${state}-${shortcut}`} format={format} state={state} shortcut={shortcut} />
}

function Stage({ format, state, shortcut }: { format: AiEditFormat; state: DrivePreviewState; shortcut: boolean }) {
  // What "להעלות כמו שזה" handed to the media panel's import (the stand-in below).
  const [imported, setImported] = useState<AsIsItem[] | null>(null)
  useEffect(() => {
    registerAsIsImporter(format, async (items, opts) => {
      setImported(items)
      return opts?.forEdit
        ? { ok: true, message: "הסרטון עלה." }
        : { ok: true, message: "המדיה עולה כמו שהיא, בלי תוספות. ההתקדמות בפאנל המדיה." }
    })
    return () => registerAsIsImporter(format, null)
  }, [format])
  // A clean conversation before the panel mounts, then its first question.
  const [opening] = useState<AiEditOpening>(() => {
    // Before anything mounts: sample folder, network off, clean conversation.
    if (typeof window !== "undefined") {
      stubFetch()
      setDrivePreviewState(state)
    }
    clearChat(mediaChatKey(POST_ID, format))
    if (shortcut) requestDrivePicker(format)
    return {
    id: openingId(),
    kind: "generate",
    run: () => new Promise(() => {}),
    style: "brand",
    fromEdit: true,
    placeRefs: true,
    }
  })
  useEffect(() => {
    stubFetch()
    setDrivePreviewState(state)
  }, [state])

  const href = (f: AiEditFormat, s: DrivePreviewState) => `/test/ai-panel-drive?format=${f}&state=${s}`
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      on ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-neutral-default">פורמט:</span>
        {FORMATS.map((f) => (
          <Link key={f.id} href={href(f.id, state)} className={pill(f.id === format)}>
            {f.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={href(format, s.id)} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
        <Link href={`${href(format, state)}&open=drive`} className={pill(shortcut)}>
          ״מדיה מוכנה מ Google Drive״ — פותח ישר את הדרייב
        </Link>
        <span className="text-text-neutral-default">· או לחצו על אייקון התמונה בשורת הכתיבה בפאנל</span>
      </div>

      {/* Stand-in for the media panel's own import (lib/as-is-upload). */}
      <div className="w-[352px] rounded-[18px] border border-border-neutral-default bg-white p-4 text-xs-body text-text-neutral-default dark:bg-gray-10">
        <p className="mb-2 font-medium text-text-primary-default">פאנל המדיה · הייבוא הקיים</p>
        {imported ? (
          <ol className="list-inside list-decimal">
            {imported.map((it, i) => (
              <li key={i}>
                {it.drive ? "מהדרייב" : "מהמחשב"} · {it.kind === "video" ? "סרטון, כמו שהוא" : "תמונה, כמו שהיא"}
              </li>
            ))}
          </ol>
        ) : (
          <p>עוד לא נשלח כלום. צרפו מדיה בפאנל ה-AI ולחצו ״להעלות כמו שזה, בלי תוספות״.</p>
        )}
      </div>
      <MediaAiChat postId={POST_ID} format={format} open opening={opening} onOpenChange={() => {}} />
    </div>
  )
}
