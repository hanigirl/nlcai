"use client"

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { AI_ERROR_BOX, aiErrorMessage } from "@/lib/ai-error-message"
import { ArrowUp, Check, Loader2, X } from "lucide-react"
import { AiSparkle } from "@/components/ai-refine-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDismissOnOutsideClick } from "@/lib/use-dismiss-on-outside-click"
import { startBRollEdit } from "@/lib/broll-generation-store"
import { LongWaitBusyRow } from "@/components/long-wait-busy-row"
import { AWAY_COPY, trackAwayResult } from "@/lib/long-wait"
import { SaveToVisualLanguageChip } from "@/components/save-to-visual-language-chip"
import { VisualMemoryNote } from "@/components/visual-memory-note"
import { memoryHeadline, triageMessage, type MemoryOutcome, type TriageResult } from "@/lib/visual-memory"
import type { AiEditGenerateOpening, AiEditOpening } from "@/lib/ai-edit-intent"
import { usePreviewAccess } from "@/lib/use-scheduling-access"
import { Chip } from "@/components/ui/chip"
import { runOwnMediaEdit } from "@/lib/own-media-edit"
import {
  clearChat,
  getChat,
  isChatWatched,
  updateChat,
  useAiChat,
  useWatchChat,
  type AiChatSession,
} from "@/lib/ai-chat-session-store"
import { AiChatNewButton } from "@/components/ai-chat-new-button"
import { canRevealChat, revealChatReply } from "@/lib/ai-chat-reveal"
import { REFERENCE_ONLY_INSTRUCTION } from "@/lib/ai-edit-references"
import {
  ReferenceButton,
  ReferenceDropHint,
  ReferenceThumbs,
  ReferenceTray,
  useReferenceImages,
} from "@/components/ai-edit-reference"

/** A clip the Opus engine made — only those have a composition to edit. */
export function isEditableBRollUrl(url: string | null | undefined): boolean {
  return !!url && /\/b_roll\/[0-9a-f-]{36}\.mp4(?:[?#].*)?$/i.test(url)
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** User turns: reference images she attached (shown in her bubble). */
  images?: string[]
  /** Assistant turn that landed a new clip. */
  done?: boolean
  error?: boolean
  /**
   * Assistant turns: what the visual memory made of her message (saved, goes
   * to the settings, contradicts an earlier preference…) — lib/visual-memory.
   */
  memory?: MemoryOutcome
  /** No edit ran — the bubble IS the memory answer (its headline). */
  memoryOnly?: boolean
  /** Own media: the edit changed only content (words, slides), nothing to save as a style. */
  noStyle?: boolean
}

/** Panel state kept with the conversation (lib/ai-chat-session-store). */
interface MediaChatExtra {
  /** Own media: the step it is on, under the busy row. */
  progress: string
  /** A generation waiting for (or running on) her brief — see GenStep. */
  gen?: GenStep | null
}

/**
 * "חדש לגמרי" (Hani, 2026-11-05). Picking that tile in the media panel and
 * pressing generate opens this panel on one question — how to start — and
 * the generation runs from her answer, from a blank page (no visual
 * language). When it lands, the step is cleared and the same thread carries
 * on as the AI edit. Every other tile generates straight away, no question.
 */
interface GenStep {
  /** The opening it came from (its run function lives in generatorById). */
  id: string
  /** brief: waiting for her words · running. */
  phase: "brief" | "running"
  /** Her last brief — put back in the composer if the generation failed. */
  lastBrief: string
}
type MediaChat = AiChatSession<ChatMessage, MediaChatExtra>

/** The generation each "generate" opening starts (functions don't go to storage). */
const generatorById = new Map<string, AiEditGenerateOpening["run"]>()

/** The conversation of one post + format (+ own media) in lib/ai-chat-session-store. */
export const mediaChatKey = (postId: string, format: AiEditFormat, own = false) =>
  `media:${postId}:${format}:${own ? "own" : "ai"}`

/** Distinct ids for the leave-screen toast of each own-media edit. */
let ownEditSeq = 0

/** The newest edit that landed, with the instruction that asked for it. */
function lastLandedEdit(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].done) {
      const ask = messages.slice(0, i).reverse().find((m) => m.role === "user")
      return ask ? { index: i, instruction: ask.content, memory: messages[i].memory } : null
    }
  }
  return null
}

