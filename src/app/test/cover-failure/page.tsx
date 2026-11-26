"use client"

/**
 * State preview for what she sees when a talking-head cover can't be made
 * (bug 2026-11-21: "בדיבור למצלמה המערכת לא מצליחה ליצור קאבר").
 *
 * Route: /test/cover-failure — every state as a list, or one with
 * ?state=timeout|server|provider|offline, which also pops the real toast.
 * Each message comes from the same helper the cover buttons use
 * (lib/cover-frame → coverFailureMessage), fed a sample answer built here.
 * No fetches, no DB writes.
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { coverFailureMessage } from "@/lib/cover-frame"

type State = "timeout" | "server" | "provider" | "offline"

const OFFLINE = "אין חיבור לשרת כרגע. בדקו את החיבור לאינטרנט ונסו שוב."

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const STATES: { id: State; title: string; description: string; answer: () => Response | null }[] = [
  {
    id: "timeout",
    title: "השרת לא הספיק",
    description: "הפלטפורמה עצרה את הבקשה (504, בלי JSON). זה מה שקרה בבאג, אחרי 5 דקות של המתנה.",
    answer: () => new Response("<html>An error occurred</html>", { status: 504 }),
  },
  {
    id: "server",
    title: "היצירה נכשלה בשרת",
    description: "השרת ענה בשגיאה עם הודעה בעברית.",
    answer: () => json({ error: "Failed to generate cover: x", message: "לא הצלחתי ליצור קאבר הפעם. נסו שוב." }, 500),
  },
  {
    id: "provider",
    title: "מפתח Claude לא תקין",
    description: "קריאת דוגמאות הקאבר נפלה על המפתח. ההודעה אומרת מה לעשות.",
    answer: () => json({ error: "x", message: "מפתח ה-API של Claude לא תקין (הגדרות ← חיבור חשבונות)." }, 500),
  },
  {
    id: "offline",
    title: "אין חיבור",
    description: "הבקשה לא יצאה מהדפדפן בכלל.",
    answer: () => null,
  },
]

function isState(v: string | null): v is State {
  return STATES.some((s) => s.id === v)
}

async function messageFor(s: (typeof STATES)[number]): Promise<string> {
  const res = s.answer()
  return res ? coverFailureMessage(res) : OFFLINE
}

function Row({ state }: { state: (typeof STATES)[number] }) {
  const [text, setText] = useState<string>("")
  useEffect(() => { void messageFor(state).then(setText) }, [state])
  return (
    <div className="flex flex-col gap-2 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 p-6 w-[360px]">
      <p className="text-p-bold text-text-primary-default">{state.title}</p>
      <p className="text-xs text-text-neutral-default">{state.description}</p>
      <p className="text-sm text-text-primary-default rounded-lg bg-bg-surface px-3 py-2">{text}</p>
      <Button variant="outline" size="sm" className="self-start" onClick={() => toast.error(text)} disabled={!text}>
        הצגת ההודעה
      </Button>
    </div>
  )
}

function Preview() {
  const params = useSearchParams()
  const only = params.get("state")
  const shown = isState(only) ? STATES.filter((s) => s.id === only) : STATES
  useEffect(() => {
    if (!isState(only)) return
    const s = STATES.find((x) => x.id === only)!
    void messageFor(s).then((m) => toast.error(m))
  }, [only])
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8 flex flex-col gap-6">
      <h1 className="text-p-bold text-text-primary-default">דיבור למצלמה · כשהקאבר לא נוצר</h1>
      <div className="flex flex-wrap gap-6">
        {shown.map((s) => <Row key={s.id} state={s} />)}
      </div>
    </div>
  )
}

export default function CoverFailureTestPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
