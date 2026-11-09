/**
 * The edit agent — the AI edit chat as an agent, not a one-shot planner
 * (Hani, 2026-11-09: "I want it to work on anything at all, even something
 * I haven't run into yet").
 *
 * PREP ONLY — nothing imports this yet. Built after the text-on-media bug
 * session lands, per the plan agreed in chat:
 *   1. the run moves to the server (a job that survives reload / close),
 *   2. the agent sees the whole state and acts through tools, step by step,
 *   3. it looks at the result and fixes it before answering,
 *   4. formats move over one at a time (carousel first, Hani only).
 *
 * Today's flow (lib/own-media-plan → lib/own-media-edit, api/media/ai-edit)
 * picks ONE closed plan up front and runs it blind: frame numbers that don't
 * exist yet are dropped, the reply is written before anything ran, and a gap
 * (3 pictures, 6 slides) is either guessed or broken. The agent replaces the
 * guess with a look, a question, or a step.
 */

import type { OwnEditFormat } from "@/lib/own-media"

export type AgentFormat = OwnEditFormat | "talking_head"

/** One unit of the script — the ONLY source of words on the media. */
export interface ScriptUnit {
  headline?: string
  body?: string
}

/** One frame / slide as it is right now. */
export interface FrameState {
  /** 1-based, in the set's current order. */
  n: number
  url: string
  kind: "image" | "video"
  /** A still the agent can LOOK at (the image, or a frame grabbed from the video). */
  thumbUrl: string
  /** Hers (filmed / photographed / uploaded) or made by us. */
  origin: "hers" | "ai"
  /** What's written on it now, as we know it (our caption record or the AI design's text). */
  text?: ScriptUnit
  /** Our caption over her original (we can redo it), words baked into her design, or none. */
  caption: "ours" | "ours-legacy" | "none" | "baked" | "unknown"
  /** Same original as another frame (a duplicate) — the agent sees the set honestly. */
  sameSourceAs?: number
}

/** Everything the agent sees before it acts — the state, not a summary of it. */
export interface EditState {
  postId: string
  format: AgentFormat
  /** The format's script split the way the card shows it (lib/own-media-plan scriptUnits). */
  script: ScriptUnit[]
  frames: FrameState[]
  /** What she attached to THIS message (her storage URLs). */
  attached: { url: string; kind: "image" | "video"; thumbUrl: string }[]
  /** The whole conversation, oldest first. */
  history: { role: "user" | "assistant"; content: string; images?: string[] }[]
  /** Her request now, in her words. */
  request: string
  /** Her visual language, in short lines (lib/visual-language direction). */
  visualLanguage: string[]
}

/**
 * A choice the agent offers instead of guessing. Each option is a button in
 * the chat; pressing it sends `action` back as her next turn, so the agent
 * continues from her pick with the same state.
 */
export interface AskOption {
  /** Short Hebrew label on the button. */
  label: string
  /** What pressing it means, in words the agent will read back (Hebrew or English). */
  action: string
}

/** What one run of the agent hands back to the panel. */
export type AgentOutcome =
  | {
      kind: "done"
      /** Written from what ACTUALLY happened (the tool results), never from the plan. */
      reply: string
      /** The saved set, in order. */
      urls: string[]
      /** The set before this run — "ביטול השינוי האחרון". */
      before: string[]
      /** Steps that failed and how the agent dealt with them (said in the reply too). */
      problems: string[]
    }
  | {
      kind: "ask"
      /** One short Hebrew question. */
      question: string
      /** 2–4 options. */
      options: AskOption[]
    }
  | { kind: "refused"; reply: string }
  | { kind: "failed"; reply: string }

/** The job row the panel follows (server-side run, survives reload). */
export interface AgentJob {
  id: string
  chatKey: string
  status: "running" | "asking" | "done" | "failed"
  /** The current step, for the busy row ("מכתבים פריים 2 מתוך 3..."). */
  progress: string
  outcome?: AgentOutcome
  updatedAt: string
}
