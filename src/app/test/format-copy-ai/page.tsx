"use client"

/**
 * State preview for "עריכה עם AI" on a format's copy.
 *
 * Route: /test/format-copy-ai[?state=closed|open|generating|proposal|applied|error]
 * No param = every state side by side. Each state is the real FormatCopyChat
 * + FormatCopyActionRow driven by the real controller, answered by a local
 * responder: no fetch, no model call, no DB write (no learning callback).
 */

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { COPY_REFINE_ERROR_COPY } from "@/lib/format-copy-refine"
import { FormatCopyChat } from "@/components/format-copy-ai/format-copy-chat"
import { FormatCopyActionRow } from "@/components/format-copy-ai/format-copy-entry"
import { useFormatCopyAi, type CopyRefineResponder } from "@/components/format-copy-ai/use-format-copy-ai"

type PreviewState = "closed" | "open" | "generating" | "proposal" | "applied" | "error"

const STATES: { id: PreviewState; title: string; description: string }[] = [
  { id: "closed", title: "סגור", description: "שני הכפתורים אחד ליד השני מתחת לטקסט של הכרטיס." },
  { id: "open", title: "פאנל פתוח", description: "הפאנל של פוסט הליבה, לפורמט אחד, עם הצעות מהירות לפורמט." },
  { id: "generating", title: "בזמן יצירה", description: "הטקסט בכרטיס מהבהב, הפאנל מראה שהוא עובד." },
  { id: "proposal", title: "הצעה לשינוי", description: "השינוי כבר בכרטיס. שמירה או ביטול בפאנל." },
  { id: "applied", title: "נשמר", description: "אחרי שמירה: אישור ירוק, ואפשר לבקש עוד שינוי." },
  { id: "error", title: "שגיאה", description: "השרת עמוס. ניסיון חוזר שולח שוב את אותה בקשה." },
]

const HOOK = "שלוש שאלות ששאלתי את עצמי לפני שהעליתי מחיר"
const INSTRUCTION = "תקצרו לי את זה ל-4 שקופיות"

const CAROUSEL = `שקופית 1
${HOOK}

שקופית 2
שנה שלמה פחדתי לגעת במחיר. כל פגישת מכירה הרגישה כמו התנצלות.

שקופית 3
שאלה 1: מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי?

שקופית 4
שאלה 2: מי מהם היה משלם יותר בלי לחשוב פעמיים?

שקופית 5
שאלה 3: מה הכי גרוע שיקרה אם מישהו יגיד לא?

שקופית 6
רוצות את שלוש השאלות בקובץ אחד? כתבו "מחיר" בתגובות.`

const REVISED = `שקופית 1
${HOOK}

שקופית 2
שנה שלמה פחדתי לגעת במחיר. שלוש שאלות שינו את זה.

שקופית 3
1. מה משתנה אצל הלקוחות שלי אחרי שלושה חודשים איתי?
2. מי מהם היה משלם יותר בלי לחשוב פעמיים?
3. מה הכי גרוע שיקרה אם מישהו יגיד לא?

שקופית 4
רוצות את השאלות בקובץ? כתבו "מחיר" בתגובות.`

function StatePreview({ state }: { state: PreviewState }) {
  const [text, setText] = useState(CAROUSEL)
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  })
  const failedRef = useRef(false)

  const responder: CopyRefineResponder = async () => {
    if (state === "generating") return new Promise<never>(() => {})
    await new Promise((r) => setTimeout(r, 200))
    if (state === "error" && !failedRef.current) {
      failedRef.current = true
      throw new Error(COPY_REFINE_ERROR_COPY.anthropic_overloaded)
    }
    return {
      reply: "איחדתי את שלוש השאלות לשקופית אחת וקיצרתי את הפתיחה. עכשיו יש 4 שקופיות.",
      revisedText: REVISED,
    }
  }

  const ctrl = useFormatCopyAi({
    getText: () => textRef.current,
    setText: (_fid, t) => setText(t),
    hook: HOOK,
    responder,
  })

  const started = useRef(false)
  useEffect(() => {
    if (started.current || state === "closed") return
    started.current = true
    ctrl.open("carousel")
    if (state !== "open") ctrl.send("carousel", INSTRUCTION)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // "applied": keep the proposal as soon as it lands.
  const pending = ctrl.pendingIndex("carousel")
  useEffect(() => {
    if (state === "applied" && pending >= 0) ctrl.keep("carousel", pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending])

  return (
    <div dir="rtl" className="flex flex-wrap items-start gap-6">
      {/* The format card, as on /project. */}
      <div className="flex w-[346px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6">
        <div className="flex items-center gap-2 rounded-t-[20px] bg-bg-surface px-6 py-3">
          <span className="text-p-bold text-text-primary-default">קרוסלה</span>
          <Layers className="size-4 text-text-neutral-default" />
        </div>
        <div className="flex flex-col gap-3 px-6">
          <div
            className={`min-h-[200px] whitespace-pre-wrap rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 text-small leading-relaxed text-text-primary-default ${ctrl.isBusy("carousel") ? "ai-text-shimmer" : ""}`}
          >
            {text}
          </div>
          <FormatCopyActionRow ctrl={ctrl} fid="carousel" hasMedia={false}>
            <Button
              variant="outline"
              className="w-full rounded-[10px] border-border-neutral-default text-text-primary-default text-small gap-2"
            >
              <Layers className="size-4" />
              הוספת מדיה
            </Button>
          </FormatCopyActionRow>
        </div>
      </div>
      <FormatCopyChat ctrl={ctrl} floating={false} />
    </div>
  )
}

function Previews() {
  const only = useSearchParams().get("state") as PreviewState | null
  const shown = only ? STATES.filter((s) => s.id === only) : STATES
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-8">
      <h1 className="mb-1 text-p-bold text-text-primary-default">עריכה עם AI לקופי של פורמט</h1>
      <p className="mb-8 text-small text-text-neutral-default">כל המצבים, בלי קריאה ל-AI ובלי כתיבה ל-DB.</p>
      <div className="flex flex-col gap-12">
        {shown.map((s) => (
          <section key={s.id} className="flex flex-col gap-3">
            <div>
              <h2 className="text-p-bold text-text-primary-default">{s.title}</h2>
              <p className="text-small text-text-neutral-default">{s.description}</p>
            </div>
            <StatePreview state={s.id} />
          </section>
        ))}
      </div>
    </div>
  )
}

export default function FormatCopyAiTestPage() {
  return (
    <Suspense>
      <Previews />
    </Suspense>
  )
}
