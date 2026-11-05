import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import { referenceBlocks } from "@/lib/ai-edit-references"
import { loadImageForModels } from "@/lib/visual-language/image-input"

/** The image formats "עריכה עם AI" edits as pictures (/api/media/ai-edit). */
export type EditableFormat = "carousel" | "story" | "image_post"

/** Formats the planner reads: the image formats, and the b-roll's background picture. */
export type PlanFormat = EditableFormat | "b_roll"

const NOUN: Record<PlanFormat, string> = {
  carousel: "carousel slide",
  image_post: "single image post",
  story: "Instagram story frame",
  b_roll:
    "animated b-roll reel — ONE still background picture with animated Hebrew text laid over it in code (the text, its colours, sizes and motion are not part of the picture)",
}

/** Opus: which items, and the exact edit to make. */
export async function planImageEdit(
  apiKey: string,
  format: PlanFormat,
  count: number,
  instruction: string,
  refs: string[] = [],
  /** She asked for her visual language: its current lines, to spell out in the brief. */
  language: string[] = [],
  /**
   * Hani only (lib/feature-access): a change to a picture inside the design
   * is described as a change to the picture itself — never a crop or cover.
   */
  pictureEdits = false,
): Promise<{ targets: number[]; edit: string; place: number[]; needsImage: boolean; picture: boolean }> {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1500,
    system:
      "You turn a Hebrew-speaking creator's edit request for her designed social media images into an exact brief for an image-editing model. Reply with JSON only.",
    messages: [
      {
        role: "user",
        content: [
          ...referenceBlocks(refs, { placeable: true }),
          { type: "text", text: [
          `Format: ${NOUN[format]}${count > 1 ? `, a set of ${count} (numbered 1..${count} in order)` : ""}.`,
          `Her request (Hebrew): ${JSON.stringify(instruction)}`,
          "",
          `Return {"targets": [numbers] , "edit": "..."${refs.length ? ', "place": [numbers]' : ""}, "needs_image": true|false${format === "b_roll" ? ', "picture": true|false' : ""}}.`,
          ...(format === "b_roll"
            ? [
                '- picture: true when the request changes the background PICTURE itself — a person, object, place or scene in it, or replacing it with her picture. false when it is only about the animated text (wording, colour, size, position, timing, how words enter). For picture=true, "edit" describes the change to the picture only.',
              ]
            : []),
          `- targets: which items the request is about. If she names items (e.g. "שקופית 2", "הפריים האחרון", "הראשונה") use those; if it's about the look in general or doesn't say, all of 1..${count}.`,
          "- edit: one precise English instruction for an image-editing model describing ONLY the change she asked for (colours, sizes, positions, elements, mood…). If she asks to change wording, quote the new Hebrew text exactly. If she asks to remove an illustration's or picture's background, say: keep the subject exactly as it is, and replace its backdrop (box, colour, glow, shadow) with the design's own background continuing seamlessly around it. Do not invent changes she didn't ask for." +
            (refs.length
              ? ' The image editor will NOT see her reference images, so spell out in words exactly what to take from them. Images she wants PLACED are different: the editor receives those files themselves, as "input image 2", "input image 3"… in the order you list them in "place" — so say where and how big to place each one, and that it is reproduced exactly as it is (same character / photo / logo, never redrawn).'
              : ""),
          ...(language.length
            ? [
                "",
                "She asks to apply HER VISUAL LANGUAGE. The image editor cannot see it, so the edit must restyle the whole design into it, spelled out concretely: background treatment, palette (with hex codes), type styling (weight, colour, emphasis), graphic devices and decoration — and say to remove whatever of the current look the language doesn't have. Keep every piece of Hebrew text exactly, and keep any photo of a person and her logo. Her current visual language:",
                ...language,
              ]
            : []),
          '- needs_image: true when she asks to put in, swap in or use a SPECIFIC picture (her photo, her character, "this image", a picture from her carousel or elsewhere) and that picture is not one of the attached images' + (refs.length ? " you list in place" : " (none is attached)") + ". Then nothing is edited and she is asked for it — never describe a stand-in picture. Otherwise false.",
          "- The edit never brings in a person, character, animal or object she did not ask for.",
          ...(pictureEdits
            ? [
                "- If she asks to change a PICTURE inside the design (her photo, a placed picture or an illustration) — remove text, a caption, a logo or an object from it, clean it, extend it, blend it in, recolour it to fit — the edit changes that picture itself: say exactly what to remove or change and that what was behind it is rebuilt naturally. Never crop, zoom, cover, shrink or hide part of the picture instead, and keep the person or subject exactly who and what they are.",
              ]
            : []),
          ...(refs.length
            ? ['- place: the numbers of the attached images she wants put INTO the design as they are (her own picture, character, logo, product). Empty for images that only show a look to match.']
            : []),
        ].join("\n") },
        ],
      },
    ],
  })
  const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
    targets?: number[]
    edit?: string
    place?: number[]
    needs_image?: boolean
    picture?: boolean
  }
  const targets = (json.targets ?? [])
    .map((n) => Math.round(n))
    .filter((n) => n >= 1 && n <= count)
  return {
    targets: targets.length ? Array.from(new Set(targets)) : Array.from({ length: count }, (_, i) => i + 1),
    edit: (json.edit ?? "").trim() || instruction,
    place: Array.from(
      new Set((json.place ?? []).map((n) => Math.round(n)).filter((n) => n >= 1 && n <= refs.length)),
    ),
    needsImage: json.needs_image === true,
    picture: json.picture === true,
  }
}