export type AiEditFormat = "b_roll" | "carousel" | "story" | "image_post"

const COPY: Record<AiEditFormat, { title: string; intro: string; done: string; busy: string }> = {
  b_roll: {
    title: "עריכת בי-רול עם AI",
    intro: "מה לשנות בבי-רול? למשל גודל הכותרת, צבעים, איך המילים נכנסות או התזמון. אעדכן את האנימציה והסרטון יתחלף בכרטיס.",
    done: "עדכנתי את הבי-רול. הסרטון החדש מופיע בכרטיס.",
    busy: "מעדכנים את הבי-רול... זה לוקח כדקה",
  },
  carousel: {
    title: "עריכת קרוסלה עם AI",
    intro: "מה לשנות בקרוסלה? אפשר לבקש על כל השקופיות או על שקופית מסוימת, למשל ״בשקופית 3 הכותרת בצבע המותג״.",
    done: "עדכנתי את הקרוסלה. השקופיות החדשות מופיעות בכרטיס.",
    busy: "מעדכנים את השקופיות... זה יכול לקחת עד שתי דקות",
  },
  story: {
    title: "עריכת סטורי עם AI",
    intro: "מה לשנות בסטורי? אפשר לבקש על כל הפריימים או על פריים מסוים.",
    done: "עדכנתי את הסטורי. הפריימים החדשים מופיעים בכרטיס.",
    busy: "מעדכנים את הסטורי... זה יכול לקחת עד שתי דקות",
  },
  image_post: {
    title: "עריכת תמונה עם AI",
    intro: "מה לשנות בתמונה? למשל צבעים, גודל הכותרת, רקע או אלמנט מסוים.",
    done: "עדכנתי את התמונה. היא מופיעה בכרטיס.",
    busy: "מעדכנים את התמונה... זה יכול לקחת כדקה",
  },
}

/** The generate step (Hani, 2026-11-05) — what the panel says per format. */
const GEN_COPY: Record<AiEditFormat, { title: string; busy: string; done: string; away: { done: string; failed: string } }> = {
  image_post: {
    title: "יצירת תמונה עם AI",
    busy: "מייצרים את התמונה... זה יכול לקחת עד דקה",
    done: "התמונה מוכנה ונשמרה בכרטיס. רוצים לשנות משהו? כתבו לי כאן ואעדכן.",
    away: { done: "התמונה מוכנה ונשמרה בפוסט.", failed: "יצירת התמונה לא הצליחה. נסו שוב מהפוסט." },
  },
  story: {
    title: "יצירת סטורי עם AI",
    busy: "מייצרים את הסטורי... זה יכול לקחת עד דקה",
    done: "הסטורי מוכן ונשמר בכרטיס. רוצים לשנות משהו? כתבו לי כאן ואעדכן.",
    away: { done: "הסטורי מוכן ונשמר בפוסט.", failed: "יצירת הסטורי לא הצליחה. נסו שוב מהפוסט." },
  },
  b_roll: {
    title: "יצירת בי-רול עם AI",
    busy: "מייצרים את הבי-רול... זה יכול לקחת כשתי דקות",
    done: "הבי-רול מוכן ונשמר בכרטיס. רוצים לשנות משהו? כתבו לי כאן ואעדכן.",
    away: { done: "הבי-רול מוכן ונשמר בפוסט.", failed: "יצירת הבי-רול לא הצליחה. נסו שוב מהפוסט." },
  },
  carousel: {
    title: "יצירת קרוסלה עם AI",
    busy: "מציירים את הקרוסלה... זה יכול לקחת כמה דקות",
    done: "הקרוסלה מוכנה ונשמרה בכרטיס. רוצים לשנות משהו? כתבו לי כאן ואעדכן.",
    away: { done: "הקרוסלה מוכנה ונשמרה בפוסט.", failed: "יצירת הקרוסלה לא הצליחה. נסו שוב מהפוסט." },
  },
}

