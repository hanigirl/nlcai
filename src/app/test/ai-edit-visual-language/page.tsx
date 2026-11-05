"use client"

/**
 * State preview — "עריכת קרוסלה עם AI" after an edit (Hani, 2026-11-05).
 *
 * Route: /test/ai-edit-visual-language
 *   ?state=applied    — the edit changed the slides: "עדכנתי…" + "הוחל."
 *   ?state=unchanged  — the edit ran but the slides came out the same: the
 *                       panel says so, nothing is saved, no "הוחל."
 *   ?state=image-missing — she asked to put in a picture that wasn't attached:
 *                       nothing is edited, nothing invented, she's asked for it.
 *   ?state=place-failed  — the picture was attached but didn't make it in:
 *                       nothing is saved, the panel says so.
 *   ?state=unsaved-carousel — the card shows slides the post never stored.
 *   ?state=broll-own-picture — a b-roll built on her picture: it's never repainted.
 *   ?state=broll-picture-failed — a change to the b-roll's picture didn't land.
 *   ?state=broll-blend-failed — her attached picture didn't blend into the b-roll's scene.
 *   (no param)        — all of them, side by side.
 *
 * The real panel (MediaAiChat) opened on a finished conversation. Nothing is
 * sent: no fetch, no AI credits, no DB writes.
 */

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MediaAiChat, mediaChatKey, type ChatMessage } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"

const ASK = "תערוך את הקרוסלה הזו לפי שפת המותג המחודשת שהגדרתי בשפה הויזואלית"
const BROLL_INTRO = "מה לשנות בבי-רול? למשל גודל הכותרת, צבעים, איך המילים נכנסות או התזמון. אעדכן את האנימציה והסרטון יתחלף בכרטיס."
const INTRO = "מה לשנות בקרוסלה? אפשר לבקש על כל השקופיות או על שקופית מסוימת, למשל ״בשקופית 3 הכותרת בצבע המותג״."

// The exact copy the server and panel use for each state.
type StateId = "applied" | "unchanged" | "image-missing" | "place-failed" | "unsaved-carousel" | "broll-own-picture" | "broll-picture-failed" | "broll-blend-failed"

const STATES: { id: StateId; title: string; format?: "carousel" | "b_roll"; messages: ChatMessage[] }[] = [
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
  {
    id: "image-missing",
    title: "ביקשה לשים תמונה שלא צורפה",
    messages: [
      { role: "assistant", content: INTRO },
      { role: "user", content: "תחליף את התמונה של האישה בדמות שלי מהקרוסלה" },
      {
        role: "assistant",
        error: true,
        content:
          "לא קיבלתי את התמונה שביקשתם לשים, אז לא שיניתי כלום ולא המצאתי תמונה אחרת. צרפו אותה כאן בהודעה (כפתור התמונה ליד השליחה) ונסו שוב.",
      },
    ],
  },
  {
    id: "place-failed",
    title: "התמונה צורפה, אבל לא נכנסה",
    messages: [
      { role: "assistant", content: INTRO },
      { role: "user", content: "תחליף את האישה בתמונה הזו", images: ["/images/paper-plane-celebrate.png"] },
      {
        role: "assistant",
        error: true,
        content: "לא הצלחתי לשים את התמונה ששלחתם הפעם, אז השארתי את המדיה כמו שהייתה. נסו שוב, ואפשר לכתוב איפה בדיוק לשים אותה.",
      },
    ],
  },
  {
    id: "unsaved-carousel",
    title: "השקופיות בכרטיס לא נשמרו בפוסט",
    messages: [
      { role: "assistant", content: INTRO },
      { role: "user", content: "זו התמונה הנכונה בסלייד הראשון. תחליף את התמונה הקיימת", images: ["/images/paper-plane-celebrate.png"] },
      {
        role: "assistant",
        error: true,
        content:
          "השקופיות שמופיעות בכרטיס לא נשמרו בפוסט, אז אין לי מה לערוך. צרו את הקרוסלה שוב (עכשיו היא נשמרת מיד), ואז ערכו אותה.",
      },
    ],
  },
  {
    id: "broll-own-picture",
    title: "בי-רול על התמונה שלה: ביקשה לצייר אותה מחדש",
    format: "b_roll",
    messages: [
      { role: "assistant", content: BROLL_INTRO },
      { role: "user", content: "שהאישה ברקע תחייך" },
      {
        role: "assistant",
        error: true,
        content: "התמונה שברקע היא שלכם, ואותה אני לא מצייר מחדש. אפשר לשנות את הטקסט והתנועה, או לצרף תמונה אחרת שתחליף אותה.",
      },
    ],
  },
  {
    id: "broll-blend-failed",
    title: "בי-רול: התמונה שצורפה לא השתלבה",
    format: "b_roll",
    messages: [
      { role: "assistant", content: BROLL_INTRO },
      { role: "user", content: "שים את האישה הזו במקום האישה הקיימת בבירול", images: ["/images/paper-plane-celebrate.png"] },
      {
        role: "assistant",
        error: true,
        content: "לא הצלחתי לשלב את התמונה ששלחתם ברקע הפעם, אז השארתי את הבי-רול כמו שהיה. נסו שוב, ואם תרצו אותה בדיוק כמו שהיא, כתבו ״כמו שהיא״.",
      },
    ],
  },
  {
    id: "broll-picture-failed",
    title: "בי-רול: שינוי בתמונה שלא נכנס",
    format: "b_roll",
    messages: [
      { role: "assistant", content: BROLL_INTRO },
      { role: "user", content: "שהאישה ברקע תחייך" },
      {
        role: "assistant",
        error: true,
        content: "לא הצלחתי לשנות את התמונה שברקע הפעם, אז השארתי את הבי-רול כמו שהיה. נסו שוב, ואפשר לכתוב בדיוק מה לשנות בה.",
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
    STATES.forEach((s) => clearChat(mediaChatKey(`preview-vl-${s.id}`, s.format ?? "carousel")))
    setReady(true)
  }, [])

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <h1 className="mb-6 text-p-bold text-text-primary-default">עריכה עם AI — אחרי עריכה</h1>
      <div className="flex flex-wrap gap-6">
        {shown.map((s) => (
          <section key={s.id} className="flex flex-col gap-2">
            <h2 className="text-small-bold text-text-neutral-default">{s.title}</h2>
            {/* transform = the panel's fixed position is relative to this frame, so states sit side by side. */}
            <div className="relative h-[560px] w-[420px] [transform:translateZ(0)] rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10">
              {ready && (
                <MediaAiChat
                  postId={`preview-vl-${s.id}`}
                  format={s.format ?? "carousel"}
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
