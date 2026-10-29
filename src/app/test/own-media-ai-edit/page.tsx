"use client"

/**
 * State preview for "עריכת מדיה עם AI" on media she brought herself
 * (Hani, 2026-10-29): the AI adds on top or takes away — caption, extra AI
 * slides, order — and never changes what she filmed.
 *
 * Route: /test/own-media-ai-edit?media=video-story|image-story|carousel|image-post|b-roll
 *   …&state=anim-planning|anim-rendering|anim-added|anim-error — she asks for
 *   a new story frame with ANIMATED text (the b-roll engine, ~3 min for real).
 *   Here the render is stubbed: the "clip" is a CSS stand-in drawn by this
 *   page. On a carousel / single image the planner's answer offers the story
 *   instead (never "can't animate").
 *   …&state=anim-edit-working|anim-edit-done|anim-edit-error|anim-edit-remade —
 *   a story whose frame 3 is an animated frame the AI made (loud white
 *   background). She asks: "בפריים 3 תוריד את הרקע הבומבסטי הלבן, ופשוט
 *   תכתוב בלבן…". The plan is edit_animated_frame: frame 3 is changed IN
 *   PLACE (plain dark background, white text) — no second frame is added.
 *   `remade`: an older frame with no stored composition, made again, and the
 *   reply says so in one line. These states always use the image story.
 *                               &state=idle|working|caption|slide|refused|error|reopen
 *
 * `reopen` — the panel keeps its conversation (lib/ai-chat-session-store):
 * nothing is sent for you; ask something (a chip or your own words), the
 * edit takes ~6 s; close the panel (X / outside click) while it works,
 * reopen it with the sparkle and it is still working, then the reply lands —
 * or leave it closed: when the reply lands the panel opens by itself on it.
 * Close and reopen again, or reload: the conversation and the half-typed text
 * come back. "שיחה חדשה" in the header starts over. The other states start
 * clean on every load.
 *
 * The real panel (MediaAiChat with `own`) and the real executor
 * (lib/own-media-edit) run against a stubbed `fetch`: the plan, the caption
 * renders, the new slide and the save all answer from here. Nothing reaches
 * the network — no AI credits, no DB writes. A "caption" on the sample media
 * is drawn by this page from the stub's URL, standing in for the real burn.
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Film, Image as ImageIcon, Layers, Play, Smartphone } from "lucide-react"
import { MediaAiChat, mediaChatKey, type AiEditFormat } from "@/components/media-ai-chat"
import { clearChat } from "@/lib/ai-chat-session-store"
import { useChatRevealer } from "@/lib/ai-chat-reveal"
import { AI_HOVER_ZONE, AiHoverEditButton } from "@/components/ai-hover-edit"
import type { OwnEditPlan, OwnFrameInfo } from "@/lib/own-media"

const POST_ID = "preview-own-media-post"
const PHOTO = "/images/onboarding-hero.png"
const PHOTO_2 = "/images/paper-plane-celebrate.png"
const PHOTO_3 = "/images/paper-plane-empty.png"
const AI_SLIDE = "/images/carousel-templates/ai-dark.png"

type MediaId = "video-story" | "image-story" | "carousel" | "image-post" | "b-roll"
type Sample = {
  id: MediaId
  label: string
  format: AiEditFormat
  frames: { src: string; kind: "image" | "video"; caption?: string }[]
  title: string
  icon: typeof Film
  aspect: string
}

const MEDIA: Sample[] = [
  {
    id: "video-story",
    label: "סטורי וידאו מהדרייב",
    format: "story",
    title: "הסטורי שלכם",
    icon: Smartphone,
    aspect: "aspect-[9/16] w-[200px]",
    frames: [{ src: PHOTO, kind: "video", caption: "תיק העבודות שלי מעודכן. ל-2024." }],
  },
  {
    id: "image-story",
    label: "סטורי תמונות מהדרייב",
    format: "story",
    title: "הסטורי שלכם",
    icon: Smartphone,
    aspect: "aspect-[9/16] w-[200px]",
    frames: [
      { src: PHOTO, kind: "image", caption: "תיק העבודות שלי מעודכן. ל-2024." },
      { src: PHOTO_2, kind: "image", caption: "הוא מראה מה עשיתי. לא איך אני חושבת." },
    ],
  },
  {
    id: "carousel",
    label: "קרוסלה מהדרייב",
    format: "carousel",
    title: "הקרוסלה שלכם",
    icon: Layers,
    aspect: "aspect-[4/5] w-[240px]",
    frames: [
      { src: PHOTO, kind: "image", caption: "תיק העבודות שלי מעודכן" },
      { src: PHOTO_2, kind: "image", caption: "מה הוא מראה" },
      { src: PHOTO_3, kind: "image", caption: "ומה הוא צריך להראות" },
    ],
  },
  {
    id: "image-post",
    label: "פוסט תמונה שלי",
    format: "image_post",
    title: "התמונה שלכם",
    icon: ImageIcon,
    aspect: "aspect-[4/5] w-[200px]",
    frames: [{ src: PHOTO, kind: "image", caption: "תיק העבודות שלי מעודכן. ל-2024." }],
  },
  {
    id: "b-roll",
    label: "בי-רול מהדרייב",
    format: "b_roll",
    title: "הבי-רול שלכם",
    icon: Film,
    aspect: "aspect-[9/16] w-[200px]",
    frames: [{ src: PHOTO, kind: "video", caption: "תיק העבודות שלי מעודכן. ל-2024." }],
  },
]

const STATES = [
  { id: "idle", label: "פתיחה" },
  { id: "working", label: "בזמן עריכה" },
  { id: "caption", label: "הכיתוב השתנה" },
  { id: "slide", label: "נוספה שקופית" },
  { id: "refused", label: "״את מה שצילמתם לא משנים״" },
  { id: "error", label: "שגיאה" },
  { id: "anim-planning", label: "מונפש: מתכננים" },
  { id: "anim-rendering", label: "מונפש: מרנדרים" },
  { id: "anim-added", label: "מונפש: נוסף" },
  { id: "anim-error", label: "מונפש: שגיאה" },
  { id: "anim-edit-working", label: "עריכת מונפש: בעבודה" },
  { id: "anim-edit-done", label: "עריכת מונפש: עודכן" },
  { id: "anim-edit-error", label: "עריכת מונפש: שגיאה" },
  { id: "anim-edit-remade", label: "עריכת מונפש: פריים ישן, נוצר מחדש" },
  { id: "reopen", label: "סגירה ופתיחה מחדש" },
] as const
type State = (typeof STATES)[number]["id"]

const ANIM_ASK = "להוסיף בסוף פריים עם טקסט מונפש: רוצים תיק שמספר איך אתם חושבים?"
const ANIM_TEXT = "רוצים תיק שמספר איך אתם חושבים?"
/** Stands in for the rendered clip: the page draws the animated text itself. */
const ANIM_CLIP = "/preview/ai-anim.mp4"
/** An animated frame the AI made, at the path the executor recognises as one. */
const ANIM_FRAME = "/preview/story/ai-anim-00000000-0000-4000-8000-000000000000.mp4"
const ANIM_FRAME_TEXT = "רוצים תיק שמספר איך אתם חושבים?"
const EDIT_ASK = "אהבתי מאוד, אבל בפריים 3 תוריד את הרקע הבומבסטי הלבן, ופשוט תכתוב בלבן ״תיק שמראה איך אתם חושבים״"
const EDIT_TEXT = "תיק שמראה איך אתם חושבים"
const isAnimEdit = (s: State) => s.startsWith("anim-edit-")

