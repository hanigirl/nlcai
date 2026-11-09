/**
 * The agent's toolbox (PREP — see ./types.ts). Each tool maps onto a step
 * that already exists today, so the agent adds judgement, not new renderers:
 *
 *   look_at_frames      — new: thumbnails of frames as images, so it can SEE
 *   set_caption         — lib/own-media-edit caption() → story/generate-video-media | media/caption-image
 *   remove_caption      — lib/own-media-edit uncaption()
 *   duplicate_frame     — set op (today: duplicate_slide)
 *   add_frame           — own-edit "slide" / "animated_slide"
 *   edit_ai_frame       — own-edit "edit_animated_frame" | media/ai-edit | b-roll/edit
 *   place_attached      — as-is import / carousel video-slide
 *   remove_frames / reorder — set ops
 *   ask_user            — new: a question with 2–4 buttons; ends the run
 *   finish              — new: the reply, written from the tool results
 *
 * Text never comes from the model: every tool that puts words on media takes
 * a script unit INDEX (or her dictated words, checked against her request),
 * not free text. That is the hard rule "media text = the script" built into
 * the tool shape, so no prompt can talk its way around it.
 */

import type Anthropic from "@anthropic-ai/sdk"

type Tool = Anthropic.Tool

const frames = { type: "array", items: { type: "integer", minimum: 1 }, description: "1-based frame numbers in the CURRENT set (after your earlier steps)." } as const

/** Words on media: a script unit, or — only when she dictated them — her exact words. */
const words = {
  type: "object",
  description:
    "Where the words come from. Use script_unit (1-based) almost always. dictated is ONLY for words she typed in this conversation, copied exactly; anything else is rejected.",
  properties: {
    script_unit: { type: "integer", minimum: 1 },
    dictated: { type: "object", properties: { headline: { type: "string" }, body: { type: "string" } } },
  },
} as const

export const AGENT_TOOLS: Tool[] = [
  {
    name: "look_at_frames",
    description: "See frames as images (and what is written on them). Use before deciding when the state alone doesn't tell you, and ALWAYS after your changes, before finish.",
    input_schema: { type: "object", properties: { frames }, required: ["frames"] },
  },
  {
    name: "set_caption",
    description: "Put the caption over a frame of HER media (or replace ours). Animated on video when she asked for motion; position/style only when she asked.",
    input_schema: {
      type: "object",
      properties: {
        frame: { type: "integer", minimum: 1 },
        words,
        animated: { type: "boolean" },
        position: { enum: ["top", "center", "bottom"] },
        style: { type: "object", properties: { pill: { type: "string" }, text: { type: "string" }, scale: { type: "number" } } },
        design: { type: "string", description: "Her own words about the look, copied as she said them." },
      },
      required: ["frame", "words"],
    },
  },
  {
    name: "remove_caption",
    description: "Take our caption off — back to her file as she brought it.",
    input_schema: { type: "object", properties: { frames }, required: ["frames"] },
  },
  {
    name: "duplicate_frame",
    description: "Copy a frame (her same video/photo on more slides). The copy is placed right after it and carries NO caption until you set one.",
    input_schema: { type: "object", properties: { frame: { type: "integer", minimum: 1 }, copies: { type: "integer", minimum: 1, maximum: 9 } }, required: ["frame"] },
  },
  {
    name: "add_frame",
    description: "A NEW frame designed by AI in her visual language, after position `after` (0 = first). Still, or animated (story only, ~3 min).",
    input_schema: {
      type: "object",
      properties: {
        after: { type: "integer", minimum: 0 },
        words,
        animated: { type: "boolean" },
        role: { enum: ["cover", "content", "closing"] },
        design: { type: "string" },
      },
      required: ["after", "words"],
    },
  },
  {
    name: "edit_ai_frame",
    description: "Change a frame WE made (origin ai) in place: look, colours, size, motion, background — her request in her words. Never for her own frames.",
    input_schema: {
      type: "object",
      properties: { frame: { type: "integer", minimum: 1 }, instruction: { type: "string" }, words, new_background: { type: "boolean" } },
      required: ["frame", "instruction"],
    },
  },
  {
    name: "place_attached",
    description: "Put a file she attached in this message onto the set as it is (a new frame after `after`, or replacing `replace`).",
    input_schema: {
      type: "object",
      properties: { attached: { type: "integer", minimum: 1 }, after: { type: "integer", minimum: 0 }, replace: { type: "integer", minimum: 1 } },
      required: ["attached"],
    },
  },
  {
    name: "remove_frames",
    description: "Remove frames from the set. Never leave the set empty.",
    input_schema: { type: "object", properties: { frames }, required: ["frames"] },
  },
  {
    name: "reorder",
    description: "The full new order — a permutation of the current frame numbers.",
    input_schema: { type: "object", properties: { order: frames }, required: ["order"] },
  },
  {
    name: "ask_user",
    description:
      "Ask instead of guessing: when the media and the script don't fit (fewer files than units, a file whose place is unclear), when her request has several right answers, or when it would cost a long render on a guess. One short Hebrew question, 2–4 options she can press. Ends this run; her pick comes back as her next message.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "object", properties: { label: { type: "string" }, action: { type: "string" } }, required: ["label", "action"] },
        },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "finish",
    description: "End the run. reply = one or two short Hebrew lines (plural, אתם) saying what ACTUALLY happened per the tool results — and plainly what didn't.",
    input_schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
  },
]
