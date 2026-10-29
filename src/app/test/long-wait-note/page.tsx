"use client"

/**
 * State preview for the long-wait "you can leave this screen" note.
 *
 * Route: /test/long-wait-note — `?state=<id>` fires that state on load;
 * no param lists every state with a button to fire it. Uses the real
 * helper (lib/long-wait) and the real busy row, so the toast and the line
 * read exactly like production. No fetch, no credits, no DB writes: the
 * "jobs" here are timers.
 */

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LongWaitBusyRow } from "@/components/long-wait-busy-row"
import { AWAY_COPY, startLongWait } from "@/lib/long-wait"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { isOwner } from "@/lib/owner"

type StateId = "running" | "parallel" | "done" | "error" | "ai-edit" | "ai-edit-away"

const STATES: { id: StateId; title: string; description: string }[] = [
  { id: "running", title: "בזמן יצירה", description: "טוסט הטעינה של הקרוסלה, עם ההערה בשורה השנייה." },
  { id: "parallel", title: "כמה יצירות במקביל", description: "קרוסלה, בי-רול וסטורי רצים יחד: שלושה טוסטים, כל אחד עם ההערה." },
  { id: "done", title: "הסתיים", description: "אותו טוסט הופך ל״מוכן״. מגיע בכל מסך, גם אחרי שעברו." },
  { id: "error", title: "שגיאה", description: "אותו טוסט הופך לשגיאה." },
  { id: "ai-edit", title: "עריכה עם AI בזמן עבודה", description: "שורת ״מעדכנים…״ בחלון העריכה, וההערה מתחתיה." },
  { id: "ai-edit-away", title: "עריכה הסתיימה אחרי יציאה", description: "החלון כבר לא פתוח, אז התוצאה מגיעה כטוסט." },
]

const CAROUSEL_TITLE = "מציירים קרוסלת AI (מותג)... זה לוקח כמה דקות"

function fire(state: StateId) {
  const id = `long-wait-preview-${state}-${Date.now()}`
  switch (state) {
    case "running":
      startLongWait(id, CAROUSEL_TITLE)
      window.setTimeout(() => toast.dismiss(id), 30000)
      break
    case "parallel":
      startLongWait(`${id}-c`, CAROUSEL_TITLE)
      startLongWait(`${id}-b`, "מייצרים בי-רול... זה יכול לקחת כשתי דקות")
      startLongWait(`${id}-s`, "מייצרים סטורי עם AI... זה יכול לקחת עד דקה")
      window.setTimeout(() => [`${id}-c`, `${id}-b`, `${id}-s`].forEach((t) => toast.dismiss(t)), 30000)
      break
    case "done":
      startLongWait(id, CAROUSEL_TITLE)
      window.setTimeout(() => toast.success("הקרוסלה (מותג) מוכנה", { id, duration: 6000 }), 2500)
      break
    case "error":
      startLongWait(id, CAROUSEL_TITLE)
      window.setTimeout(
        () => toast.error("יצירת הקרוסלה נכשלה. נסו שוב בעוד רגע.", { id, duration: 12000 }),
        2500,
      )
      break
    case "ai-edit-away":
      toast.success(AWAY_COPY.carousel.done, { id, duration: 8000 })
      break
    case "ai-edit":
      break
  }
}

function AiEditFrame() {
  // The chat panel's chrome, static — the busy row inside is the real one.
  return (
    <div className="w-[380px] max-w-full overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl">
      <div className="border-b border-border-neutral-default bg-bg-surface px-4 py-3 text-small-bold text-text-primary-default">
        עריכת קרוסלה עם AI
      </div>
      <div className="space-y-3 px-4 py-4">
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small text-text-primary-default">
            מה לשנות בקרוסלה?
          </div>
        </div>
        <LongWaitBusyRow text="מעדכנים את השקופיות... זה יכול לקחת עד שתי דקות" />
      </div>
    </div>
  )
}

function Preview() {
  const params = useSearchParams()
  const only = params.get("state") as StateId | null
  const selected = only && STATES.some((s) => s.id === only) ? only : null

  useEffect(() => {
    if (selected) fire(selected)
  }, [selected])

  const shown = selected ? STATES.filter((s) => s.id === selected) : STATES

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="mb-1 text-xs-body text-text-neutral-default">סביבת בדיקה · /test/long-wait-note</p>
          <h1 className="mb-2 text-2xl font-bold text-text-primary-default">
            תצוגה מקדימה: ״אפשר לעבור למסך אחר״ בהמתנות ארוכות
          </h1>
          <p className="text-small text-text-neutral-default">
            הטוסטים מופיעים בתחתית המסך. אין יצירה אמיתית, רק טיימרים.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {shown.map((s) => (
            <section key={s.id} className="flex flex-col gap-3">
              <div>
                <h2 className="text-p-bold text-text-primary-default">{s.title}</h2>
                <p className="mt-0.5 text-xs-body leading-relaxed text-text-neutral-default">{s.description}</p>
              </div>
              {s.id === "ai-edit" ? (
                <AiEditFrame />
              ) : (
                <Button variant="outline" size="sm" className="self-start" onClick={() => fire(s.id)}>
                  הצגת הטוסט
                </Button>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}

export default function LongWaitNoteTestPage() {
  // Owner gate, same as /test/queue-empty.
  const router = useRouter()
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      setGranted(true)
      return
    }
    getCurrentUser(createClient()).then(({ data: { user } }) => {
      if (isOwner(user?.email)) setGranted(true)
      else {
        setGranted(false)
        router.replace("/")
      }
    })
  }, [router])

  if (granted !== true) return <div className="min-h-screen bg-bg-surface" />
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