/** Where a stand-in clip says what it shows: its words and its look. */
function animUrl(base: string, text: string, look: "loud" | "plain") {
  return `${base}?t=${Date.now()}&anim=${encodeURIComponent(text)}&look=${look}`
}

/** What the preview auto-sends for each non-idle state. */
const ASK: Record<Exclude<State, "idle">, string> = {
  working: "לשנות את הכיתוב ל: התיק שלכם מספר את הסיפור הלא נכון",
  caption: "לשנות את הכיתוב ל: התיק שלכם מספר את הסיפור הלא נכון, ולהזיז אותו למעלה",
  slide: "להוסיף פריים סיום עם קריאה לפעולה",
  refused: "תבהירי לי את הסרטון ותורידי את הרקע",
  error: "להוריד את הכיתוב",
  "anim-planning": ANIM_ASK,
  "anim-rendering": ANIM_ASK,
  "anim-added": ANIM_ASK,
  "anim-error": ANIM_ASK,
  "anim-edit-working": EDIT_ASK,
  "anim-edit-done": EDIT_ASK,
  "anim-edit-error": EDIT_ASK,
  "anim-edit-remade": EDIT_ASK,
  reopen: "לשנות את הכיתוב ל: התיק שלכם מספר את הסיפור הלא נכון",
}

