"use client"

/**
 * State preview — "עריכת קרוסלה עם AI" after an edit (Hani, 2026-11-05).
 *
 * Route: /test/ai-edit-visual-language
 *   ?state=applied    — the edit changed the slides: "עדכנתי…" + "הוחל."
 *   ?state=unchanged  — the edit ran but the slides came out the same: the
 *                       panel says so, nothing is saved, no "הוחל."
 *   (no param)        — both, side by side.
 *
 * The real panel (MediaAiChat) opened on a finished conversation. Nothing is
 * sent: no fetch, no AI credits, no DB writes.
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MediaAiChat, mediaChatKey, type ChatMessage } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"

const ASK = "תערוך את הקרוסלה הזו לפי שפת המותג המחודשת שהגדרתי בשפה הויזואלית"
const INTRO = "מה לשנות בקרוסלה? אפשר לבקש על כל השקופיות או על שקופית מסוימת, למשל ״בשקופית 3 הכותרת בצבע המותג״."

// The exact copy the server and panel use for each state.
const STATES: { id: "applied" | "unchanged"; title: string; messages: ChatMessage[] }[] = [
  {
    id: "applied",
    title: "העריכה שינתה את השקופיות",
    messages: [
      { role: "assistant", content: INTRO },
      { role: "user", content: ASK },
      { role: "assistant", content: "עדכנתי את הקרוסלה. השקופיות החדשות מופיעות בכרטיס.", done: true },
    ],
  },
  {
    id: "unchanged",
    title: "העריכה לא שינתה כלום",
    messages: [
      { role: "assistant", content: INTRO },
      { role: "user", content: "תעשו שהקרוסלה תיראה טוב יותר" },
      {
        role: "assistant",
        content:
          "הבקשה לא שינתה כלום בשקופיות, אז השארתי אותן כמו שהיו. נסו לכתוב מה בדיוק לשנות, למשל צבע הרקע, מיקום הכותרת או גודל התמונה.",
      },
    ],
  },
]

function Preview() {
  const param = useSearchParams().get("state")
  const shown = STATES.filter((s) => !param || s.id === param)
  // A fresh thread on every load — never one left in the session store.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    STATES.forEach((s) => clearChat(mediaChatKey(`preview-vl-${s.id}`, "carousel")))
    setReady(true)
  }, [])

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <h1 className="mb-6 text-p-bold text-text-primary-default">עריכת קרוסלה עם AI — אחרי עריכה</h1>
      <div className="flex flex-wrap gap-6">
        {shown.map((s) => (
          <section key={s.id} className="flex flex-col gap-2">
            <h2 className="text-small-bold text-text-neutral-default">{s.title}</h2>
            {/* transform = the panel's fixed position is relative to this frame, so states sit side by side. */}
            <div className="relative h-[560px] w-[420px] [transform:translateZ(0)] rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10">
              {ready && (
                <MediaAiChat
                  postId={`preview-vl-${s.id}`}
                  format="carousel"
                  initialMessages={s.messages}
                  open
                  onOpenChange={() => undefined}
                />
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

export default function AiEditVisualLanguagePreview() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
