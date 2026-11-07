"use client"

import { BidiText } from "@/components/bidi-text"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import type { AiEditGenerateOpening, AiEditOpening, GenSlots } from "@/lib/ai-edit-intent"
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
import { MAX_REFERENCES, MAX_SLOT_REFERENCES, REFERENCE_ONLY_INSTRUCTION } from "@/lib/ai-edit-references"
import {
  ReferenceDropHint,
  ReferenceThumbs,
  ReferenceTray,
  useReferenceImages,
} from "@/components/ai-edit-reference"
import { LinkReferenceRows, useLinkReferences } from "@/components/ai-edit-link-reference"
import { ReferenceAddMenu } from "@/components/ai-edit-drive-reference"
import { requestAsIsUpload, type AsIsItem } from "@/lib/as-is-upload"
import { CAROUSEL_VIDEO_MAX_SECONDS } from "@/lib/carousel-video"
import { uploadSlotPicture } from "@/lib/carousel-video-client"
import { CarouselSlideSlots } from "@/components/carousel-slide-slots"
import type { ReferenceImages } from "@/components/ai-edit-reference"
import type { MediaStyle } from "@/lib/visual-language/types"
import { useCopyStructure } from "@/lib/use-scheduling-access"

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
  /**
   * The carousel slots' "empty slides — is this what you meant?" question
   * (Hani, 2026-11-07): a real turn in the thread, so it scrolls into view;
   * its two answers show under it while it's the last turn and still true.
   */
  askEmpty?: boolean
  /** The ask for her missing personal elements — its chips show under it. */
  needInfo?: boolean
  /** "תעשה לי כזה": the question how to design the copy — its two answers show under it. */
  copyAsk?: boolean
}

/** Panel state kept with the conversation (lib/ai-chat-session-store). */
interface MediaChatExtra {
  /** Own media: the step it is on, under the busy row. */
  progress: string
  /** A generation waiting for (or running on) her brief — see GenStep. */
  gen?: GenStep | null
  /**
   * "תעשה לי כזה" (Hani, 2026-11-07): a carousel to copy the structure of.
   * await = asked for a link or screenshots; choose = the reference is in
   * (her storage URLs), waiting for "בשפת המותג שלי" / "בדיוק כמו בקרוסלה".
   */
  copy?:
    | { phase: "await" }
    | { phase: "choose"; refs: string[]; brief: string }
    /** Her personal elements missing for the reference (avatar / name / handle…) — asked in the chat. */
    | { phase: "needs"; refs: string[]; brief: string; mode: "brand" | "exact"; needs: string[] }
    | null
}

export type CopyStep = MediaChatExtra["copy"]

/** She wants a carousel like one she shows ("תעשה לי כזה", "אפשר כמו זה?"). */
const LIKE_THIS =
  /(כזה|כזאת|כזו|כמו זה|כמו זו|כמו זאת|כמו בזה|כמו בקרוסלה|כמו הקרוסלה|בדיוק כמו|אותו דבר|אותו מבנה|באותו מבנה|באותו עיצוב|באותו סגנון|בסגנון|בשפה הזו|בשפה הזאת|בשפה הזה|רפרנס|השראה|כמו בצילומ|כמו בלינק|כמו בתמונות|בשפת המותג|בצבעים שלי)/