/** A stubbed render URL carries the caption it stands for, so the card can draw it. */
function captioned(src: string, text: string | undefined, pos = "bottom") {
  const u = new URL(src, "http://preview.local")
  u.searchParams.delete("cap")
  u.searchParams.delete("pos")
  if (text) {
    u.searchParams.set("cap", text)
    u.searchParams.set("pos", pos)
  }
  return u.pathname + (u.search || "")
}

function readCaption(url: string): { src: string; cap?: string; pos: string } {
  const u = new URL(url, "http://preview.local")
  return { src: u.pathname, cap: u.searchParams.get("cap") ?? undefined, pos: u.searchParams.get("pos") ?? "bottom" }
}

function frameUrl(f: Sample["frames"][number], i: number) {
  // Video frames get a path the executor reads as video.
  const base = f.kind === "video" ? `${f.src}?v=${i}.mp4` : `${f.src}?i=${i}`
  return f.caption ? `${base}&cap=${encodeURIComponent(f.caption)}&pos=bottom` : base
}

function cannedPlan(state: State, instruction: string, frames: OwnFrameInfo[], format: AiEditFormat): OwnEditPlan | "error" | "hang" {
  const n = frames.length
  const all = frames.map((_, i) => i + 1)
  const isSet = format === "story" || format === "carousel"
  const kind = state === "idle" || state === "reopen"
    ? /מונפש|אנימציה|תנועה/.test(instruction) ? "anim"
      : /סיום|שקופית|פריים/.test(instruction) && isSet ? "slide"
      : /להוריד/.test(instruction) ? "remove"
      : /להזיז/.test(instruction) ? "move"
      : /הרקע|להבהיר|תבהירי|פילטר/.test(instruction) ? "refused"
      : "caption"
    : state
  if (isAnimEdit(state)) {
    return {
      reply: `בפריים ${n} הורדתי את הרקע הלבן הבומבסטי, ועכשיו כתוב עליו בלבן ״${EDIT_TEXT}״, פשוט ונקי.`,
      ops: [
        {
          op: "edit_animated_frame",
          frame: n,
          instruction: instruction,
          design: "בלי הרקע הבומבסטי הלבן, רקע פשוט, טקסט לבן ופשוט",
          headline: EDIT_TEXT,
        },
      ],
    }
  }
  const animKind = state === "anim-planning" ? "working" : state.startsWith("anim-") ? "anim" : kind
  if (animKind === "working") return "hang"
  if (animKind === "anim") {
    if (format !== "story") {
      return {
        reply: isSet
          ? "פריים עם טקסט מונפש אפשר להוסיף לסטורי. כאן בקרוסלה אוכל להוסיף שקופית סטטית באותו נוסח, רוצים?"
          : "פריים עם טקסט מונפש אפשר להוסיף לסטורי. כאן אפשר לשנות את הכיתוב על התמונה.",
        ops: [],
      }
    }
    return {
      reply: "הוספתי בסוף פריים עם הטקסט מונפש, בשפה הוויזואלית שלכם.",
      ops: [{ op: "add_animated_slide", after: n, headline: ANIM_TEXT, role: "closing" }],
    }
  }
  if (kind === "error") return "error"
  if (kind === "working") return "hang"
  if (kind === "refused") {
    return {
      reply: "את מה שצילמתם אני לא משנה, כולל האור והרקע. אפשר לשנות, להזיז או להוריד את הכיתוב עליו.",
      ops: [],
      refused: true,
    }
  }
  if (kind === "slide") {
    return {
      reply: "הוספתי פריים סיום עם קריאה לפעולה, בשפה הוויזואלית שלכם.",
      ops: [{ op: "add_slide", after: n, headline: "רוצים תיק שמספר איך אתם חושבים?", body: "כתבו לי ״תיק״ בתגובות", role: "closing" }],
    }
  }
  if (kind === "remove") return { reply: "הורדתי את הכיתוב.", ops: [{ op: "remove_caption", frames: all }] }
  if (kind === "move") return { reply: "הזזתי את הכיתוב למעלה.", ops: [{ op: "set_caption", frames: all, position: "top" }] }
  const text = instruction.split(":").slice(1).join(":").split(",")[0].trim() || "התיק שלכם מספר את הסיפור הלא נכון"
  return {
    reply: state === "caption" ? "החלפתי את הכיתוב בפריים 1 והזזתי אותו למעלה." : "החלפתי את הכיתוב.",
    ops: [{ op: "set_caption", frames: [1], headline: text, body: undefined, position: state === "caption" ? "top" : undefined }],
  }
}

