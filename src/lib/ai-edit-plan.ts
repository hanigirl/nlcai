import Anthropic from "@anthropic-ai/sdk"
import { referenceBlocks } from "@/lib/ai-edit-references"

/** The image formats "עריכה עם AI" edits as pictures (/api/media/ai-edit). */
export type EditableFormat = "carousel" | "story" | "image_post"

const NOUN: Record<EditableFormat, string> = {
  carousel: "carousel slide",
  image_post: "single image post",
  story: "Instagram story frame",
}

/** Opus: which items, and the exact edit to make. */
export async function planImageEdit(
  apiKey: string,
  format: EditableFormat,
  count: number,
  instruction: string,
  refs: string[] = [],
  /** She asked for her visual language: its current lines, to spell out in the brief. */
  language: string[] = [],
): Promise<{ targets: number[]; edit: string; place: number[]; needsImage: boolean }> {
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
          `Return {"targets": [numbers] , "edit": "..."${refs.length ? ', "place": [numbers]' : ""}, "needs_image": true|false}.`,
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
  }
}

