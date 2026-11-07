"use client"

/**
 * State preview for "תעשה לי כזה" in the carousel AI panel (Hani,
 * 2026-11-07): a carousel she points at is a STRUCTURE to copy, rebuilt with
 * the post's text.
 *
 * Route: /test/carousel-copy?state=link|failed|shots|ask
 *   link   — she sent a link the slides could be read from: the panel says
 *            it will follow it and asks how to design — "בשפת המותג שלי"
 *            (primary) / "בדיוק כמו בקרוסלה".
 *   failed — the link couldn't be read (a personal / private account, or
 *            only one picture): the panel asks for screenshots instead.
 *   shots  — she attached screenshots of the slides: the same question.
 *   ask    — she asked for "כזה" with nothing attached: the panel asks for a
 *            link or screenshots.
 *   needs  — the reference (a tweet) needs her profile picture, name and @
 *            and some are missing: the panel asks for exactly that, with
 *            "להוסיף תמונת פרופיל" / "להמשיך בלי". Nothing is built yet.
 *   style  — 3 tweet screenshots attached before the first generation (they
 *            sit in the slide slots); type "תעשה לי את כל הקרוסלה בשפה הזו
 *            בסגנון tweet" and the row turns into a design reference — no
 *            slots. (Sending needs a login to upload, so here it stops there.)
 *   live   — the real flow from the start: type "תעשו לי כזה" (+ a link) and
 *            send. Here there's no login, so a link always comes back
 *            unreadable and screenshots can't upload — it shows the asks.
 *
 * The REAL MediaAiChat, seeded with the conversation. Nothing is sent: no
 * generation, no credits, no DB write (the answers do nothing here).
 */

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MediaAiChat, type ChatMessage, type CopyStep } from "@/components/media-ai-chat"
import { openingId, type AiEditOpening } from "@/lib/ai-edit-intent"
import { missingMessage } from "@/lib/card-identity"

const STATES = [
  { id: "link", label: "לינק שנקרא — השאלה" },
  { id: "failed", label: "לינק שלא נקרא — בקשה לצילומי מסך" },
  { id: "shots", label: "צילומי מסך — השאלה" },
  { id: "ask", label: "ביקשו כזה בלי לצרף" },
  { id: "needs", label: "חסרים פרטים — תמונת פרופיל ו-@" },
  { id: "style", label: "3 צילומי מסך + בקשת סגנון (להקליד)" },
  { id: "live", label: "לכתוב בעצמכם (״תעשו לי כזה״ + לינק)" },
] as const
type State = (typeof STATES)[number]["id"]

const SHOTS = [
  "/images/carousel-templates/ai-dark.png",
  "/images/carousel-templates/ai-light.png",
  "/images/carousel-templates/ai-amber.png",
  "/images/carousel-templates/ai-ice.png",
]
const OPEN = "אייצר לכם את הקרוסלה מדף חלק.\nספרו לי מה אתם רואים בראש: צבעים, אווירה, מה יופיע ומה ממש לא."
const LINK = "https://www.instagram.com/p/DExample123/"

function conversation(state: State, origin: string): { messages: ChatMessage[]; copy: CopyStep } {
  const shots = SHOTS.map((p) => `${origin}${p}`)
  if (state === "link")
    return {
      messages: [
        { role: "assistant", content: OPEN },
        { role: "user", content: `תעשו לי כזה ${LINK}` },
        { role: "assistant", content: "עכשיו אעקוב אחרי הלינק ששלחתם ואייצר קרוסלה עם הטקסט שלכם. איך לעצב אותה?", copyAsk: true },
      ],
      copy: { phase: "choose", refs: shots, brief: "תעשו לי כזה" },
    }
  if (state === "failed")
    return {
      messages: [
        { role: "assistant", content: OPEN },
        { role: "user", content: `אפשר קרוסלה כמו זה? ${LINK}` },
        { role: "assistant", content: "אי אפשר לקרוא לינק מחשבון אישי או לא ציבורי. שימו לי כאן צילומי מסך של השקופיות ואפעל לפיהם." },
      ],
      copy: { phase: "await" },
    }
  if (state === "needs")
    return {
      messages: [
        { role: "assistant", content: OPEN },
        { role: "user", content: "תעשה לי את כל הקרוסלה בשפה הזו בסגנון tweet", images: shots.slice(0, 3) },
        { role: "assistant", content: "בונה את הקרוסלה כמו ברפרנס, עם הטקסט שלכם." },
        { role: "user", content: "בדיוק כמו בקרוסלה" },
        { role: "assistant", content: missingMessage(["avatar", "name", "handle"]), needInfo: true },
      ],
      copy: { phase: "needs", refs: shots.slice(0, 3), brief: "בסגנון tweet", mode: "exact", needs: ["avatar", "name", "handle"] },
    }
  if (state === "shots")
    return {
      messages: [
        { role: "assistant", content: OPEN },
        { role: "user", content: "בדיוק כזה", images: shots },
        { role: "assistant", content: "קיבלתי את צילומי המסך. אייצר קרוסלה באותו מבנה עם הטקסט שלכם. איך לעצב אותה?", copyAsk: true },
      ],
      copy: { phase: "choose", refs: shots, brief: "בדיוק כזה" },
    }
  return {
    messages: [
      { role: "assistant", content: OPEN },
      { role: "user", content: "תעשו לי קרוסלה כזאת" },
      { role: "assistant", content: "שלחו לי לינק לקרוסלה או צילומי מסך של השקופיות, ואייצר לכם אחת כזאת עם הטקסט שלכם." },
    ],
    copy: { phase: "await" },
  }
}

function Page() {
  const params = useSearchParams()
  const raw = params.get("state")
  const state: State = STATES.find((s) => s.id === raw)?.id ?? "link"
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  )
  const seeded = useMemo(() => conversation(state, origin), [state, origin])
  const [seedFiles, setSeedFiles] = useState<{ preview: File; kind: "image" }[] | null>(null)
  useEffect(() => {
    if (state !== "style") return
    let live = true
    void Promise.all(
      SHOTS.slice(0, 3).map(async (p, i) => {
        const blob = await (await fetch(p)).blob()
        return { preview: new File([blob], `tweet-${i + 1}.png`, { type: blob.type || "image/png" }), kind: "image" as const }
      }),
    ).then((f) => live && setSeedFiles(f))
    return () => {
      live = false
    }
  }, [state])
  const opening = useMemo<AiEditOpening | null>(
    () =>
      state === "live" || state === "style"
        ? {
            id: openingId(),
            kind: "generate",
            style: "blank",
            placeRefs: true,
            run: async () => ({ ok: false, message: "זו תצוגה מקדימה — לא נוצר כלום." }),
          }
        : null,
    [state],
  )
  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
      on ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
    }`
  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link key={s.id} href={`/test/carousel-copy?state=${s.id}`} className={pill(s.id === state)}>
            {s.label}
          </Link>
        ))}
      </div>
      {origin && (state !== "style" || seedFiles) && (
        <MediaAiChat
          key={state}
          postId={`test-carousel-copy-${state}`}
          format="carousel"
          open
          currentUrls={[]}
          slideCount={state === "style" ? 3 : 6}
          opening={opening}
          initialMessages={state === "live" || state === "style" ? undefined : seeded.messages}
          seedCopy={state === "live" || state === "style" ? undefined : seeded.copy}
          seedAttachments={state === "style" ? seedFiles ?? undefined : undefined}
          forceCopyStructure
          onOpenChange={() => {}}
        />
      )}
    </div>
  )
}

export default function CarouselCopyTestPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  )
}
