import { scriptTextNote } from "@/lib/script-text-note"
import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { createClient } from "@/lib/supabase/server"
import { getUserApiKey } from "@/lib/api-keys"
import { getAuthUser } from "@/lib/auth-user"
import { finalizeHtml, reviseBRoll } from "@/lib/broll-animation/compose"
import { renderComposition } from "@/lib/broll-animation/render"
import { hasOwnBackground, loadComposition, saveBRoll, uploadBackground } from "@/lib/broll-animation/store"
import { currentCompositionBrief } from "@/lib/broll-animation/brief"
import {
  BACKGROUND_FRAMINGS,
  buildBackgroundPrompt,
  cropToCanvas,
  OWN_BACKGROUND_LINE,
  pictureAsBackground,
} from "@/lib/broll-animation/background"
import { editImage, generateImage } from "@/lib/openai-image"
import {
  MOTION_RESTYLE_NOTE,
  MOTION_RESTYLE_NOTE_OWN_PICTURE,
  wantsOwnLanguage,
} from "@/lib/visual-language/current-brief"
import { parseReferences, referenceBuffer } from "@/lib/ai-edit-references"
import { changedArea, editPrompt, IMAGE_MISSING, planImageEdit } from "@/lib/ai-edit-plan"
import { loadImageForModels, normaliseImage } from "@/lib/visual-language/image-input"
import { picturesPlaced } from "@/lib/placed-check"
import { canBlendBRoll } from "@/lib/feature-access"

/**
 * Words that may be about the background PICTURE rather than the text —
 * only then is the request read by the planner (one more model call).
 */
const PICTURE_WORDS = /תמונ|דמות|צילום|אישה|גבר|ילד|ילדה|פרצוף|פנים|רקע|לוגו|חיה|כלב|חתול|אובייקט|מוצר|photo|image|picture|background/i

/** She said to use her picture exactly as it is: "בדיוק כמו שהיא", "אחד לאחד", "בלי לשנות", "as is". */
function wantsAsIs(instruction: string): boolean {
  return /כמו\s*שה(?:יא|וא)|אחד\s*ל\s*-?\s*אחד|1\s*[:/]\s*1|בלי\s*לשנות\s*(?:אותה|אותו|את\s*התמונה)?|כמות\s*שה(?:יא|וא)|as[\s-]is|exactly\s+as/i.test(instruction)
}

/** Her picture worked INTO the existing background, in its look. */
function blendPrompt(edit: string): string {
  return [
    "Edit the FIRST input image (the background of an animated social video — it has no text). The second input image is the creator's own picture. Work its subject INTO this scene:",
    edit,
    "",
    "Blend it into the scene: same lighting, colour grade, palette, grain and style as the first image, so it looks designed together with it. The subject stays recognisably the SAME — the same person (face, hair, features), character, product or logo, with the same details — never a different or re-imagined one.",
    "Keep everything else of the first image as it is. No text, letters or numbers. No person, character, animal or object that isn't in either input. Nothing touches or crosses the image edge.",
  ].join("\n")
}

const BLEND_FAILED = {
  error: "blend_failed",
  message: "לא הצלחתי לשלב את התמונה ששלחתם ברקע הפעם, אז השארתי את הבי-רול כמו שהיה. נסו שוב, ואם תרצו אותה בדיוק כמו שהיא, כתבו ״כמו שהיא״.",
}

const PICTURE_FAILED = {
  error: "picture_failed",
  message: "לא הצלחתי לשנות את התמונה שברקע הפעם, אז השארתי את הבי-רול כמו שהיה. נסו שוב, ואפשר לכתוב בדיוק מה לשנות בה.",
}
const OWN_PICTURE_KEPT = {
  error: "own_picture",
  message: "התמונה שברקע היא שלכם, ואותה אני לא מצייר מחדש. אפשר לשנות את הטקסט והתנועה, או לצרף תמונה אחרת שתחליף אותה.",
}

class KeyMissing extends Error {}

// Rendering the clip alone takes ~250–270s on our functions (175 frames
// screenshotted by a Lambda-sized Chromium; the same render is 10–18s on a
// laptop). Anything before it — reading the request, editing the picture,
// checking it, a new background — pushed past the old 300s cap and the whole
// edit was cut off after the work was done (Hani, 2026-11-05: her blended
// picture was ready at 29s; the render was killed at 300s). The project runs
// on Pro with Fluid compute, where 800s is allowed.
export const maxDuration = 800

/**
 * "עריכה עם AI" on a b-roll (Hani, 2026-10-22): her instruction, in her words,
 * applied by Opus to the composition behind the current clip. The background
 * stays; only the motion design / type / colours change as she asks. The
 * result replaces the clip, and its composition (with the instruction
 * appended to `edits`) is stored so the next edit builds on this one.
 *
 * POST { postId, instruction } → { url }
 */