/** The AI-made animated frame the anim-edit states start with (one URL per page load). */
let startAnimUrl: string | null = null
function animFrameInfo(): OwnFrameInfo {
  startAnimUrl ??= animUrl(ANIM_FRAME, ANIM_FRAME_TEXT, "loud")
  return { url: startAnimUrl, kind: "video", aiMade: true, caption: "baked" }
}

function stubFetch(state: State, sample: Sample) {
  const ok = (body: unknown, status = 200, delay = 700) =>
    new Promise<Response>((resolve) =>
      setTimeout(
        () => resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
        delay,
      ),
    )
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (url.includes("/api/media/own-edit")) {
      if (body.action === "slide") return ok({ url: `${AI_SLIDE}?slide=${Date.now()}` }, 200, 1200)
      if (body.action === "animated_slide") {
        if (state === "anim-rendering") return new Promise<Response>(() => {})
        if (state === "anim-error") return ok({ message: "האנימציה לא יצאה תקינה הפעם. נסו שוב." }, 500, 1500)
        const text = encodeURIComponent(String(body.headline ?? ANIM_TEXT))
        return ok({ url: `${ANIM_CLIP}?t=${Date.now()}&anim=${text}` }, 200, 2500)
      }
      if (body.action === "edit_animated_frame") {
        if (state === "anim-edit-working") return new Promise<Response>(() => {})
        if (state === "anim-edit-error") {
          return ok({ message: "העריכה של הפריים המונפש לא יצאה תקינה הפעם. נסו שוב." }, 500, 1500)
        }
        const words = String(body.headline ?? ANIM_FRAME_TEXT)
        return ok(
          {
            url: animUrl(ANIM_FRAME.replace("00000000-0000-4000-8000-000000000000", "11111111-1111-4111-8111-111111111111"), words, "plain"),
            remade: state === "anim-edit-remade",
          },
          200,
          2500,
        )
      }
      if (body.action === "save") return ok({ urls: body.urls }, 200, 300)
      const frames: OwnFrameInfo[] = [...sample.frames.map((f, i): OwnFrameInfo => {
        const u = frameUrl(f, i)
        return {
          url: u,
          kind: f.kind,
          aiMade: false,
          caption: "ours",
          record: { v: 1, sourceUrl: f.kind === "video" ? `${f.src}?v=${i}.mp4` : `${f.src}?i=${i}`, caption: { headline: f.caption, position: "bottom" } },
        }
      }), ...(isAnimEdit(state) ? [animFrameInfo()] : [])]
      const plan = cannedPlan(state, String(body.instruction ?? ""), frames, sample.format)
      if (plan === "hang") return new Promise<Response>(() => {})
      if (plan === "error") return ok({ message: "העריכה לא הצליחה הפעם. נסו שוב." }, 500)
      // reopen: a long edit, so there is time to close and reopen the panel.
      return ok(
        { plan, frames, driveLinks: sample.format === "carousel" ? sample.frames.map((_, i) => `https://drive.google.com/file/d/preview${i}/view`) : null },
        200,
        state === "reopen" ? 6000 : 700,
      )
    }
    if (url.includes("/api/story/generate-video-media") || url.includes("/api/media/caption-image")) {
      const cap = body.caption as { headline?: string; body?: string; position?: string } | undefined
      return ok({ url: captioned(String(body.sourceUrl), [cap?.headline, cap?.body].filter(Boolean).join("\n"), cap?.position ?? "bottom") }, 200, 900)
    }
    if (url.includes("/api/media/from-drive")) return ok({ url: String(body.url) })
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
  const state = (STATES.find((s) => s.id === params.get("state"))?.id ?? "idle") as State
  // Editing an animated frame is a story thing: those states use the image story.
  const sample = isAnimEdit(state)
    ? MEDIA.find((m) => m.id === "image-story")!
    : (MEDIA.find((m) => m.id === params.get("media")) ?? MEDIA[0])
  // A fresh stage per media × state, so each starts from its own sample.
  return <Stage key={`${sample.id}:${state}`} state={state} sample={sample} />
}