/** The one question "חדש לגמרי" asks before generating. */
const GEN_ASK = "איך תרצו להתחיל?\nספרו לי מה אתם רואים בראש: צבעים, אווירה, מה יופיע ומה ממש לא. מתחילים מדף חלק, בלי השפה הוויזואלית."
const GEN_STALE = "הבקשה הזאת כבר לא פעילה. לחצו שוב על כפתור היצירה בפאנל המדיה."

/**
 * Media she brought herself (Hani, 2026-10-29): the AI adds on top or takes
 * away — the caption, extra AI slides, the order — and never touches what she
 * filmed. The opening line and the suggestions say exactly that.
 */
const OWN_COPY: Record<AiEditFormat, { title: string; intro: string; busy: string; suggestions: { label: string; text: string; send: boolean }[] }> = {
  story: {
    title: "עריכת סטורי עם AI",
    intro:
      "זה הסטורי שלכם, אז מה שצילמתם נשאר בדיוק כמו שהוא. אפשר לשנות, להזיז או להוריד את הכיתוב, להוסיף פריים חדש שה-AI מעצב בשפה הוויזואלית שלכם (גם עם טקסט מונפש, כמו בבי-רול), או למחוק ולסדר מחדש פריימים.",
    busy: "מעדכנים את הסטורי... זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להוסיף פריים סיום", text: "להוסיף פריים סיום עם קריאה לפעולה", send: true },
      { label: "להוסיף פריים עם טקסט מונפש", text: "להוסיף בסוף פריים עם טקסט מונפש: ", send: false },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
  },
  carousel: {
    title: "עריכת קרוסלה עם AI",
    intro:
      "אלה השקופיות שלכם, אז התמונות עצמן נשארות כמו שהן. אפשר לשנות, להזיז או להוריד את הכיתוב, להוסיף שקופית שה-AI מעצב בשפה הוויזואלית שלכם, או למחוק ולסדר מחדש שקופיות.",
    busy: "מעדכנים את השקופיות... זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב בשקופית הזאת ל: ", send: false },
      { label: "להוסיף שקופית סיום", text: "להוסיף שקופית סיום עם קריאה לפעולה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב מכל השקופיות", send: true },
    ],
  },
  image_post: {
    title: "עריכת תמונה עם AI",
    intro:
      "זו התמונה שלכם, אז היא עצמה נשארת כמו שהיא. אפשר לשנות את הכיתוב עליה, להזיז אותו, לשנות את הצבע והגודל שלו, או להוריד אותו.",
    busy: "מעדכנים את התמונה...",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להזיז את הכיתוב למעלה", text: "להזיז את הכיתוב למעלה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
  },
  b_roll: {
    title: "עריכת בי-רול עם AI",
    intro:
      "זה הבי-רול שלכם, אז מה שצילמתם נשאר בדיוק כמו שהוא. אפשר לשנות את הכיתוב עליו, להזיז אותו, לשנות את הצבע והגודל שלו, או להוריד אותו.",
    busy: "מעדכנים את הבי-רול... בסרטון זה יכול לקחת עד שתי דקות",
    suggestions: [
      { label: "לשנות את הכיתוב", text: "לשנות את הכיתוב ל: ", send: false },
      { label: "להזיז את הכיתוב למעלה", text: "להזיז את הכיתוב למעלה", send: true },
      { label: "להוריד את הכיתוב", text: "להוריד את הכיתוב", send: true },
    ],
  },
}

/**
 * "עריכת [פורמט] עם AI" (Hani, 2026-10-22) — the same floating side panel as
 * the core post's "עריכת פוסט ליבה" (CorePostChat): her instruction in, Opus
 * revises the animation, the new clip replaces the one on the result card.
 * Each turn builds on the last (the server keeps the edits with the clip).
 *
 * Unlike the core post there's nothing to preview-then-keep: a revision is a
 * new rendered clip, already saved. To go back she deletes and regenerates,
 * or asks for the change to be undone.
 *
 * Fixed-position sibling of the canvas, like CorePostChat, so pan/zoom don't
 * move it.
 */