export async function POST(req: NextRequest) {
  const tmpFiles: string[] = []
  try {
    const { postId, instruction, references, earlierReferences } = (await req.json().catch(() => ({}))) as {
      /** Screenshots she attached (lib/ai-edit-references). */
      references?: unknown
      /** The images of her last message that had some, when this one has none. */
      earlierReferences?: unknown
      postId?: string
      instruction?: string
    }
    const text = instruction?.trim()
    const current0 = parseReferences(references)
    const refs = current0.length ? current0 : parseReferences(earlierReferences)
    let ask =
      text && !current0.length && refs.length
        ? `${text}\n(The attached image${refs.length > 1 ? "s" : ""} came with her earlier message in this chat.)`
        : text
    if (!postId || !text) {
      return NextResponse.json({ error: "postId and instruction are required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // The post must be hers; its current b-roll clip is the one we edit.
    const { data: post } = await supabase
      .from("core_posts")
      .select("id")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    const { data: variant } = await supabase
      .from("format_variants")
      .select("id, body")
      .eq("core_post_id", postId)
      .eq("format", "b_roll")
      .maybeSingle()
    // The script is the text on the clip — the edit brings its words in line.
    ask = `${ask}${scriptTextNote("b_roll", (variant as { body?: string | null } | null)?.body)}`
    const { data: asset } = variant
      ? await supabase
          .from("media_assets")
          .select("url")
          .eq("format_variant_id", (variant as { id: string }).id)
          .eq("asset_type", "video")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null }
    const clipUrl = (asset as { url: string | null } | null)?.url ?? null
    const composition = clipUrl ? await loadComposition(supabase, clipUrl) : null
    if (!composition) {
      return NextResponse.json(
        {
          error: "no_composition",
          message: "אפשר לערוך עם AI רק בי-רול שנוצר במנוע החדש. צרו בי-רול חדש ואז ערכו אותו.",
        },
        { status: 400 },
      )
    }

    let anthropicKey: string
    try {
      anthropicKey = await getUserApiKey(supabase, "anthropic_api_key")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "anthropic_not_connected") {
        return NextResponse.json(
          { error: "anthropic_not_connected", message: "כדי לערוך עם AI צריך לחבר מפתח Claude בהגדרות." },
          { status: 400 },
        )
      }
      throw e
    }

    // What to remember is decided before the edit, by the chat's memory
    // check (POST /api/visual-language/style-memory) — this route only edits.
    // Edited from her CURRENT language — never the snapshot the clip was made
    // in. When that language changed since, or she asks for hers, the look is
    // rebuilt in it, background included (Hani, 2026-11-05).
    const ownLanguage = wantsOwnLanguage(text)
    const current = await currentCompositionBrief(supabase, user.id, composition.brief, { format: "b_roll", ownLanguage })
    const restyle = current.changed || ownLanguage
    let brief = current.brief
    const stamp = crypto.randomUUID()
    let backgroundUrl = composition.backgroundUrl
    let ownBackground = hasOwnBackground(composition)
    let template: string
    const openai = async () => {
      try {
        return await getUserApiKey(supabase, "openai_api_key")
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === "openai_not_connected") throw new KeyMissing()
        throw e
      }
    }

    // The background PICTURE is a still image; the revise step below only
    // rewrites the text animation over it. A request about the picture (put
    // this woman in, change the scene) used to go there anyway: the animation
    // changed, the picture didn't, and the chat said "עדכנתי" (Hani,
    // 2026-11-05). Now it is read first, and the picture is really changed —
    // with her exact file, or not at all.
    const planned =
      refs.length || PICTURE_WORDS.test(text) ? await planImageEdit(anthropicKey, "b_roll", 1, ask!, refs) : null
    if (planned?.needsImage) return NextResponse.json(IMAGE_MISSING, { status: 400 })
    const placed = planned?.place.length ? refs[planned.place[0] - 1] : null
    // Off the blend gate (lib/feature-access): her photo as is, as before.
    // On it: her picture as is only when she says so, or when
    // the background is already her own picture (never repainted). Otherwise
    // it is BLENDED into the existing background — the design already holds
    // her visual language (Hani, 2026-11-05: "שתשתלב בעיצוב שהוא עשה ... לא
    // כמו שהיא אחד לאחד אלא אם ציינתי זאת במפורש").
    if (placed && (!canBlendBRoll(user.email) || wantsAsIs(text) || ownBackground)) {
      backgroundUrl = await uploadBackground(supabase, user.id, stamp, await pictureAsBackground(referenceBuffer(placed)))
      ownBackground = true
      brief = { ...brief, styleSpec: brief.styleSpec.includes(OWN_BACKGROUND_LINE) ? brief.styleSpec : `${brief.styleSpec}\n\n${OWN_BACKGROUND_LINE}` }
      template = await reviseBRoll(
        anthropicKey,
        brief,
        composition.template,
        `${text}\n\n(Done for you: the background is now the creator's own picture. Adjust only the text so it reads well over it.${restyle ? `\n\n${MOTION_RESTYLE_NOTE_OWN_PICTURE}` : ""})`,
      )
    } else if (placed) {
      const her = await normaliseImage(referenceBuffer(placed))
      const source = await loadImageForModels(composition.backgroundUrl)
      const out = await editImage(await openai(), blendPrompt(planned!.edit), source, "9:16", [her])
      const next = cropToCanvas(out)
      // The picture must visibly change AND show her subject — not a
      // look-alike, not nothing. Either way it isn't saved, and she's told.
      if ((await changedArea(composition.backgroundUrl, next)) < 0.03) {
        return NextResponse.json(BLEND_FAILED, { status: 422 })
      }
      if ((await picturesPlaced(anthropicKey, [her], next)) === false) {
        return NextResponse.json(BLEND_FAILED, { status: 422 })
      }
      backgroundUrl = await uploadBackground(supabase, user.id, stamp, Buffer.from(next, "base64"))
      // The scene is still the AI's design (now with her subject in it): a
      // later restyle may redraw it — her subject goes along as before.
      template = restyle
        ? await reviseBRoll(anthropicKey, brief, composition.template, `${text}\n\n${MOTION_RESTYLE_NOTE_OWN_PICTURE}`)
        : composition.template
    } else if (planned?.picture) {
      // Her own picture is never repainted.
      if (ownBackground) return NextResponse.json(OWN_PICTURE_KEPT, { status: 400 })
      const source = await loadImageForModels(composition.backgroundUrl)
      const out = await editImage(await openai(), editPrompt(planned.edit, 0), source, "9:16")
      const next = cropToCanvas(out)
      // Nothing visibly changed in the picture: say so, save nothing.
      if ((await changedArea(composition.backgroundUrl, next)) < 0.03) {
        return NextResponse.json(PICTURE_FAILED, { status: 422 })
      }
      backgroundUrl = await uploadBackground(supabase, user.id, stamp, Buffer.from(next, "base64"))
      template = composition.template
    } else if (restyle) {
      if (ownBackground) {
        // Her picture stays; only the text takes the current language.
        template = await reviseBRoll(anthropicKey, brief, composition.template, `${text}\n\n${MOTION_RESTYLE_NOTE_OWN_PICTURE}`, refs)
      } else {
        const context = [brief.hook, brief.rest].filter(Boolean).join("\n")
        const [raw, revised] = await Promise.all([
          openai().then((key) =>
            generateImage(key, buildBackgroundPrompt(current.direction, BACKGROUND_FRAMINGS[0], context), { shape: "9:16" }),
          ),
          reviseBRoll(anthropicKey, brief, composition.template, `${text}\n\n${MOTION_RESTYLE_NOTE}`, refs),
        ])
        backgroundUrl = await uploadBackground(supabase, user.id, stamp, Buffer.from(cropToCanvas(raw), "base64"))
        template = revised
      }
    } else {
      template = await reviseBRoll(anthropicKey, brief, composition.template, text, refs)
      // Opus handed back the same composition: nothing to render or save.
      if (template.trim() === composition.template.trim()) {
        return NextResponse.json({
          url: clipUrl,
          unchanged: true,
          message: "הבקשה לא שינתה כלום בבי-רול, אז השארתי אותו כמו שהיה. נסו לכתוב מה בדיוק לשנות, למשל גודל הכותרת, הצבע או איך המילים נכנסות.",
        })
      }
    }

    const os = await import("os")
    const fs = await import("fs/promises")
    const path = await import("path")
    const outPath = path.join(os.tmpdir(), `broll-edit-${stamp}.mp4`)
    tmpFiles.push(outPath)
    await renderComposition(
      finalizeHtml(template, backgroundUrl, brief.fonts),
      outPath,
    )
    const clip = await fs.readFile(outPath)

    const url = await saveBRoll(supabase, user.id, postId, stamp, clip, {
      ...composition,
      // The brief and background it now matches — her current language.
      brief,
      backgroundUrl,
      template,
      edits: [...composition.edits, text],
      ...(ownBackground ? { ownBackground: true } : {}),
    })
    return NextResponse.json({ url })
  } catch (error) {
    if (error instanceof KeyMissing) {
      return NextResponse.json(
        { error: "openai_not_connected", message: "כדי לשנות את התמונה בבי-רול צריך לחבר מפתח OpenAI בהגדרות." },
        { status: 400 },
      )
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[b-roll/edit]", msg)
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    const message =
      msg === "composition_invalid" || msg === "composition_not_seekable"
        ? "העריכה לא הצליחה הפעם. נסו שוב, אולי בניסוח אחר."
        : undefined
    return NextResponse.json({ error: msg, message }, { status: 500 })
  } finally {
    const fs = await import("fs/promises")
    await Promise.all(tmpFiles.map((f) => fs.unlink(f).catch(() => undefined)))
  }
}