function Stage({ state, sample }: { state: State; sample: Sample }) {
  // Its own conversation per media × state (the panel keeps conversations).
  // (`-own-`: conversations from the earlier scripted `reopen` are left behind.)
  const postId = `${POST_ID}-own-${sample.id}-${state}`
  const [urls, setUrls] = useState<string[]>(() => [
    ...sample.frames.map(frameUrl),
    ...(isAnimEdit(state) ? [animFrameInfo().url] : []),
  ])
  const [open, setOpen] = useState(state !== "idle")
  // Stub the network before anything on the stage can call it. The scripted
  // states start clean; `reopen` keeps its conversation across reloads.
  const [ready] = useState(() => {
    if (typeof window !== "undefined") {
      stubFetch(state, sample)
      if (state !== "reopen") clearChat(mediaChatKey(postId, sample.format, true))
    }
    return true
  })
  // anim-edit: frame 3 (the animated one) is on screen when she asks.
  const [index, setIndex] = useState(() => (isAnimEdit(state) ? sample.frames.length : 0))
  // As on /project: a reply that lands while the panel is closed reopens it.
  useChatRevealer({
    owns: (key) => key === mediaChatKey(postId, sample.format, true),
    state: () => (open ? "busy" : "open"),
    open: () => setOpen(true),
  })

  const current = urls[Math.min(index, urls.length - 1)] ?? urls[0]
  const shown = readCaption(current)
  const currentParams = new URL(current, "http://preview.local").searchParams
  const anim = currentParams.get("anim")
  const look = currentParams.get("look") === "loud" ? "loud" : "plain"
  const isVideo = /\.mp4/.test(current) && anim === null
  const Icon = sample.icon

  return (
    <div dir="rtl" className="min-h-screen bg-bg-surface p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {MEDIA.map((m) => (
          <Link
            key={m.id}
            href={`/test/own-media-ai-edit?media=${m.id}&state=${state}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              m.id === sample.id ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STATES.map((s) => (
          <Link
            key={s.id}
            href={`/test/own-media-ai-edit?media=${sample.id}&state=${s.id}`}
            className={`rounded-full border px-2.5 py-1 hover:bg-gray-95 dark:hover:bg-gray-20 ${
              s.id === state ? "border-text-primary-default text-text-primary-default" : "border-border-neutral-default text-text-neutral-default"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="mx-auto flex w-[340px] flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6">
        <div className="flex items-center gap-2 rounded-t-[20px] px-6 py-3">
          <span className="text-p-bold text-text-primary-default">{sample.title}</span>
          <Icon className="size-4 text-text-neutral-default" />
        </div>
        <div className="flex flex-col items-center gap-3 px-6">
          <div className={AI_HOVER_ZONE}>
            <div className={`relative overflow-hidden rounded-xl border border-border-neutral-default bg-gray-95 ${sample.aspect}`}>
              {anim !== null ? (
                <AnimatedStandIn text={anim} look={look} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown.src} alt="" className="h-full w-full object-contain" />
              )}
              {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-black/40">
                    <Play className="ms-0.5 size-5 text-white" />
                  </div>
                </div>
              )}
              {/* Stands in for the burned caption (the real one is ffmpeg / satori). */}
              {shown.cap && anim === null && (
                <div
                  className={`absolute inset-x-3 flex justify-center ${
                    shown.pos === "top" ? "top-[14%]" : shown.pos === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[24%]"
                  }`}
                >
                  <span className="whitespace-pre-line rounded-lg bg-black px-2.5 py-1.5 text-center text-xs-body font-bold text-white">
                    {shown.cap}
                  </span>
                </div>
              )}
            </div>
            {ready && <AiHoverEditButton target="media" visible={open} onClick={() => setOpen(true)} />}
          </div>
          {urls.length > 1 && (
            <div className="flex items-center gap-1.5" role="group" aria-label="פריימים">
              {urls.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`פריים ${i + 1}`}
                  className={`h-1.5 w-6 rounded-full transition-colors ${i === index ? "bg-text-primary-default" : "bg-gray-80 hover:bg-gray-70"}`}
                />
              ))}
            </div>
          )}
          <p className="text-xs-body text-text-neutral-default">
            {urls.length > 1 ? `${index + 1} / ${urls.length}` : sample.frames[0].kind === "video" ? "וידאו שלכם" : "תמונה שלכם"}
            {anim !== null && " · פריים מונפש (AI)"}
          </p>
        </div>
      </div>

      <div>
        {ready && open && (
          <MediaAiChat
            postId={postId}
            format={sample.format}
            own
            // reopen: no scripted ask — each media's thread is what she writes in it.
            autoSend={state === "idle" || state === "reopen" ? undefined : ASK[state]}
            currentUrls={urls}
            currentFrame={isAnimEdit(state) ? index + 1 : undefined}
            open
            onOpenChange={(o) => setOpen(o)}
            onUpdated={(_, next) => {
              // A new slide is shown as it lands; a caption change stays put.
              if (next.length > urls.length) setIndex(next.length - 1)
              setUrls(next)
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The rendered clip, faked: per-word entrance, looping. `plain` = a dark,
 * quiet background with white text; `loud` = the bombastic white one she
 * asked to take off.
 */
function AnimatedStandIn({ text, look = "plain" }: { text: string; look?: "loud" | "plain" }) {
  const words = text.split(/\s+/).filter(Boolean)
  const loud = look === "loud"
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center px-5 ${
        loud ? "bg-[radial-gradient(circle_at_50%_40%,#fff_0%,#fff7d6_45%,#ffd84d_100%)]" : "bg-gradient-to-b from-gray-10 to-gray-20"
      }`}
    >
      <style>{`@keyframes own-anim-word{0%{opacity:0;transform:translateY(14px)}12%,85%{opacity:1;transform:none}100%{opacity:0}}`}</style>
      <p dir="rtl" className={`text-center leading-snug ${loud ? "text-[20px] font-black text-gray-10" : "text-p-bold text-white"}`}>
        {words.map((w, i) => (
          <span
            key={i}
            className="inline-block"
            style={{ animation: `own-anim-word 4s ${i * 0.18}s ease-out infinite both`, marginInlineEnd: "0.25em" }}
          >
            {w}
          </span>
        ))}
      </p>
    </div>
  )
}