/** Her words say which look (no question then): the reference's… */
const EXACT_HINT = /(בשפה הזו|בשפה הזאת|בשפה הזה|בדיוק כמו|בדיוק כזה|בדיוק כזאת|אותו דבר|באותו עיצוב|באותו סגנון|באותם צבעים|אותם צבעים)/
/** …or hers. */
const BRAND_HINT = /(בשפת המותג|בשפה שלי|בשפה הוויזואלית שלי|בצבעים שלי|בסגנון שלי|במותג שלי|בעיצוב שלי)/
function lookFromWords(text: string): "brand" | "exact" | null {
  if (BRAND_HINT.test(text)) return "brand"
  if (EXACT_HINT.test(text)) return "exact"
  return null
}
const LINK_RE = /https?:\/\/[^\s"'<>]+/i
const COPY_COPY = {
  link: "עכשיו אעקוב אחרי הלינק ששלחתם ואייצר קרוסלה עם הטקסט שלכם. איך לעצב אותה?",
  shots: "קיבלתי את צילומי המסך. אייצר קרוסלה באותו מבנה עם הטקסט שלכם. איך לעצב אותה?",
  askFor: "שלחו לי לינק לקרוסלה או צילומי מסך של השקופיות, ואייצר לכם אחת כזאת עם הטקסט שלכם.",
  reading: "קוראים את הקרוסלה מהלינק...",
  goExact: "בונה את הקרוסלה כמו ברפרנס, עם הטקסט שלכם.",
  goBrand: "בונה את הקרוסלה במבנה של הרפרנס, בשפת המותג שלכם ועם הטקסט שלכם.",
  brand: "בשפת המותג שלי",
  exact: "בדיוק כמו בקרוסלה",
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
  /** The tile it generates in — "blank" when absent (see AiEditGenerateOpening). */
  style?: MediaStyle
  /** Attached images are placed in the media (lib/feature-access). */
  placeRefs?: boolean
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
    busy: "מעדכנים את הבי-רול... זה יכול לקחת כמה דקות",
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

/**
 * The one question the panel asks before generating. "חדש לגמרי" needs her
 * words. "עריכה עם AI" on any other tile before there is media (Hani,
 * 2026-11-05: "אני אייצר לך מדיה בשפה ויזואלית שלך, יש דברים שאני צריך לדעת
 * לפני?") — her words are an addition, and she can skip them (GEN_SKIP).
 */
const GEN_NOUN: Record<AiEditFormat, string> = {
  image_post: "את התמונה",
  story: "את הסטורי",
  b_roll: "את הבי-רול",
  carousel: "את הקרוסלה",
}
function genAsk(format: AiEditFormat, style: MediaStyle = "blank", placeRefs = false): string {
  if (style === "blank")
    return "איך תרצו להתחיל?\nספרו לי מה אתם רואים בראש: צבעים, אווירה, מה יופיע ומה ממש לא. מתחילים מדף חלק, בלי השפה הוויזואלית."
  const lang =
    style === "brand"
      ? "בשפה הוויזואלית שלכם"
      : style === "ai-dark"
        ? "בשפת הנישה שלכם, בגרסה הכהה"
        : style === "ai-light"
          ? "בשפת הנישה שלכם, בגרסה הבהירה"
          : "בשפת הנישה שלכם"
  // Placing her pictures is Hani-only for now (lib/feature-access).
  return placeRefs
    ? `אייצר לכם ${GEN_NOUN[format]} ${lang}.\nיש משהו שכדאי שאדע לפני? תמונות שתרצו שאכניס? אפשר גם לספר מה חשוב לכם הפעם, או להדביק קישור לפוסט שאהבתם (באינסטגרם, באתר) כהשראה.`
    : `אייצר לכם ${GEN_NOUN[format]} ${lang}.\nיש משהו שכדאי שאדע לפני? אפשר לספר מה חשוב לכם הפעם, לצרף תמונת רפרנס או להדביק קישור (פוסט באינסטגרם, אתר).`
}

/**
 * What she attached as images before the generation goes IN the media, as it
 * is (Hani, 2026-11-05: "התמונה תכנס ביצירה הראשונה אם שמתי אותה כרפרנס");
 * a picture from a link is only a look. Said under the tray, where she sees
 * them — per format, since a b-roll is built on the picture itself.
 */
const PLACE_NOTE: Record<AiEditFormat, string> = {
  image_post: "התמונה שצירפתם תיכנס לתמונה כמו שהיא.",
  story: "התמונה שצירפתם תיכנס כמו שהיא לפריים הראשון של הסטורי.",
  b_roll: "הבי-רול ייבנה על התמונה שצירפתם, כמו שהיא.",
  carousel: "התמונה שצירפתם תיכנס לשקופית שבחרתם.",
}
const LOOK_NOTE = "תמונה מקישור משמשת רק כהשראה למראה."
/** Only pictures, no words: what her brief says. */
const PLACE_ONLY_INSTRUCTION = "להכניס את התמונה שצירפתי"
/** Her way out of the conversation — generate in the picked style as is. */
const GEN_SKIP = "ליצור בלי תוספות"
/** A video can't be a still format's media — said at once, nothing starts. */
const STILL_FORMAT_VIDEO: Record<"image_post", string> = {
  image_post:
    "פוסט תמונה הוא תמונה, אז סרטון לא יכול להיות המדיה שלו. צרפו במקומו תמונה, או צילום מסך של הרגע שאתם רוצים מתוך הסרטון.",
}
/** Her attachment becomes the media as it is — lib/as-is-upload. */
const AS_IS = "להעלות כמו שזה, בלי תוספות"
const AS_IS_BUSY = "מעלים את המדיה כמו שהיא..."
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
  slideCount,
  seedAttachments,
  seedEmptied,
  seedAskEmpty,
  seedCopy,
  forceCopyStructure,
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
  /**
   * Carousel without slides yet: how many it will have (the script's planned
   * count) — the AI panel's slide slots (Hani, 2026-11-06).
   */
  slideCount?: number
  /** State previews (/test/*) only: attachments already in the composer, and their slots. */
  seedAttachments?: { preview: File; kind: "image" | "video"; at?: number }[]
  /** State previews (/test/*) only: the slot she just emptied. */
  seedEmptied?: number
  /** State previews (/test/*) only: open on the "empty slides — with AI?" question. */
  seedAskEmpty?: boolean
  /** State previews (/test/*) only: a "תעשה לי כזה" step already under way. */
  seedCopy?: MediaChatExtra["copy"]
  /** State previews (/test/*) only: the "תעשה לי כזה" gate on without a login. */
  forceCopyStructure?: boolean
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
      extra: { progress: "", ...(seedCopy ? { copy: seedCopy } : {}) },
    }),
    [initialMessages, copy.intro, seedCopy],
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
      const ask: ChatMessage = { role: "assistant", content: genAsk(format, opening.style, opening.placeRefs) }
      const next = s.messages.some((m) => m.role === "user") ? [...s.messages, ask] : [ask]
      return {
        ...s,
        messages: next,
        extra: {
          ...s.extra,
          gen: { id: opening.id, phase: "brief", lastBrief: "", style: opening.style, placeRefs: opening.placeRefs },
        },
      }
    })
  }, [chatKey, opening, fresh, format])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Watching" = a panel shows this conversation when the reply lands — the
  // one she reopened counts too, so the leave-screen toast only comes when
  // she's really away.
  useWatchChat(chatKey)
  // Screenshots waiting to go with the next message; another conversation starts clean.
  // A carousel's slide slots take one attachment per slide (up to 10), sent
  // as storage URLs; everywhere else the 3-reference cap stays.
  // Waiting for a carousel's screenshots ("תעשה לי כזה"): one per slide, up to 10.
  const copyGate = useCopyStructure() === true
  const copyAllowed = copyGate || !!forceCopyStructure
  const copyWaiting =
    format === "carousel" && (session.extra.copy?.phase === "await" || session.extra.copy?.phase === "needs")
  // A style request typed with pictures attached (live bug, 2026-11-07:
  // "תעשה לי את כל הקרוסלה בשפה הזו בסגנון tweet" put the tweet screenshots
  // into the slots): they're a design reference — shown so while she types.
  const styleTyped = copyAllowed && format === "carousel" && LIKE_THIS.test(session.input)
  const referenceMode = copyWaiting || styleTyped
  const slotsMax = referenceMode
    ? MAX_SLOT_REFERENCES
    : format === "carousel" &&
        (!session.extra.gen || session.extra.gen.phase === "running" || !!session.extra.gen.placeRefs)
      ? Math.min(MAX_SLOT_REFERENCES, Math.max(MAX_REFERENCES, currentUrls.length || slideCount || 0))
      : MAX_REFERENCES
  const refs = useReferenceImages(slotsMax)
  const [uploading, setUploading] = useState(false)
  /**
   * The originals of the attachments she just sent with a message — "להעלות
   * כמו שזה" stays offered under that message once the AI has answered.
   */
  const [sentAsIs, setSentAsIs] = useState<{ index: number; items: AsIsItem[] } | null>(null)
  const { clear: clearRefs, restore: restoreRefs } = refs
  // A link in her words becomes a reference too — while the panel asks how to start.
  const links = useLinkReferences(session.input, refs, session.extra.gen?.phase === "brief")
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

  /**
   * Run the generation from her brief (+ any references she attached) — a
   * blank page, or on top of the style she picked. `shown`:
   * what her bubble shows when it isn't the brief itself (GEN_SKIP).
   */
  const generate = async (
    brief: string,
    references: string[] = [],
    shown?: string,
    looks: string[] = [],
    /** Carousel slide slots: where her pictures and clips go (lib/ai-edit-intent). */
    slots?: GenSlots,
    /** Shown in her bubble too, not sent as pictures (a clip's first moment). */
    alsoShown: string[] = [],
    /** On a failure, these go back in the tray (her attachments, not their uploaded copies). */
    restoreWith?: string[],
  ) => {
    const key = chatKey
    const init = fresh
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, init, fn)
    const cur = getChat<ChatMessage, MediaChatExtra>(key) ?? init()
    const g = cur.extra.gen
    if (cur.busy || !g || g.phase === "running") return
    const run = generatorById.get(g.id)
    const bubble = [...references, ...alsoShown]
    const said: ChatMessage = { role: "user", content: shown ?? brief, ...(bubble.length ? { images: bubble } : {}) }
    // Her own pictures go IN the media; a link's picture is a look only.
    // Off the gate (lib/feature-access) every image is a look, as before.
    const place = g?.placeRefs ? references.filter((r) => !looks.includes(r)) : []
    const lookRefs = g?.placeRefs ? references.filter((r) => looks.includes(r)) : references
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
        ? await trackAwayResult(`ai-gen-${postId}-${format}-${Date.now()}`, run(brief, lookRefs, place, slots), isWatching, away, postId)
        : await run(brief, lookRefs, place, slots)
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
          messages: [...s.messages, { role: "assistant", content: result.message || GEN_COPY[format].done, done: true, noStyle: true }],
          extra: { ...s.extra, gen: null },
        }
      }
      // Her personal elements are missing for the reference: asked, not failed.
      const st = slots?.structure
      if (!result.ok && result.needs?.length && st) {
        return {
          ...s,
          busy: false,
          messages: [...s.messages, { role: "assistant", content: result.message, needInfo: true }],
          extra: {
            ...s.extra,
            gen: { ...g, phase: "brief", lastBrief: brief },
            copy: { phase: "needs", refs: st.refs, brief, mode: st.mode, needs: result.needs },
          },
        }
      }
      // Failed: her words (and references) back in the composer — send retries.
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
    if (!result.ok && !result.needs?.length && (restoreWith ?? bubble).length) restoreRefs(restoreWith ?? bubble, lookRefs)
    revealChatReply(key, result.ok ? away.done : away.failed)
  }

  /**
   * "להעלות כמו שזה, בלי תוספות": her attachments become the format's media
   * as they are, through the media panel's own import — no generation, no
   * style (lib/as-is-upload). A generation waiting on its question is dropped.
   */
  const uploadAsIs = async (items: AsIsItem[], images: string[]) => {
    const key = chatKey
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, fresh, fn)
    if (getChat<ChatMessage, MediaChatExtra>(key)?.busy) return
    // A still format can't take a video — at once, before anything starts.
    if (format === "image_post" && items.some((it) => it.kind === "video")) {
      patchKey((s) => ({
        ...s,
        messages: [...s.messages, { role: "assistant", content: STILL_FORMAT_VIDEO[format], error: true }],
      }))
      return
    }
    // Empty slides in her slots: asked first, as on send.
    if (emptyNeedsAsk && !confirmedEmpty.current) {
      askAboutEmpty("asIs", patchKey)
      return
    }
    confirmedEmpty.current = false
    setAskKey(null)
    refs.clear()
    links.reset()
    setSentAsIs(null)
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      extra: { ...s.extra, progress: AS_IS_BUSY, gen: null },
      messages: [...s.messages, { role: "user", content: AS_IS, ...(images.length ? { images } : {}) }],
    }))
    // Carousel slide slots: each file on the slide she chose.
    const placed = slotPlacement()
    const result =
      placed.length && placed.length === items.length
        ? await requestAsIsUpload(format, placed.map((p) => p.item), {
            at: placed.map((p) => p.i),
            // No carousel yet: the empty slots are made with AI (she said yes).
            ...(firstGen ? { fill: slotCount } : {}),
          })
        : await requestAsIsUpload(format, items)
    setSlotChoice({})
    setSlotTarget(null)
    setEmptied(null)
    patchKey((s) => ({
      ...s,
      busy: false,
      extra: { ...s.extra, progress: "" },
      messages: [
        ...s.messages,
        result.ok
          ? { role: "assistant", content: `${result.message}${placed.length ? keptNote(placed) : ""}`, done: true, noStyle: true }
          : { role: "assistant", content: result.message, error: true },
      ],
    }))
  }
  /**
   * "אם העלתי סרטון תעשה סרטון" (Hani, 2026-11-06): a video she attached with
   * an instruction makes a VIDEO — never a frame. Story / b-roll: the clip is
   * imported as the format's media (the as-is import, no automatic caption),
   * then the own-video AI edit (runOwnMediaEdit) adds the text and animation
   * her words ask for, her footage untouched. Image post / carousel can't hold
   * a video: she's told so at once, and nothing starts.
   * Returns true when it handled the message.
   */
  const sendWithVideo = async (text: string, attached: string[]): Promise<boolean> => {
    const originals = refs.originals(attached)
    const video = originals.find((o) => o.kind === "video")
    if (!video) return false
    const key = chatKey
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, fresh, fn)
    if (format === "image_post") {
      patchKey((s) => ({
        ...s,
        messages: [...s.messages, { role: "assistant", content: STILL_FORMAT_VIDEO[format], error: true }],
      }))
      return true
    }
    const extra = originals.length > 1 ? " עבדתי עם הסרטון הראשון; שאר הקבצים לא נכללו." : ""
    refs.clear()
    links.reset()
    setSentAsIs(null)
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      extra: { ...s.extra, progress: "מעלים את הסרטון שלכם...", gen: null },
      messages: [...s.messages, { role: "user", content: text, ...(attached.length ? { images: attached } : {}) }],
    }))
    // A carousel (2026-11-06): the clip becomes one more VIDEO slide, its
    // animated caption made in the same step (api/carousel/video-slide).
    const imported = await requestAsIsUpload(format, [video], {
      forEdit: true,
      ...(format === "carousel" ? { instruction: text } : {}),
    })
    if (format === "carousel") {
      patchKey((s) => ({
        ...s,
        busy: false,
        extra: { ...s.extra, progress: "" },
        messages: [
          ...s.messages,
          imported.ok
            ? { role: "assistant", content: `${imported.message}${extra}`, done: true, noStyle: true }
            : { role: "assistant", content: imported.message, error: true },
        ],
      }))
      return true
    }
    if (!imported.ok) {
      patchKey((s) => ({
        ...s,
        busy: false,
        extra: { ...s.extra, progress: "" },
        messages: [...s.messages, { role: "assistant", content: imported.message, error: true }],
      }))
      return true
    }
    patchKey((s) => ({ ...s, extra: { ...s.extra, progress: "הסרטון עלה. עכשיו מוסיפים את מה שביקשתם..." } }))
    const r = await runOwnMediaEdit({
      postId,
      format,
      instruction: text,
      currentUrls: [],
      onProgress: (p) => patchKey((s) => ({ ...s, extra: { ...s.extra, progress: p } })),
    })
    if (r.ok && r.changed) onUpdated?.(format, r.urls, { driveLinks: r.driveLinks })
    const reply: ChatMessage = !r.ok
      ? { role: "assistant", content: `הסרטון עלה כמו שהוא. ${aiErrorMessage(r.message || "העריכה לא הצליחה. נסו שוב.")}`, error: true }
      : !r.changed
        ? { role: "assistant", content: `הסרטון עלה כמו שהוא. ${r.message}${extra}` }
        : { role: "assistant", content: `${r.message || "הסרטון שלכם עלה, ועליו מה שביקשתם."}${extra}`, done: true, noStyle: !r.styleChange }
    patchKey((s) => ({ ...s, busy: false, extra: { ...s.extra, progress: "" }, messages: [...s.messages, reply] }))
    return true
  }
  const asIsAttached = refs.originals(refs.refs)
  // A still format can't take a video as is — no chip for it (the note says why).
  const stillWithVideo = format === "image_post" && asIsAttached.some((o) => o.kind === "video")
  const asIsNow = stillWithVideo ? [] : asIsAttached

  // State previews: attachments already in the composer (once, on mount).
  const seeded = useRef(false)
  useEffect(() => {
    if (!seedAttachments?.length || seeded.current) return
    seeded.current = true
    void refs
      .add(
        seedAttachments.map((a) => a.preview),
        { origins: seedAttachments.map((a) => ({ kind: a.kind, file: a.preview })) },
      )
      .then((added) => {
        const choice: Record<string, number> = {}
        added.forEach((src, i) => {
          const at = seedAttachments[i]?.at
          if (at !== undefined) choice[src] = at
        })
        setSlotChoice(choice)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedAttachments])

  // ---- Carousel slide slots (Hani, 2026-11-06) ----
  // One slot per slide as soon as she attaches media; each file goes on the
  // slide she chose, empty slots are made by the AI, the count never changes.
  const slotCount = format === "carousel" ? currentUrls.length || slideCount || 0 : 0
  const genNow = session.extra.gen
  // Before the first generation her pictures go IN only on the placing gate
  // (lib/feature-access) — off it they're looks, so only clips get a slot.
  const picturesSlot = !genNow || genNow.phase === "running" || !!genNow.placeRefs
  const originOf = (ref: string) => refs.originals([ref])[0]
  const videoRefs = refs.refs.filter((r) => originOf(r)?.kind === "video")
  // Screenshots of a carousel to copy are a reference — never slides.
  const slottable = slotCount && !referenceMode
    ? refs.refs.filter((r) => {
        const o = originOf(r)
        return !!o && (o.kind === "video" || picturesSlot)
      })
    : []
  const [slotChoice, setSlotChoice] = useState<Record<string, number>>({})
  const [slotTarget, setSlotTarget] = useState<number | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  // The slot she just emptied (the X) — the panel says it's the AI's now
  // (Hani, 2026-11-06: "כשמחקתי שקופית מסוימת הוא לא התריע שחסרה אחת").
  const [emptied, setEmptied] = useState<number | null>(seedEmptied ?? null)
  // The "empty slides — make them with AI?" question: for this exact slot set.
  // The "empty slides — go on?" question, for this exact slot set, and the
  // action it holds back (send, or "להעלות כמו שזה") — resumed on "yes".
  const [askKey, setAskKey] = useState<string | null>(seedAskEmpty ? "*" : null)
  const [askFor, setAskFor] = useState<"send" | "asIs">("send")
  const confirmedEmpty = useRef(false)
  const slots: (string | null)[] = (() => {
    const out: (string | null)[] = new Array(slotCount).fill(null)
    const rest: string[] = []
    for (const r of slottable) {
      const c = slotChoice[r]
      if (c !== undefined && c < slotCount && out[c] === null) out[c] = r
      else rest.push(r)
    }
    for (const r of rest) {
      const free = out.indexOf(null)
      if (free >= 0) out[free] = r
    }
    return out
  })()
  const slotted = slots.filter((x): x is string => !!x)
  const slotsKey = slots.map((x) => x ?? "").join("|")
  const emptyNums = slots.flatMap((x, i) => (x ? [] : [i + 1]))
  // Her own carousel: an empty slot keeps her slide — nothing is made with AI.
  const firstGen = !currentUrls.length
  // No carousel yet: an empty slot is made by AI, whoever's media the rest
  // is. A carousel that exists keeps its slide in an empty slot (her own: her
  // slide; the AI's: the AI's) — Hani, 2026-11-07.
  const emptyIsAi = firstGen || !own
  // Asked on EVERY way in (Enter, the send button, the as-is chips), on the
  // slots as they are at that moment — live bug 2026-11-07: three attached,
  // one removed, "להעלות כמו שזה" went straight through and made 2 slides.
  const emptyNeedsAsk = slotted.length > 0 && emptyNums.length > 0
  /** After the send, on a carousel that exists: which slides stayed, and why. */
  function keptNote(placed: { i: number }[]): string {
    if (firstGen || !slotCount) return ""
    const left = Array.from({ length: slotCount }, (_, i) => i).filter((i) => !placed.some((p) => p.i === i)).map((i) => i + 1)
    if (!left.length) return ""
    return left.length === 1
      ? ` שקופית ${left[0]} נשארה כמו שהייתה, כי השארתם אותה ריקה.`
      : ` שקופיות ${listNums(left)} נשארו כמו שהיו, כי השארתם אותן ריקות.`
  }
  const listNums = (n: number[]) => (n.length === 1 ? `${n[0]}` : `${n.slice(0, -1).join(", ")} ו-${n[n.length - 1]}`)
  const askNow = emptyNeedsAsk && (askKey === "*" || askKey === slotsKey)

  /**
   * Her words for the question (Hani, 2026-11-07: "עכשיו אג׳נרט 2 תמונות
   * מהמחשב שלך ואחת תהיה ai האם לזה התכוונת?") — by source, count and kind.
   */
  function emptyQuestion(): string {
    const items = slotPlacement().map((p) => p.item)
    const n = items.length
    const kinds = new Set(items.map((it) => it.kind))
    const allFile = items.every((it) => !!it.file && !it.drive)
    const allDrive = items.every((it) => !!it.drive)
    const from = allFile ? "מהמחשב שלכם" : allDrive ? "מהדרייב שלכם" : "שלכם"
    const noun =
      n === 1
        ? kinds.has("video") ? "הסרטון" : "התמונה"
        : kinds.size > 1 ? `${n} הקבצים` : kinds.has("video") ? `${n} הסרטונים` : `${n} התמונות`
    const e = emptyNums.length
    if (firstGen) {
      const ai = e === 1 ? "ושקופית אחת תיווצר עם AI" : `ו-${e} שקופיות ייווצרו עם AI`
      return `עכשיו ניצור קרוסלה עם ${noun} ${from}, ${ai}. לזה התכוונתם?`
    }
    const keep = e === 1 ? `ושקופית ${emptyNums[0]} תישאר כמו שהייתה` : `ושקופיות ${listNums(emptyNums)} יישארו כמו שהיו`
    return `עכשיו נכניס את ${noun} ${from} לשקופיות שבחרתם, ${keep}. לזה התכוונתם?`
  }
  /** Ask (once per slot set) as a turn in the thread, and hold the action. */
  function askAboutEmpty(action: "send" | "asIs", patchKey: (fn: (s: MediaChat) => MediaChat) => void) {
    const text = emptyQuestion()
    setAskFor(action)
    setAskKey(slotsKey)
    patchKey((s) => {
      const last = s.messages[s.messages.length - 1]
      if (last?.askEmpty && last.content === text) return s
      return { ...s, messages: [...s.messages, { role: "assistant", content: text, askEmpty: true }] }
    })
  }
  function slotPlacement(): { i: number; ref: string; item: AsIsItem }[] {
    return slots.flatMap((ref, i) => {
      const item = ref ? originOf(ref) : undefined
      return ref && item ? [{ i, ref, item }] : []
    })
  }
  const moveSlot = (from: number, to: number) => {
    const a = slots[from]
    const b = slots[to]
    if (!a) return
    setSlotChoice((c) => ({ ...c, [a]: to, ...(b ? { [b]: from } : {}) }))
  }
  // The add menu, wrapped: a file added after she pointed at an empty slot goes there.
  const slotRefs: ReferenceImages = slotCount
    ? {
        ...refs,
        add: async (files, opts) => {
          const added = await refs.add(files, opts)
          if (slotTarget !== null && !opts?.look && added[0]) {
            const at = slotTarget
            setSlotChoice((c) => ({ ...c, [added[0]]: at }))
            setSlotTarget(null)
          }
          return added
        },
      }
    : refs
  /**
   * The panel's answer to what she attached (Hani, 2026-11-06: "שהצ׳אט יציע
   * לו לשים עוד שקופית ויגיד לו אם הוא לא שם, זו שקופית מה ai").
   */
  const slotReply = (() => {
    // Just emptied, and still empty: that slide is the AI's — said at once.
    if (emptied !== null && emptied < slots.length && slots[emptied] === null) {
      return {
        text: emptyIsAi
          ? `שקופית ${emptied + 1} ריקה עכשיו, אז היא תיווצר עם AI. רוצים לשים בה מדיה?`
          : `שקופית ${emptied + 1} ריקה עכשיו, אז תישאר בה השקופית שהייתה שם. רוצים לשים בה מדיה?`,
        more: !refs.full,
        target: emptied,
      }
    }
    if (!slotted.length) return null
    const nums = slots.flatMap((r, i) => (r ? [i + 1] : []))
    const kinds = slotted.map((r) => (videoRefs.includes(r) ? "video" : "image"))
    const noun =
      kinds.length === 1
        ? kinds[0] === "video" ? "את הסרטון" : "את התמונה"
        : kinds.every((k) => k === "video") ? "את הסרטונים" : kinds.every((k) => k === "image") ? "את התמונות" : "את המדיה"
    const where = nums.length === 1 ? `בשקופית ${nums[0]}` : `בשקופיות ${nums.slice(0, -1).join(", ")} ו-${nums[nums.length - 1]}`
    const empty = slots.length - slotted.length
    const more = empty > 0 && !refs.full
    return {
      text: `שמתי ${noun} ${where}.${
        empty > 0
          ? `${more ? " רוצים להוסיף מדיה לשקופית נוספת?" : ""}${
              emptyIsAi ? ` ${empty === 1 ? "שקופית שתשאירו ריקה תיווצר" : "מקומות שתשאירו ריקים ייווצרו"} עם AI בשפה הוויזואלית.` : ""
            }`
          : ""
      }`,
      more,
      target: null as number | null,
    }
  })()

  // The slots' live line sits under the thread: scrolled to when it changes,
  // or it was easy to miss below the fold (2026-11-07).
  const slotLine = slotReply?.text ?? ""
  useEffect(() => {
    if (slotLine) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [slotLine])

  /**
   * A message with media in her slide slots, on a carousel that exists: her
   * pictures go into their slides through the AI edit (adapted as today);
   * her clips become video slides in theirs — captioned per her words, or as
   * they are with no words. Her own carousel: every file as it is.
   */
  const sendSlotted = async (text: string, attached: string[], placed: { i: number; ref: string; item: AsIsItem }[]) => {
    const key = chatKey
    const patchKey = (fn: (s: MediaChat) => MediaChat) => updateChat(key, fresh, fn)
    // No carousel yet (or her own): every file goes in as it is, in its slot,
    // and — with no carousel — the empty slots are generated with AI.
    const whole = own || firstGen
    const imgs = whole ? [] : placed.filter((p) => p.item.kind === "image")
    const asIs = whole ? placed : placed.filter((p) => p.item.kind === "video")
    refs.clear()
    links.reset()
    setSentAsIs(null)
    setSlotChoice({})
    setSlotTarget(null)
    setEmptied(null)
    patchKey((s) => ({
      ...s,
      input: "",
      busy: true,
      extra: { ...s.extra, progress: imgs.length ? "מכניסים את התמונות לשקופיות שבחרתם..." : "מכינים את השקופיות שבחרתם..." },
      messages: [...s.messages, { role: "user", content: text, ...(attached.length ? { images: attached } : {}) }],
    }))
    const fail = (message: string) =>
      patchKey((s) => ({
        ...s,
        busy: false,
        extra: { ...s.extra, progress: "" },
        messages: [...s.messages, { role: "assistant", content: message, error: true }],
      }))
    let base: string[] | undefined
    if (imgs.length) {
      const pictures = attached.filter((r) => !videoRefs.includes(r))
      // Slot pictures go up to her storage first and travel as URLs — one
      // per slide, past the request-size cap (lib/ai-edit-references).
      const sent = await Promise.all(
        pictures.map((ref) => (imgs.some((p) => p.ref === ref) ? uploadSlotPicture(ref) : Promise.resolve(ref))),
      )
      if (sent.some((u) => !u)) return fail("לא הצלחתי להעלות את אחת התמונות. נסו שוב.")
      const r = await editImages(text, sent as string[], [], pictures.map((ref) => imgs.find((p) => p.ref === ref)?.i ?? -1))
      if (!r.ok) return fail(aiErrorMessage(r.message || "העריכה לא הצליחה. נסו שוב."))
      if (r.unchanged) return fail(r.unchanged)
      base = r.urls
    }
    let said = imgs.length
      ? `הכנסתי ${imgs.length === 1 ? "את התמונה לשקופית" : "את התמונות לשקופיות"} ${imgs.map((p) => p.i + 1).join(", ")}.`
      : ""
    if (asIs.length) {
      patchKey((s) => ({ ...s, extra: { ...s.extra, progress: "מכינים את שקופית הווידאו..." } }))
      const words = text !== REFERENCE_ONLY_INSTRUCTION ? text : ""
      const res = await requestAsIsUpload(
        format,
        asIs.map((p) => p.item),
        {
          at: asIs.map((p) => p.i),
          ...(words ? { forEdit: true, instruction: words } : {}),
          ...(base ? { base } : {}),
          ...(firstGen ? { fill: slotCount } : {}),
        },
      )
      if (!res.ok) return fail(said ? `${said} ${res.message}` : res.message)
      said = said ? `${said} ${res.message}` : res.message
    }
    patchKey((s) => ({
      ...s,
      busy: false,
      extra: { ...s.extra, progress: "" },
      messages: [...s.messages, { role: "assistant", content: `${said}${keptNote(placed)}`, done: true, noStyle: true }],
    }))
  }

  /**
   * "תעשה לי כזה" (Hani, 2026-11-07). Handles the message when it asks for a
   * carousel like one she shows, or when one was asked for and the link /
   * screenshots arrive. Returns true when it handled it.
   */
  const maybeCopy = async (
    typed: string,
    cur: MediaChat,
    patchKey: (fn: (s: MediaChat) => MediaChat) => void,
  ): Promise<boolean> => {
    const link = typed.match(LINK_RE)?.[0]?.replace(/[.,;:!?)\]]+$/, "")
    const shots = refs.split(refs.refs).place.filter((r) => !videoRefs.includes(r))
    const waiting = cur.extra.copy?.phase === "await"
    if (!copyAllowed) return false
    // Her personal elements, asked for: a picture = her profile picture, an
    // @ = her handle, the rest of her words = her name. Kept for next time.
    const pending = cur.extra.copy
    if (pending?.phase === "needs" && (typed || shots.length)) {
      const attached = refs.refs
      refs.clear()
      links.reset()
      patchKey((s) => ({
        ...s,
        input: "",
        busy: true,
        extra: { ...s.extra, progress: "שומרים את הפרטים שלכם..." },
        messages: [...s.messages, { role: "user", content: typed || "תמונת פרופיל", ...(attached.length ? { images: attached } : {}) }],
      }))
      const handle = typed.match(/@([A-Za-z0-9._]{1,40})/)?.[1]
      const name = typed
        .replace(/@[A-Za-z0-9._]+/g, "")
        .replace(/^(השם|שם|שם העמוד|העמוד)\s*(שלי)?\s*(הוא|:)?\s*/u, "")
        .replace(/[,.،]+$/, "")
        .trim()
      const avatarUrl = shots.length ? await uploadSlotPicture(shots[0]) : null
      const res = await fetch("/api/profile/card-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(pending.needs.includes("name") && name && name.length <= 60 ? { name } : {}),
          ...(handle ? { handle } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        }),
      }).catch(() => null)
      patchKey((s) => ({ ...s, busy: false, extra: { ...s.extra, progress: "", copy: null } }))
      if (!res?.ok) {
        patchKey((s) => ({
          ...s,
          extra: { ...s.extra, copy: pending },
          messages: [...s.messages, { role: "assistant", content: "לא הצלחתי לשמור את הפרטים. נסו שוב.", error: true }],
        }))
        return true
      }
      runCopy(pending.mode, { refs: pending.refs, brief: pending.brief })
      return true
    }
    const wants = LIKE_THIS.test(typed)
    if (!wants && !(waiting && (link || shots.length))) return false
    // On a carousel that exists, "כזה" alone may be an ordinary edit ("תעשו את
    // הכותרת כזאת גדולה") — only a link or screenshots make it a copy.
    if (!cur.extra.gen && !waiting && !link && !shots.length) return false
    const attached = refs.refs
    const brief = typed.replace(LINK_RE, "").trim()
    refs.clear()
    links.reset()
    setSentAsIs(null)
    setSlotChoice({})
    setSlotTarget(null)
    setEmptied(null)
    patchKey((s) => ({
      ...s,
      input: "",
      messages: [...s.messages, { role: "user", content: typed || "צילומי מסך", ...(attached.length ? { images: attached } : {}) }],
    }))
    const say = (content: string, extra: Partial<ChatMessage> = {}, copy: MediaChatExtra["copy"] = null) =>
      patchKey((s) => ({
        ...s,
        busy: false,
        extra: { ...s.extra, progress: "", copy },
        messages: [...s.messages, { role: "assistant", content, ...extra }],
      }))
    if (shots.length) {
      // Her screenshots: a structure to copy, not slides (the slots don't apply).
      patchKey((s) => ({ ...s, busy: true, extra: { ...s.extra, progress: "מעלים את צילומי המסך..." } }))
      const up = await Promise.all(shots.map((r) => uploadSlotPicture(r)))
      if (up.some((u) => !u)) {
        say("לא הצלחתי להעלות את אחד מצילומי המסך. צרפו אותם שוב.", { error: true }, { phase: "await" })
        return true
      }
      const look = lookFromWords(typed)
      if (look) {
        // Her words said which look — no question: build it.
        say(look === "exact" ? COPY_COPY.goExact : COPY_COPY.goBrand, {}, null)
        runCopy(look, { refs: up as string[], brief })
        return true
      }
      say(COPY_COPY.shots, { copyAsk: true }, { phase: "choose", refs: up as string[], brief })
      return true
    }
    if (link) {
      patchKey((s) => ({ ...s, busy: true, extra: { ...s.extra, progress: COPY_COPY.reading } }))
      let slides: string[] = []
      let message = ""
      try {
        const res = await fetch("/api/carousel/reference-slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link }),
        })
        const data = (await res.json().catch(() => ({}))) as { slides?: string[]; message?: string }
        slides = res.ok && Array.isArray(data.slides) ? data.slides : []
        message = data.message ?? ""
      } catch {
        slides = []
      }
      if (slides.length < 2) {
        say(message || "אי אפשר לקרוא לינק מחשבון אישי או לא ציבורי. שימו לי כאן צילומי מסך של השקופיות ואפעל לפיהם.", {}, { phase: "await" })
        return true
      }
      const up = await Promise.all(slides.map((r) => uploadSlotPicture(r)))
      if (up.some((u) => !u)) {
        say("לא הצלחתי לשמור את השקופיות מהלינק. שימו לי כאן צילומי מסך של השקופיות ואפעל לפיהם.", {}, { phase: "await" })
        return true
      }
      const look = lookFromWords(typed)
      if (look) {
        say(look === "exact" ? COPY_COPY.goExact : COPY_COPY.goBrand, {}, null)
        runCopy(look, { refs: up as string[], brief })
        return true
      }
      say(COPY_COPY.link, { copyAsk: true }, { phase: "choose", refs: up as string[], brief })
      return true
    }
    // Asked, nothing to look at yet.
    say(COPY_COPY.askFor, {}, { phase: "await" })
    return true
  }
  /** Her answer: build it — in her visual language, or as the reference looks. */
  const runCopy = (
    mode: "brand" | "exact",
    given?: { refs: string[]; brief: string },
    opts: { skipMissing?: boolean } = {},
  ) => {
    const c = given ? { phase: "choose" as const, ...given } : session.extra.copy
    if (!c || c.phase === "await") return
    patch((s) => ({ ...s, extra: { ...s.extra, copy: null } }))
    const brief = c.brief || "קרוסלה באותו מבנה כמו הקרוסלה המצורפת"
    const label = mode === "brand" ? COPY_COPY.brand : COPY_COPY.exact
    if (session.extra.gen && session.extra.gen.phase !== "running") {
      void generate(brief, [], label, [], { structure: { refs: c.refs, mode, ...opts } })
      return
    }
    // A carousel that exists: rebuilt on the reference, through the media
    // panel's own generation (the same channel as "להעלות כמו שזה").
    void (async () => {
      patch((s) => ({
        ...s,
        busy: true,
        extra: { ...s.extra, progress: "בונים את הקרוסלה מחדש לפי המבנה של הרפרנס... זה לוקח כמה דקות" },
        messages: given ? s.messages : [...s.messages, { role: "user", content: label }],
      }))
      const r = await requestAsIsUpload(format, [], { regenerate: { structure: { refs: c.refs, mode, ...opts } }, instruction: brief })
      if (!r.ok && r.needs?.length) {
        patch((s) => ({
          ...s,
          busy: false,
          extra: { ...s.extra, progress: "", copy: { phase: "needs", refs: c.refs, brief, mode, needs: r.needs! } },
          messages: [...s.messages, { role: "assistant", content: r.message, needInfo: true }],
        }))
        return
      }
      patch((s) => ({
        ...s,
        busy: false,
        extra: { ...s.extra, progress: "" },
        messages: [
          ...s.messages,
          r.ok
            ? { role: "assistant", content: r.message, done: true, noStyle: true }
            : { role: "assistant", content: aiErrorMessage(r.message), error: true },
        ],
      }))
    })()
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
    // "תעשה לי כזה": a carousel to copy the structure of — before the slots,
    // since then what she attached is a reference, not slides.
    // Before the first generation AND on a carousel that exists (live bug,
    // 2026-11-07: "הקרוסלה נערכה" — an edit with a reference). Not on her own
    // slides: rebuilding would replace what she brought.
    // Her own carousel too, when she attaches a reference (she asked to
    // restyle all of it — 2026-11-07); "כזה" alone stays an edit there.
    if (format === "carousel" && (!cur.extra.gen || cur.extra.gen.phase !== "running")) {
      const typed = (preset ?? cur.input).trim()
      if (await maybeCopy(typed, cur, patchKey)) return
    }
    // Slides still empty in her slots: asked first (Hani, 2026-11-06: "צריך
    // אישור") — nothing is sent until she says yes or adds media.
    if (emptyNeedsAsk && !confirmedEmpty.current) {
      askAboutEmpty("send", patchKey)
      return
    }
    confirmedEmpty.current = false
    setAskKey(null)
    // Before the generation: whatever she types (and attaches) is her brief
    // for it — references alone work too, as in the AI edit.
    if (cur.extra.gen && cur.extra.gen.phase !== "running") {
      const attached = refs.refs
      const { place, looks } = refs.split(attached)
      const placing = !!cur.extra.gen.placeRefs && place.length > 0
      const typed = (preset ?? cur.input).trim()
      const brief = typed || (placing ? PLACE_ONLY_INSTRUCTION : attached.length ? REFERENCE_ONLY_INSTRUCTION : "")
      if (!brief || links.busy) return
      // Carousel slide slots: each picture / clip on the slide she chose.
      const placedNow = slotPlacement()
      if (placedNow.length) {
        const clips = placedNow.filter((p) => p.item.kind === "video")
        const pictures = attached.filter((r) => !videoRefs.includes(r))
        const placeList = cur.extra.gen.placeRefs ? pictures.filter((r) => !looks.includes(r)) : []
        const placeAt = placeList.map((r) => placedNow.find((p) => p.ref === r)?.i ?? -1)
        // Uploaded first and sent as URLs — every slide can have one, past
        // the request-size cap data URLs have (lib/ai-edit-references).
        setUploading(true)
        const uploaded = await Promise.all(placeList.map((r) => uploadSlotPicture(r)))
        setUploading(false)
        if (uploaded.some((u) => !u)) {
          patchKey((s) => ({
            ...s,
            messages: [...s.messages, { role: "assistant", content: "לא הצלחתי להעלות את אחת התמונות. נסו שוב.", error: true }],
          }))
          return
        }
        const sendPictures = pictures.map((r) => {
          const k = placeList.indexOf(r)
          return k >= 0 ? (uploaded[k] as string) : r
        })
        const originals = refs.originals(attached)
        setSentAsIs(originals.length ? { index: cur.messages.length, items: originals } : null)
        refs.clear()
        links.reset()
        setSlotChoice({})
        setSlotTarget(null)
        setEmptied(null)
        void generate(
          brief,
          sendPictures,
          undefined,
          looks,
          {
            ...(placeAt.length && placeAt.every((n) => n >= 0) ? { placeAt } : {}),
            videos: clips.map((p) => ({ at: p.i, item: p.item })),
          },
          clips.map((p) => p.ref),
          attached,
        )
        return
      }
      // A video makes a video (never a frame).
      if (await sendWithVideo(typed || brief, attached)) return
      const originals = refs.originals(attached)
      setSentAsIs(originals.length ? { index: cur.messages.length, items: originals } : null)
      refs.clear()
      links.reset()
      void generate(brief, attached, undefined, looks)
      return
    }
    let text = (preset ?? cur.input).trim()
    const attached = refs.refs
    if (!text && attached.length) text = REFERENCE_ONLY_INSTRUCTION
    if (!text) return
    // Carousel slide slots: each file on the slide she chose.
    const placedNow = slotPlacement()
    if (placedNow.length) {
      await sendSlotted(text, attached, placedNow)
      return
    }
    if (await sendWithVideo(text, attached)) return
    const originals = refs.originals(attached)
    setSentAsIs(originals.length ? { index: cur.messages.length, items: originals } : null)
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
    // The edit ran but changed nothing (the server saved nothing): the reply
    // says so instead of "עדכנתי" (Hani, 2026-11-05).
    let unchanged: string | null = null
    // No image this time: the ones from her last message that had any
    // ("שימי את התמונה!" after a try that missed means those).
    const earlier = attached.length
      ? []
      : ([...cur.messages].reverse().find((m) => m.role === "user" && m.images?.length)?.images ?? [])
    const run = (
      format === "b_roll"
        ? startBRollEdit(postId, editText, { quiet: true, references: attached, earlierReferences: earlier })
        : editImages(editText, attached, earlier)
    ).then((r) => {
      if (r.ok && r.unchanged) unchanged = r.unchanged
      return r
    })
    const result = preview
      ? await trackAwayResult(`ai-edit-${postId}-${format}-${Date.now()}`, run, isWatching, AWAY_COPY[format], postId)
      : await run
    patchKey((s) => ({
      ...s,
      busy: false,
      messages: [
        ...s.messages,
        result.ok && unchanged
          ? { role: "assistant", content: unchanged, memory }
          : result.ok
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
    earlierReferences: string[] = [],
    /** Carousel slide slots: per reference, its slide (0-based) or -1. */
    placeAt?: number[],
  ): Promise<{ ok: true; unchanged?: string; urls?: string[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/media/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          format,
          instruction: text,
          ...(references.length ? { references } : {}),
          ...(earlierReferences.length ? { earlierReferences } : {}),
          ...(placeAt?.some((n) => n >= 0) ? { placeAt } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        urls?: string[]
        message?: string
        error?: string
        unchanged?: boolean
      }
      if (!res.ok || !data.urls) return { ok: false, message: data.message ?? data.error ?? "העריכה לא הצליחה" }
      if (data.unchanged) return { ok: true, unchanged: data.message || "הבקשה לא שינתה כלום, אז השארתי את המדיה כמו שהייתה." }
      onUpdated?.(format, data.urls)
      return { ok: true, urls: data.urls }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  const lastEdit = lastLandedEdit(messages)
  const title = gen ? GEN_COPY[format].title : copy.title
  /** A style picked (not "חדש לגמרי"): she may skip the words. */
  const canSkip = gen?.phase === "brief" && !!gen.style && gen.style !== "blank"
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
              <BidiText text={m.content} />
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
            {/* Generate in the picked style as is — under the question; and
                beside it, while she has media attached, upload it as it is. */}
            {canSkip && i === messages.length - 1 && !loading && !m.askEmpty && !m.copyAsk && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                <Chip
                  onClick={() => {
                    refs.clear()
                    links.reset()
                    void generate("", [], GEN_SKIP)
                  }}
                >
                  {GEN_SKIP}
                </Chip>
                {asIsNow.length > 0 && !referenceMode && (
                  <Chip onClick={() => void uploadAsIs(asIsNow, refs.split(refs.refs).place)}>{AS_IS}</Chip>
                )}
              </div>
            )}
            {/* The message she just sent with media: upload it as it is instead. */}
            {sentAsIs && sentAsIs.index === i && m.role === "user" && !loading &&
              !messages.slice(i + 1).some((x) => x.role === "user") && (
                <div className="flex max-w-[85%] flex-wrap justify-start gap-1.5">
                  <Chip onClick={() => void uploadAsIs(sentAsIs.items, m.images ?? [])}>{AS_IS}</Chip>
                </div>
              )}
            {/* Her missing personal elements: go on without, or add them. */}
            {m.needInfo && i === messages.length - 1 && session.extra.copy?.phase === "needs" && !loading && (() => {
              const c = session.extra.copy
              return (
                <div className="flex max-w-[85%] flex-wrap items-center justify-end gap-1.5">
                  {(c.needs.includes("avatar") || c.needs.includes("photo")) && (
                    <Button size="sm" className="h-7 rounded-full px-3 text-xs-body" onClick={() => setAddMenuOpen(true)}>
                      {c.needs.includes("avatar") ? "להוסיף תמונת פרופיל" : "להוסיף תמונה"}
                    </Button>
                  )}
                  <Chip
                    onClick={() => {
                      patch((s) => ({ ...s, extra: { ...s.extra, copy: null } }))
                      runCopy(c.mode, { refs: c.refs, brief: c.brief }, { skipMissing: true })
                    }}
                  >
                    להמשיך בלי
                  </Chip>
                </div>
              )
            })()}
            {/* "תעשה לי כזה": how to design the copy — her language first. */}
            {m.copyAsk && i === messages.length - 1 && session.extra.copy?.phase === "choose" && !loading && (
              <div className="flex max-w-[85%] flex-wrap items-center justify-end gap-1.5">
                <Button size="sm" className="h-7 rounded-full px-3 text-xs-body" onClick={() => runCopy("brand")}>
                  {COPY_COPY.brand}
                </Button>
                <Chip onClick={() => runCopy("exact")}>{COPY_COPY.exact}</Chip>
              </div>
            )}
            {/* The empty-slides question's answers — while it's the last turn and still true. */}
            {m.askEmpty && i === messages.length - 1 && askNow && !loading && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs-body font-normal"
                  onClick={() => {
                    confirmedEmpty.current = true
                    if (askFor === "asIs") void uploadAsIs(asIsNow, refs.split(refs.refs).place)
                    else void send()
                  }}
                >
                  {firstGen ? "כן, ליצור" : "כן, להמשיך"}
                </Button>
                <Chip
                  onClick={() => {
                    setAskKey(null)
                    setSlotTarget(emptyNums[0] - 1)
                    if (!refs.full) setAddMenuOpen(true)
                  }}
                >
                  לא, אוסיף תמונה משלי
                </Chip>
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

        {/* What she attached to the carousel's slots: where it went, and
            that an empty slot is the AI's (Hani, 2026-11-06). */}
        {slotReply && !(askNow && messages[messages.length - 1]?.askEmpty) && !loading && (
          <div className="flex flex-col items-end gap-1.5" aria-live="polite">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-se-sm bg-bg-surface px-3 py-2 text-small leading-relaxed text-text-primary-default">
              {slotReply.text}
            </div>
            {slotReply.more && (
              <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                <Chip
                  onClick={() => {
                    if (slotReply.target !== null) setSlotTarget(slotReply.target)
                    setAddMenuOpen(true)
                  }}
                >
                  להוסיף עוד מדיה
                </Chip>
              </div>
            )}
          </div>
        )}

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
        <LinkReferenceRows l={links} />
        {asIsNow.length > 0 && !canSkip && !loading && !referenceMode && !(askNow && messages[messages.length - 1]?.askEmpty) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Chip onClick={() => void uploadAsIs(asIsNow, refs.split(refs.refs).place)}>{AS_IS}</Chip>
          </div>
        )}
        {(slotted.length > 0 || slotReply?.target != null) && (
          <CarouselSlideSlots
            slots={slots}
            videos={videoRefs}
            target={slotTarget}
            aiEmpty={emptyIsAi}
            onPick={(i) => {
              setSlotTarget(i)
              if (!refs.full) setAddMenuOpen(true)
            }}
            onMove={moveSlot}
            onRemove={(i) => {
              const at = slots[i] ? refs.refs.indexOf(slots[i]!) : -1
              if (at < 0) return
              // The rest stay exactly where they are — the emptied slot stays a gap.
              setSlotChoice(Object.fromEntries(slots.flatMap((r, k) => (r && k !== i ? [[r, k]] : []))))
              setEmptied(i)
              refs.remove(at)
            }}
            disabled={loading}
          />
        )}
        {/* A style request typed: the pictures are a design reference, not slides. */}
        {referenceMode && refs.split(refs.refs).place.length > 0 && (
          <p className="mb-1.5 text-xs-body text-text-neutral-default">התמונות ישמשו כרפרנס לעיצוב.</p>
        )}
        <ReferenceTray r={refs} hide={slotted} />
        {/* A video attached: said right away what happens with it. */}
        {asIsAttached.some((o) => o.kind === "video") ? (
          format === "image_post" ? (
            <p role="alert" className="mb-2 text-xs-body text-button-destructive-default">
              {STILL_FORMAT_VIDEO[format]}
            </p>
          ) : format === "carousel" ? (
            <p className="mb-2 text-xs-body text-text-neutral-default">
              הסרטון ייכנס לשקופית שבחרתם (4:5, עד {CAROUSEL_VIDEO_MAX_SECONDS} שניות). עם בקשה, יתווסף עליו כיתוב מונפש; מה שצילמתם לא משתנה.
            </p>
          ) : (
            <p className="mb-2 text-xs-body text-text-neutral-default">
              הסרטון שצירפתם הוא שיעלה, ועליו הטקסט והאנימציה שתבקשו. מה שצילמתם לא משתנה.
            </p>
          )
        ) : gen?.phase === "brief" && gen.placeRefs && !referenceMode && refs.refs.length > 0 && (() => {
          const { place, looks } = refs.split(refs.refs)
          return (
            <p className="mb-2 text-xs-body text-text-neutral-default">
              {[place.length ? PLACE_NOTE[format] : "", looks.length ? LOOK_NOTE : ""].filter(Boolean).join(" ")}
            </p>
          )
        })()}
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
                ? canSkip
                  ? "למשל: הפעם יותר אוויר, או הדביקו קישור לפוסט שאהבתם"
                  : "למשל: רקע לבן ונקי, הרבה אוויר, בלי איורים"
                : "מה תרצו לשנות?"
            }
            ref={inputRef}
            rows={1}
            autoFocus
            className="max-h-28 min-h-[36px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-small shadow-none focus-visible:ring-0"
          />
          {/* "מהמחשב" / "מגוגל דרייב" — the folder linked to this format (Hani, 2026-11-06). */}
          <ReferenceAddMenu
            r={slotRefs}
            format={format}
            disabled={loading}
            {...(slotCount ? { menuOpen: addMenuOpen, onMenuOpenChange: setAddMenuOpen } : {})}
          />
          <Button
            size="icon-sm"
            onClick={() => void send()}
            disabled={(!input.trim() && !refs.refs.length) || loading || links.busy || uploading || (askNow && messages[messages.length - 1]?.askEmpty)}
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