export function MediaAiChat({
  postId,
  format,
  open,
  onOpenChange,
  onUpdated,
  own = false,
  currentUrls = [],
  currentFrame,
  initialMessages,
  autoSend,
  opening,
}: {
  postId: string
  format: AiEditFormat
  /**
   * The media is hers (Drive / upload), not the AI's: only add on top or take
   * away — lib/own-media-edit. The panel says so and offers those moves.
   */
  own?: boolean
  /** Own media: the set as the card shows it. */
  currentUrls?: string[]
  /** Own media: the frame / slide on screen (1-based). */
  currentFrame?: number
  /** State previews (/test/*) only: start the conversation here. */
  initialMessages?: ChatMessage[]
  /** State previews (/test/*) only: send this request once, on open. */
  autoSend?: string
  /** Opened by a generate button: ask for a brief first (lib/ai-edit-intent). */
  opening?: AiEditOpening | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The saved set, in order, after an edit (image formats; own media of any
   * format). `driveLinks`: an own carousel's per-slide links, re-ordered with it.
   */
  onUpdated?: (format: AiEditFormat, urls: string[], extra?: { driveLinks?: string[] | null }) => void
}) {
  const copy = own ? { ...COPY[format], ...OWN_COPY[format] } : COPY[format]
  // Today's batch (2026-10-29), Hani only: z-50 + outside-click close and the
  // leave-screen note. Off (or loading) = as before.
  const preview = usePreviewAccess() === true
  // One conversation per post + format (+ own media), kept outside the panel
  // (lib/ai-chat-session-store): closing it or leaving the screen keeps the
  // thread, the half-typed text and a request still running.
  const chatKey = mediaChatKey(postId, format, own)
  const fresh = useMemo(
    () => (): MediaChat => ({
      messages: initialMessages ?? [{ role: "assistant", content: copy.intro }],
      input: "",
      busy: false,
      extra: { progress: "" },
    }),
    [initialMessages, copy.intro],
  )
  const empty = useMemo(() => fresh(), [fresh])
  const session = useAiChat<ChatMessage, MediaChatExtra>(chatKey) ?? empty
  const { messages, input, busy: loading } = session
  const { progress } = session.extra
  const patch = (fn: (s: MediaChat) => MediaChat) => updateChat(chatKey, fresh, fn)
  // A generate button opens the panel on its question — as a new turn of the
  // same conversation, or as its first turn if nothing was said yet.
  useLayoutEffect(() => {
    if (!opening || opening.kind !== "generate") return
    const cur = getChat<ChatMessage, MediaChatExtra>(chatKey)
    if (cur?.extra.gen?.id === opening.id || cur?.busy) return
    generatorById.set(opening.id, opening.run)
    updateChat(chatKey, fresh, (s): MediaChat => {
      const ask: ChatMessage = { role: "assistant", content: GEN_ASK }
      const next = s.messages.some((m) => m.role === "user") ? [...s.messages, ask] : [ask]
      return { ...s, messages: next, extra: { ...s.extra, gen: { id: opening.id, phase: "brief", lastBrief: "" } } }
    })
  }, [chatKey, opening, fresh])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Watching" = a panel shows this conversation when the reply lands — the
  // one she reopened counts too, so the leave-screen toast only comes when
  // she's really away.
  useWatchChat(chatKey)
  // Screenshots waiting to go with the next message; another conversation starts clean.
  const refs = useReferenceImages()
  const { clear: clearRefs } = refs
  useEffect(() => {
    clearRefs()
  }, [chatKey, clearRefs])
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsideClick(panelRef, open && preview, () => onOpenChange(false))

  const autoSent = useRef(false)
  useEffect(() => {
    if (!autoSend || autoSent.current) return
    const t = setTimeout(() => {
      autoSent.current = true
      // A conversation already under way (reopened, reloaded) isn't re-scripted.
      if (getChat<ChatMessage, MediaChatExtra>(chatKey)?.messages.some((m) => m.role === "user")) return
      void send(autoSend)
    }, 300)
    return () => clearTimeout(t)
    // Once, on open — a preview's scripted first request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  const setInput = (value: string) => patch((s) => ({ ...s, input: value }))
  const gen = session.extra.gen ?? null

  /** Run the generation from her brief — a blank page, no visual language. */
  const generate = async (brief: string) => {
    const key = chatKey
    const init = fresh
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, init, fn)
    const cur = getChat<ChatMessage, MediaChatExtra>(key) ?? init()
    const g = cur.extra.gen
    if (cur.busy || !g || g.phase === "running") return
    const run = generatorById.get(g.id)
    const said: ChatMessage = { role: "user", content: brief }
    if (!run) {
      // A reload dropped the button's settings — the media panel starts it again.
      patchKey((s) => ({
        ...s,
        input: "",
        messages: [...s.messages, said, { role: "assistant", content: GEN_STALE, error: true }],
        extra: { ...s.extra, gen: null },
      }))
      return
    }
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      messages: [...s.messages, said],
      extra: { ...s.extra, gen: { ...g, phase: "running", lastBrief: brief } },
    }))
    const isWatching = () => isChatWatched(key) || canRevealChat(key)
    const away = GEN_COPY[format].away
    let result: Awaited<ReturnType<typeof run>>
    try {
      result = preview
        ? await trackAwayResult(`ai-gen-${postId}-${format}-${Date.now()}`, run(brief), isWatching, away, postId)
        : await run(brief)
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    patchKey((s): MediaChat => {
      if (result.ok) {
        generatorById.delete(g.id)
        return {
          ...s,
          busy: false,
          // A from-zero brief is about this piece, not her lasting style —
          // nothing to offer saving to the visual language.
          messages: [...s.messages, { role: "assistant", content: GEN_COPY[format].done, done: true, noStyle: true }],
          extra: { ...s.extra, gen: null },
        }
      }
      // Failed: her words back in the composer — send retries.
      const next: ChatMessage[] = [
        ...s.messages,
        { role: "assistant", content: aiErrorMessage(result.message || "היצירה לא הצליחה. נסו שוב."), error: true },
      ]
      return {
        ...s,
        busy: false,
        input: brief,
        messages: next,
        extra: { ...s.extra, gen: { ...g, phase: "brief", lastBrief: brief } },
      }
    })
    revealChatReply(key, result.ok ? away.done : away.failed)
  }

  const send = async (preset?: string) => {
    // The reply belongs to this conversation even if the panel closes or
    // switches format before it lands.
    const key = chatKey
    const init = fresh
    // A panel shows it, or this post's page will reopen the panel with the
    // reply (lib/ai-chat-reveal) — either way no leave-screen toast.
    const isWatching = () => isChatWatched(key) || canRevealChat(key)
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, init, fn)
    const cur = getChat<ChatMessage, MediaChatExtra>(key) ?? init()
    if (cur.busy) return
    // Before the generation: whatever she types is her brief for it.
    if (cur.extra.gen && cur.extra.gen.phase !== "running") {
      const brief = (preset ?? cur.input).trim()
      if (brief) void generate(brief)
      return
    }
    let text = (preset ?? cur.input).trim()
    const attached = refs.refs
    if (!text && attached.length) text = REFERENCE_ONLY_INSTRUCTION
    if (!text) return
    refs.clear()
    const previousInstruction = [...cur.messages].reverse().find((m) => m.role === "user")?.content
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      extra: { ...s.extra, progress: "בודקים את הבקשה מול ההעדפות שלכם..." },
      messages: [...s.messages, { role: "user", content: text, ...(attached.length ? { images: attached } : {}) }],
    }))

    // First the visual memory (lib/visual-memory): her settings, her saved
    // preferences, and whether the message asks for an edit at all ("תשמרו
    // את זה" doesn't). A failed check never blocks the edit — it says so.
    let triage: TriageResult
    try {
      triage = await triageMessage({ instruction: text, format, previousInstruction, references: attached })
    } catch (err) {
      console.error("[media-ai-chat][visual-memory]", err)
      triage = {
        edit: true,
        editInstruction: text,
        memory: { kind: "error", message: err instanceof Error ? err.message : String(err) },
      }
    }
    const memory = triage.memory.kind === "none" && !triage.memory.explicit ? undefined : triage.memory
    patchKey((s) => ({ ...s, extra: { ...s.extra, progress: "" } }))
    if (!triage.edit) {
      patchKey((s) => ({
        ...s,
        busy: false,
        messages: [
          ...s.messages,
          {
            role: "assistant",
            content: memoryHeadline(triage.memory) ?? "לא מצאתי כאן שינוי לעשות או העדפה לשמור. כתבו מה לשנות.",
            memory,
            memoryOnly: true,
          },
        ],
      }))
      return
    }
    const editText = triage.editInstruction.trim() || text
    if (own) {
      await sendOwn(editText, cur.messages, patchKey, isWatching, memory)
      return
    }
    // If she leaves before it lands, the result arrives as a toast (the
    // server has saved it either way) — see lib/long-wait.
    const run =
      format === "b_roll"
        ? startBRollEdit(postId, editText, { quiet: true, references: attached })
        : editImages(editText, attached)
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-${Date.now()}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
    patchKey((s) => ({
      ...s,
      busy: false,
      messages: [
        ...s.messages,
        result.ok
          ? { role: "assistant", content: copy.done, done: true, memory }
          : {
              role: "assistant",
              content: aiErrorMessage(result.message || "העריכה לא הצליחה. נסו שוב."),
              error: true,
              // A saved preference stays saved even when the edit failed.
              ...(memory && memory.kind !== "error" ? { memory } : {}),
            },
      ],
    }))
    revealChatReply(key, result.ok ? AWAY_COPY[format].done : AWAY_COPY[format].failed)
  }

  /** Her own media: plan → existing caption / slide paths → save the set. */
  async function sendOwn(
    text: string,
    before: ChatMessage[],
    patchKey: (fn: (s: MediaChat) => MediaChat) => void,
    isWatching: () => boolean,
    memory?: MemoryOutcome,
  ) {
    const history = before
      .filter((m, i) => i > 0 && !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
    let full: Awaited<ReturnType<typeof runOwnMediaEdit>> | null = null
    const run = runOwnMediaEdit({
      postId,
      format,
      instruction: text,
      currentUrls,
      currentFrame,
      history,
      onProgress: (p) => patchKey((s) => ({ ...s, extra: { ...s.extra, progress: p } })),
    }).then((r) => {
      full = r
      if (r.ok && r.changed) onUpdated?.(format, r.urls, { driveLinks: r.driveLinks })
      return r.ok ? { ok: true as const } : { ok: false as const, message: r.message }
    })
    // If she leaves before it lands, the result arrives as a toast.
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-own-${++ownEditSeq}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
    const r = full as Awaited<ReturnType<typeof runOwnMediaEdit>> | null
    const reply: ChatMessage =
      !result.ok || !r || !r.ok
        ? {
            role: "assistant",
            content: aiErrorMessage((r && r.message) || "העריכה לא הצליחה. נסו שוב."),
            error: true,
            ...(memory && memory.kind !== "error" ? { memory } : {}),
          }
        : !r.changed
          ? { role: "assistant", content: r.message, memory }
          : { role: "assistant", content: r.message || copy.done, done: true, memory, noStyle: !r.styleChange }
    patchKey((s) => ({ ...s, busy: false, extra: { ...s.extra, progress: "" }, messages: [...s.messages, reply] }))
    revealChatReply(mediaChatKey(postId, format, own), reply.error ? AWAY_COPY[format].failed : AWAY_COPY[format].done)
  }

  async function editImages(
    text: string,
    references: string[] = [],
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/media/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format,
          instruction: text,
          ...(references.length ? { references } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        urls?: string[]
        message?: string
        error?: string
      }
      if (!res.ok || !data.urls) return { ok: false, message: data.message ?? data.error ?? "העריכה לא הצליחה" }
      onUpdated?.(format, data.urls)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  const lastEdit = lastLandedEdit(messages)
  const title = gen ? GEN_COPY[format].title : copy.title
  const busyText = progress || (gen?.phase === "running" ? GEN_COPY[format].busy : copy.busy)

  /** Her answer in a memory note (undo, across the board…) — kept with the thread. */
  const setMemory = (index: number, next: MemoryOutcome) =>
    patch((s) => ({
      ...s,
      messages: s.messages.map((x, j) =>
        j === index ? { ...x, memory: next, ...(x.memoryOnly ? { content: memoryHeadline(next) ?? x.content } : {}) } : x,
      ),
    }))

  if (!open) return null

  return (
    <div
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-label={title}
      {...refs.dropProps}
      className={`fixed bottom-6 right-6 ${preview ? "z-50" : "z-40"} flex max-h-[72vh] w-[380px] flex-col overflow-hidden rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 shadow-xl`}
    >
      <ReferenceDropHint show={refs.dragging} />
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-neutral-default bg-bg-surface px-4 py-3">
        <AiSparkle />
        <span className="text-small-bold text-text-primary-default">{title}</span>
        <div className="ms-auto flex items-center gap-1">
          {messages.some((m) => m.role === "user") && (
            <AiChatNewButton disabled={loading} onClick={() => clearChat(chatKey)} />
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="סגירה"
            className="inline-flex size-7 items-center justify-center rounded-md text-text-neutral-default hover:bg-bg-surface-hover hover:text-text-primary-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-start" : "items-end"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-small leading-relaxed ${
                m.role === "user"
                  ? "bg-bg-surface-primary-default text-text-primary-default rounded-ss-sm"
                  : m.error
                    ? `${AI_ERROR_BOX} rounded-se-sm`
                    : "bg-bg-surface text-text-primary-default rounded-se-sm"
              }`}
            >
              {m.content}
              <ReferenceThumbs images={m.images} className="mt-1.5" />
            </div>
            {/* Own media: what it can do, one tap away — until her first ask. */}
            {own && i === 0 && messages.length === 1 && !loading && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5" role="group" aria-label="הצעות לעריכה">
                {OWN_COPY[format].suggestions.map((sg) => (
                  <Chip
                    key={sg.label}
                    onClick={() => {
                      if (sg.send) {
                        void send(sg.text)
                        return
                      }
                      setInput(sg.text)
                      requestAnimationFrame(() => {
                        const el = inputRef.current
                        if (!el) return
                        el.focus()
                        el.setSelectionRange(el.value.length, el.value.length)
                      })
                    }}
                  >
                    {sg.label}
                  </Chip>
                ))}
              </div>
            )}
            {m.done && (
              <span className="inline-flex items-center gap-1 text-xs-body text-text-neutral-default">
                <Check className="size-3.5 text-green-success-50" />
                הוחל.
              </span>
            )}
            {m.memory && (
              <VisualMemoryNote
                memory={m.memory}
                showHeadline={!m.memoryOnly}
                onChange={(next) => setMemory(i, next)}
                className="max-w-[85%]"
              />
            )}
          </div>
        ))}

        {loading && preview && (
          <LongWaitBusyRow text={busyText} />
        )}
        {loading && !preview && (
          <div className="flex items-center gap-2 text-small text-text-neutral-default">
            <Loader2 className="size-4 animate-spin text-yellow-50" />
            <span>{busyText}</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-neutral-default p-3">
        {/* The save chip is open to everyone (Hani, 2026-10-29) — for an edit
            the memory didn't keep on its own. */}
        {lastEdit && !loading && !messages[lastEdit.index].noStyle && (!lastEdit.memory || lastEdit.memory.kind === "error") && (
          <SaveToVisualLanguageChip
            key={`${chatKey}:${lastEdit.index}`}
            instruction={lastEdit.instruction}
            format={format}
            onOutcome={(next) => setMemory(lastEdit.index, next)}
          />
        )}
        <ReferenceTray r={refs} />
        <div className="flex items-end gap-2 rounded-[12px] border border-border-neutral-default bg-white dark:bg-gray-10 p-2 focus-within:border-yellow-50 transition-colors">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={refs.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              gen?.phase === "brief"
                ? "למשל: רקע לבן ונקי, הרבה אוויר, בלי איורים"
                : "מה תרצו לשנות?"
            }
            ref={inputRef}
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-small shadow-none focus-visible:ring-0"
          />
          {/* Screenshots go with edits; the generate routes don't take them yet. */}
          {!gen && <ReferenceButton r={refs} disabled={loading} />}
          <Button
            size="icon-sm"
            onClick={() => void send()}
            disabled={(!input.trim() && !refs.refs.length) || loading}
            aria-label={gen && gen.phase !== "running" ? "יצירה" : "שליחה"}
            className="shrink-0 rounded-full"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