export const IMAGE_MISSING = {
  error: "image_missing",
  message:
    "לא קיבלתי את התמונה שביקשתם לשים, אז לא שיניתי כלום ולא המצאתי תמונה אחרת. צרפו אותה כאן בהודעה (כפתור התמונה ליד השליחה) ונסו שוב.",
}
export const PLACE_FAILED = {
  error: "place_failed",
  message: "לא הצלחתי לשים את התמונה ששלחתם הפעם, אז השארתי את המדיה כמו שהייתה. נסו שוב, ואפשר לכתוב איפה בדיוק לשים אותה.",
}

/**
 * Share of the image that visibly changed (0..1): both scaled to a coarse
 * grid, a cell counts when its brightness moved by more than ~10%. An
 * editor that "placed" nothing comes back under 0.5%; a placed picture is
 * well over 10% (measured on her image post, 2026-11-05).
 */
export async function changedArea(beforeUrl: string, afterBase64: string): Promise<number> {
  const grid = async (input: Buffer) =>
    sharp(input).greyscale().resize(54, 68, { fit: "fill" }).raw().toBuffer()
  const before = await loadImageForModels(beforeUrl)
  const [a, b] = await Promise.all([grid(Buffer.from(before.base64, "base64")), grid(Buffer.from(afterBase64, "base64"))])
  let moved = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) moved++
  return moved / a.length
}

export function editPrompt(edit: string, placing: number, restyle = false, brandRefs = 0): string {
  if (restyle) {
    return [
      "Restyle this design into the creator's visual language. Apply the following:",
      edit,
      ...(brandRefs
        ? [
            "",
            `The other input image${brandRefs > 1 ? "s are" : " is"} the creator's brand references (her graphic elements and finished posts in her style): match their look. Never copy their text, photos or subject.`,
          ]
        : []),
      "",
      "Keep exactly: every piece of Hebrew text (same words, same spelling, right-to-left, same reading order) and any photo of a person or logo. Everything of the previous look that the visual language doesn't have goes. Do not add new text. Nothing may touch or cross the image edge.",
    ].join("\n")
  }
  return [
    placing
      ? `Edit the FIRST input image. The other input image${placing > 1 ? "s are the creator's own pictures" : " is the creator's own picture"} to place into it — reproduce ${placing > 1 ? "each one" : "it"} exactly as it is (the same character, photo or logo: same shape, colours, details and proportions; never redraw, restyle or replace it). Apply ONLY the following change:`
      : "Edit this image. Apply ONLY the following change:",
    edit,
    "",
    "Keep everything else exactly as it is: the layout, every piece of Hebrew text (same words, same spelling, right-to-left), the fonts, colours, illustrations and any logo. Do not add new text, and no person, character, animal or object the change above doesn't name. Nothing may touch or cross the image edge.",
  ].join("\n")
}
