import { NextRequest, NextResponse } from "next/server"
import { CLAUDE_KEY_INVALID_MESSAGE, isInvalidClaudeKey } from "@/lib/claude-credits"
import { Resvg } from "@resvg/resvg-js"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { getUserApiKey } from "@/lib/api-keys"
import { CutoutFailedError, cutoutImage, editImage, generateImage, type ImageShape } from "@/lib/openai-image"
import sharp from "sharp"
import { loadImageForModels, normaliseImage } from "@/lib/visual-language/image-input"
import { replaceImageAssetSet } from "@/lib/media-asset-set"
import { applyFixedElements } from "@/lib/visual-language/fixed-elements"
import { resolveDesignDirection } from "@/lib/visual-language/direction"
import {
  carouselStillMatches,
  illustrationPrompt,
  loadCarousel,
  renderCarousel,
  reviseCarousel,
  saveCarousel,
  slideHash,
  uploadIllustration,
  measureArtSlots,
} from "@/lib/carousel-composition"
import { isOwnMediaUrl } from "@/lib/own-media"
import { parseReferences, referenceBuffer, resolveReferences } from "@/lib/ai-edit-references"
import {
  changedArea,
  editPrompt,
  IMAGE_MISSING,
  PLACE_FAILED,
  planImageEdit as plan,
  type EditableFormat,
} from "@/lib/ai-edit-plan"
import { currentCarouselBrief } from "@/lib/carousel-brief"
import { wantsOwnLanguage } from "@/lib/visual-language/current-brief"
import { canEditPictures } from "@/lib/feature-access"
import { isVideoSlide } from "@/lib/carousel-video"
import { PICTURE_MISSING, adaptPictureForSlide, editPicture, wantsPictureAsIs } from "@/lib/picture-edit"
import type { ModelImage } from "@/lib/visual-language/image-input"

/**
 * The edit ran and the slides came out exactly as they were: nothing is
 * saved, and the chat says so instead of "עדכנתי" (Hani, 2026-11-05).
 */
const UNCHANGED_MESSAGE =
  "הבקשה לא שינתה כלום בשקופיות, אז השארתי אותן כמו שהיו. נסו לכתוב מה בדיוק לשנות, למשל צבע הרקע, מיקום הכותרת או גודל התמונה."

// Planning + up to 10 parallel image edits (30–120s each).
export const maxDuration = 300

/**
 * "עריכה עם AI" for the image formats — carousel, story, image post (Hani,
 * 2026-10-22, the same move as the b-roll's). Her instruction, in her words,
 * applied to the media that is already on the post:
 *
 *   1. Claude Opus reads the instruction against the set (N slides / frames)
 *      and decides which ones it touches ("שקופית 3", "בכל השקופיות", or by
 *      default all of them) and writes a precise English edit brief.
 *   2. gpt-image-2 edits each targeted image from the image itself — never a
 *      regeneration from scratch, so her design survives.
 *   3. The set is saved back in order (untouched slides keep their URLs).
 *
 * POST { postId, format, instruction } → { urls, edited: number[] }
 */

const SHAPE: Record<EditableFormat, ImageShape> = {
  carousel: "4:5",
  image_post: "4:5",
  story: "9:16",
}
const CANVAS: Record<EditableFormat, [number, number]> = {
  carousel: [1080, 1350],
  image_post: [1080, 1350],
  story: [1080, 1920],
}

function isEditableFormat(v: unknown): v is EditableFormat {
  return v === "carousel" || v === "story" || v === "image_post"
}

function toCanvas(base64: string, [w, h]: [number, number]): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href="data:image/png;base64,${base64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` +
    `</svg>`
  return Buffer.from(new Resvg(svg).render().asPng()).toString("base64")
}

export async function POST(req: NextRequest) {
  try {
    const { postId, format, instruction, references, earlierReferences, placeAt: rawPlaceAt, element: rawElement } = (await req.json().catch(() => ({}))) as {
      postId?: string
      format?: unknown
      instruction?: string
      /** Screenshots she attached (lib/ai-edit-references). */
      references?: unknown
      /**
       * The images of her last message that had some, when this one has none
       * — "שימי את התמונה!" after a try that missed refers to them.
       */
      earlierReferences?: unknown
      /**
       * Carousel: per reference (same order), the slide (0-based) she put it
       * on in the AI panel's slide slots, or -1 — Hani, 2026-11-06.
       */
      placeAt?: unknown
      /**
       * Carousel: attached image `ref` (0-based) is an ELEMENT on every slide
       * — her profile picture on a card, her logo (Hani, 2026-11-07: "לשים
       * בכל השקופיות"); `handle` / `name` for the card when she gave them.
       */
      element?: { kind?: unknown; ref?: unknown; handle?: unknown; name?: unknown }
    }
    const text = instruction?.trim()
    if (!postId || !text || !isEditableFormat(format)) {
      return NextResponse.json({ error: "postId, format and instruction are required" }, { status: 400 })
    }

    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: post } = await supabase
      .from("core_posts")
      .select("id")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })
    // Slide slots send her pictures as storage URLs, one per slide, up to a
    // carousel's maximum (lib/ai-edit-references); otherwise data URLs, max 3.
    const slotsSent = Array.isArray(rawPlaceAt) && rawPlaceAt.some((n) => Number.isInteger(n) && n >= 0)
    const current = slotsSent ? await resolveReferences(references, user.id) : parseReferences(references)
    if (slotsSent && Array.isArray(references) && current.length !== references.length) {
      return NextResponse.json(
        { error: "slot_picture_unreadable", message: "לא הצלחתי לקרוא את אחת התמונות שבחרתם לשקופיות, אז לא שיניתי כלום. נסו לצרף אותה שוב." },
        { status: 422 },
      )
    }
    const refs = current.length ? current : parseReferences(earlierReferences)
    // What the models read: says where the images came from when they weren't attached now.
    // Her slide slots: which attached image goes on which slide, exactly.
    const slotted =
      Array.isArray(rawPlaceAt) && rawPlaceAt.length === current.length
        ? rawPlaceAt.flatMap((n, j) => (Number.isInteger(n) && n >= 0 ? [{ j, i: n as number }] : []))
        : []
    const slotNote = slotted.length
      ? `\nShe chose exactly where her pictures go: ${slotted.map(({ j, i }) => `attached image ${j + 1} on slide ${i + 1}`).join(", ")}. Place each one on exactly that slide (in "attached") and no other; slides she didn't choose keep what they have unless she asks otherwise.`
      : ""
    const ask0 =
      text && !current.length && refs.length
        ? `${text}\n(The attached image${refs.length > 1 ? "s" : ""} came with her earlier message in this chat.)`
        : text
    const ask = ask0 ? `${ask0}${slotNote}` : ask0

    const { data: variant } = await supabase
      .from("format_variants")
      .select("id")
      .eq("core_post_id", postId)
      .eq("format", format)
      .maybeSingle()
    const { data: assets } = variant
      ? await supabase
          .from("media_assets")
          .select("url")
          .eq("format_variant_id", (variant as { id: string }).id)
          .in("asset_type", format === "carousel" ? ["image", "video"] : ["image"])
          .order("created_at", { ascending: true })
      : { data: [] }
    const urls = ((assets ?? []) as { url: string | null }[])
      .map((a) => a.url)
      .filter((u): u is string => !!u && /^https?:\/\//.test(u))
    if (urls.length === 0) {
      // A carousel was laid out for this post but its slides never reached
      // the post (the save of a heavy set was rejected before 2026-11-05):
      // what the card shows isn't stored. Say exactly that.
      const unsaved = format === "carousel" && !!(await loadCarousel(supabase, user.id, postId))
      return NextResponse.json(
        {
          error: "no_media",
          message: unsaved
            ? "השקופיות שמופיעות בכרטיס לא נשמרו בפוסט, אז אין לי מה לערוך. צרו את הקרוסלה שוב (עכשיו היא נשמרת מיד), ואז ערכו אותה."
            : "אין כאן תמונות שמורות לערוך. צרו או העלו מדיה ואז ערכו אותה.",
        },
        { status: 400 },
      )
    }

    // Her own photos / videos are never repainted (Hani, 2026-10-29) — the
    // panel sends those to /api/media/own-edit, which only adds or removes.
    if (format !== "carousel" && urls.some(isOwnMediaUrl)) {
      return NextResponse.json(
        { error: "own_media", message: "זו מדיה שלכם, ואת מה שצילמתם אני לא משנה. אפשר לשנות את הכיתוב או להוסיף שקופית." },
        { status: 400 },
      )
    }

    let openaiKey: string
    let anthropicKey: string
    try {
      ;[openaiKey, anthropicKey] = await Promise.all([
        getUserApiKey(supabase, "openai_api_key"),
        getUserApiKey(supabase, "anthropic_api_key"),
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const message =
        msg === "openai_not_connected"
          ? "כדי לערוך עם AI צריך לחבר מפתח OpenAI בהגדרות."
          : msg === "anthropic_not_connected"
            ? "כדי לערוך עם AI צריך לחבר מפתח Claude בהגדרות."
            : undefined
      if (message) return NextResponse.json({ error: msg, message }, { status: 400 })
      throw e
    }

    // A carousel laid out in code is edited in its layout — exact and
    // obedient — and only the illustrations she asks about are redrawn. Only
    // while the post still holds exactly the slides that layout made; if she
    // changed any of them, the real images are edited instead.
    const ownLanguage = wantsOwnLanguage(text)
    const saved0 = format === "carousel" ? await loadCarousel(supabase, user.id, postId) : null
    if (saved0 && (await carouselStillMatches(saved0, urls))) {
      // Edited from her CURRENT language, never the snapshot the carousel was
      // made in (that kept the old look under the new brand elements). When
      // the language changed since, or she asks for it, the whole carousel
      // is rebuilt in it.
      const current = await currentCarouselBrief(supabase, user.id, saved0.brief, { ownLanguage })
      const restyle = current.changed || ownLanguage
      const stored = { ...saved0, brief: current.brief }
      // A change to a picture itself is a real picture edit — Hani only for now (lib/feature-access).
      const pictureEditsOn = canEditPictures(user.email)
      // An element on every slide: said plainly to the layout, then enforced.
      const element =
        rawElement && Number.isInteger(rawElement.ref) && (rawElement.ref as number) >= 0 && (rawElement.ref as number) < refs.length
          ? {
              kind: rawElement.kind === "logo" ? "logo" : rawElement.kind === "avatar" ? "avatar" : "element",
              ref: rawElement.ref as number,
              handle: typeof rawElement.handle === "string" ? rawElement.handle.replace(/^@/, "").slice(0, 40) : "",
              name: typeof rawElement.name === "string" ? rawElement.name.slice(0, 60) : "",
            }
          : null
      const elementNote = element
        ? [
            "",
            element.kind === "avatar"
              ? `Attached image ${element.ref + 1} is HER PROFILE PICTURE. Put it on EVERY slide as the author's avatar — where the design shows an avatar or an empty avatar placeholder (in a post/tweet card: beside the name), or else small in a consistent corner: <img class="art avatar" src="__SLIDE_IMAGE_N__"> (N = the slide number), a circle, object-fit: cover.`
              : element.kind === "logo"
                ? `Attached image ${element.ref + 1} is HER LOGO. Put it on EVERY slide, small, in the same position on each: <img class="art logo" src="__SLIDE_IMAGE_N__"> (N = the slide number), object-fit: contain.`
                : `Attached image ${element.ref + 1} is an element she wants on EVERY slide, in the same position on each: <img class="art" src="__SLIDE_IMAGE_N__"> (N = the slide number), object-fit: contain.`,
            `List it in "attached" for every slide (the number ${element.ref + 1} on each). It replaces nothing else on the slide.`,
            element.handle ? `Her handle on the card: @${element.handle}.` : "",
            element.name ? `Her display name on the card: ${element.name}.` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : ""
      const revised = await reviseCarousel(anthropicKey, stored, `${ask!}${elementNote}`, refs, restyle, pictureEditsOn)
      if (element) {
        const count = stored.brief.slides.length
        const on = Array.from({ length: count }, (_, i) => i).filter((i) => revised.html.includes(`__SLIDE_IMAGE_${i + 1}__`))
        if (!on.length) {
          return NextResponse.json(
            { error: "element_missed", message: "לא הצלחתי לשים את התמונה בשקופיות, אז לא שיניתי כלום. נסו שוב." },
            { status: 422 },
          )
        }
        revised.attached = Array.from({ length: count }, (_, i) => (on.includes(i) ? element.ref + 1 : (revised.attached[i] ?? 0)))
      }
      // Her slots, enforced (the layout may still have put a picture elsewhere).
      if (slotted.length) {
        const count = stored.brief.slides.length
        const forced = slotted.every(({ i }) => i < count && revised.html.includes(`__SLIDE_IMAGE_${i + 1}__`))
        if (!forced) {
          return NextResponse.json(
            { error: "slot_missed", message: "לא הצלחתי לשים את התמונה בדיוק בשקופית שבחרתם, אז לא שיניתי כלום. נסו שוב, או בחרו שקופית אחרת." },
            { status: 422 },
          )
        }
        const mine = new Set(slotted.map((x) => x.j + 1))
        const attached = Array.from({ length: count }, (_, i) => (mine.has(revised.attached[i] ?? 0) ? 0 : (revised.attached[i] ?? 0)))
        for (const { j, i } of slotted) attached[i] = j + 1
        revised.attached = attached
      }
      const pictureEdits = pictureEditsOn ? revised.pictureEdits : []
      const isPictureEdit = (i: number) => pictureEdits.some((e) => e.slide === i)
      // She named a picture we don't have: ask for it — never a stand-in.
      if (revised.needsImage) return NextResponse.json(IMAGE_MISSING, { status: 400 })
      const illustrations = [...stored.illustrations]
      const ownArt = stored.illustrations.map((_, i) => stored.ownArt?.[i] ?? false)
      const cutouts = new Set(revised.cutouts)
      // Her attached image placed on a slide is HER FILE, uploaded as that
      // slide's illustration — never a prompt for a redraw (Hani, 2026-11-05:
      // "לשלב את התמונה הזו בקאבר" came back as a look-alike character).
      const placed = revised.attached
        .map((n, i) => ({ ref: refs[n - 1], i }))
        .filter((x): x is { ref: string; i: number } => !!x.ref)
      const isPlaced = (i: number) => placed.some((p) => p.i === i)
      const redraw = revised.illustrations
        .map((idea, i) => ({ idea: idea.trim(), i }))
        // Her own picture is never redrawn, not even by a restyle.
        .filter((x) => x.idea && !isPlaced(x.i) && !isPictureEdit(x.i) && !(restyle && ownArt[x.i]))
      // "Remove the background" cuts the EXISTING illustration out (same
      // character, real transparency) — a redraw would paint a new opaque
      // square. A slide whose picture is also being redrawn gets the new one
      // generated straight onto a transparent background instead.
      const cutOnly = [...cutouts].filter(
        (i) => illustrations[i] && !isPlaced(i) && !isPictureEdit(i) && !redraw.some((r) => r.i === i),
      )
      // Her picture is ADAPTED to its slide through the image model before it
      // goes in (Hani, Nataliya — lib/feature-access): re-framed to the slot,
      // graded into her language, calm under the title. Her exact file only
      // when she says "כמו שהיא" — or when its background is cut out (the
      // subject alone on the slide).
      // An element (profile picture, logo) goes in as her file — never re-framed into an illustration slot.
      const adapt = pictureEditsOn && !wantsPictureAsIs(text) && !element
      const adaptOn = placed.filter(({ i }) => adapt && !cutouts.has(i))
      const slots = adaptOn.length
        ? await measureArtSlots(
            revised.html,
            await Promise.all(
              stored.brief.slides.map(async (_, i) => {
                const p = adaptOn.find((x) => x.i === i)
                if (!p) return null
                const m = await sharp(referenceBuffer(p.ref)).rotate().metadata()
                return (m.width ?? 1) / Math.max(1, m.height ?? 1)
              }),
            ),
            stored.brief.fonts,
          )
        : []
      const adaptMisses: string[] = []
      await Promise.all([
        ...placed.map(async ({ ref, i }) => {
          const file = referenceBuffer(ref)
          const slot = slots[i]
          let png: Buffer
          if (adaptOn.some((x) => x.i === i) && slot) {
            const out = await adaptPictureForSlide(openaiKey, anthropicKey, file, slot, stored.brief.styleLines, i + 1)
            if (!out.ok) {
              adaptMisses.push(out.message)
              return
            }
            png = out.png
          } else if (cutouts.has(i) && !isPictureEdit(i)) {
            // A picture edit on this slide cuts out after the edit (below).
            png = Buffer.from(await cutoutImage(openaiKey, await normaliseImage(file)), "base64")
          } else {
            png = await sharp(file).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer()
          }
          illustrations[i] = await uploadIllustration(supabase, user.id, png)
          ownArt[i] = true
        }),
        ...redraw.map(async ({ idea, i }) => {
          const cutout = cutouts.has(i)
          const raw = await generateImage(
            openaiKey,
            illustrationPrompt(idea, stored.brief.slides[i], stored.brief.styleLines, cutout),
            { shape: "1:1", quality: "medium", ...(cutout ? { background: "transparent" as const } : {}) },
          )
          illustrations[i] = await uploadIllustration(supabase, user.id, Buffer.from(raw, "base64"))
          ownArt[i] = false
        }),
        ...cutOnly.map(async (i) => {
          const raw = await cutoutImage(openaiKey, await loadImageForModels(illustrations[i]))
          illustrations[i] = await uploadIllustration(supabase, user.id, Buffer.from(raw, "base64"))
        }),
      ])
      // Her picture didn't come out as hers: nothing is saved — never her raw file cropped in instead.
      if (adaptMisses.length) {
        return NextResponse.json({ error: "picture_adapt_failed", message: adaptMisses[0] }, { status: 422 })
      }
      // The picture itself changes (Hani, 2026-11-05): through the image
      // model, then back on its slide — never a crop that hides the problem.
      // Any miss saves nothing and says so.
      if (pictureEdits.length) {
        const claudeKey = anthropicKey
        const outcomes = await Promise.all(
          pictureEdits.map(async ({ slide: i, edit }) => {
            if (!illustrations[i]) return { ok: false as const, message: PICTURE_MISSING }
            const res = await fetch(illustrations[i])
            if (!res.ok) return { ok: false as const, message: PICTURE_MISSING }
            const out = await editPicture(openaiKey, claudeKey, Buffer.from(await res.arrayBuffer()), edit)
            if (!out.ok) return out
            const png = cutouts.has(i)
              ? Buffer.from(await cutoutImage(openaiKey, await normaliseImage(out.png)), "base64")
              : out.png
            illustrations[i] = await uploadIllustration(supabase, user.id, png)
            // Still her picture — kept through later restyles, never redrawn.
            ownArt[i] = ownArt[i] || isPlaced(i)
            return { ok: true as const }
          }),
        )
        const miss = outcomes.find((o) => !o.ok)
        if (miss && !miss.ok) return NextResponse.json({ error: "picture_edit_failed", message: miss.message }, { status: 422 })
      }
      const direction = current.direction
      const shots = await renderCarousel(revised.html, illustrations, stored.brief.fonts)
      const nextSet = await Promise.all(
        shots.map((shot, i) =>
          applyFixedElements(
            shot.toString("base64"),
            direction.fixed,
            stored.brief.slides[i].type === "cover" ? "cover" : stored.brief.slides[i].type === "cta" ? "closing" : "content",
          ),
        ),
      )
      const hashes = nextSet.map((b64) => slideHash(Buffer.from(b64, "base64")))
      // Same pixels as before: say so, and save nothing.
      if (saved0.slideHashes?.length === hashes.length && hashes.every((h, i) => h === saved0.slideHashes![i])) {
        return NextResponse.json({ urls, edited: [], unchanged: true, message: UNCHANGED_MESSAGE })
      }
      const saved = await replaceImageAssetSet(supabase, user.id, postId, format, nextSet)
      if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })
      await saveCarousel(supabase, user.id, postId, {
        html: revised.html,
        // The brief it now matches — her current language.
        brief: stored.brief,
        illustrations,
        edits: [...stored.edits, text],
        slideHashes: hashes,
        ownArt,
      })
      const { data: after } = await supabase
        .from("media_assets")
        .select("url")
        .eq("format_variant_id", (variant as unknown as { id: string }).id)
        .in("asset_type", format === "carousel" ? ["image", "video"] : ["image"])
        .order("created_at", { ascending: true })
      return NextResponse.json({
        urls: ((after ?? []) as { url: string }[]).map((a) => a.url),
        edited: shots.map((_, i) => i + 1),
      })
    }
    // "Apply my visual language" on images we edit as pictures: the planner
    // gets her CURRENT language to spell out, and the image model her brand
    // references — without them it only ever saw the old design.
    const language = ownLanguage ? await resolveDesignDirection(supabase, user.id, { format }) : null
    const { targets: planned, edit, place, needsImage } = await plan(anthropicKey, format, urls.length, ask!, refs, language?.lines ?? [], canEditPictures(user.email))
    // She asked for a specific picture that isn't here: say so, edit nothing.
    // Sending the editor words instead is how an astronaut came back (Hani, 2026-11-05).
    if (needsImage) return NextResponse.json(IMAGE_MISSING, { status: 400 })
    // A carousel's VIDEO slides are never repainted by the picture editor —
    // they stay exactly as they are, in their place (2026-11-06).
    const targets = planned.filter((n) => !isVideoSlide(urls[n - 1]))
    if (!targets.length) {
      return NextResponse.json(
        {
          error: "video_slide",
          message: "השקופית הזאת היא סרטון, ועורך התמונות לא משנה סרטונים. אפשר לבקש שינוי בשקופיות התמונה.",
        },
        { status: 400 },
      )
    }
    // Pictures she asked to place go to the image model as files, not words.
    const placeImages = await Promise.all(place.map((n) => normaliseImage(referenceBuffer(refs[n - 1]))))
    // Her placed pictures first (the prompt numbers them), then up to two brand references.
    const brandRefs: ModelImage[] = language && !placeImages.length ? language.references.slice(0, 2) : []
    const prompt = editPrompt(edit, place.length, !!language, brandRefs.length)

    const next = [...urls]
    await Promise.all(
      targets.map(async (n) => {
        const source = await loadImageForModels(urls[n - 1])
        const out = await editImage(openaiKey, prompt, source, SHAPE[format], [...placeImages, ...brandRefs])
        next[n - 1] = toCanvas(out, CANVAS[format])
      }),
    )

    // Placing her picture or restyling changes a real area of the image. If
    // none of the edited images visibly changed, it didn't happen: save
    // nothing and say so — never "עדכנתי".
    if (place.length || language) {
      const changed = await Promise.all(targets.map((n) => changedArea(urls[n - 1], next[n - 1])))
      if (Math.max(...changed) < (place.length ? 0.03 : 0.05)) {
        return NextResponse.json(place.length ? PLACE_FAILED : { urls, edited: [], unchanged: true, message: UNCHANGED_MESSAGE })
      }
    }
    const saved = await replaceImageAssetSet(supabase, user.id, postId, format, next)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })

    // Read back the stored URLs in order — the edited ones are new files.
    const { data: after } = await supabase
      .from("media_assets")
      .select("url")
      .eq("format_variant_id", (variant as unknown as { id: string }).id)
      .in("asset_type", format === "carousel" ? ["image", "video"] : ["image"])
      .order("created_at", { ascending: true })
    return NextResponse.json({
      urls: ((after ?? []) as { url: string }[]).map((a) => a.url),
      edited: targets,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[media/ai-edit]", msg)
    if (error instanceof CutoutFailedError) {
      // Nothing was saved — the carousel stays exactly as it was.
      return NextResponse.json(
        { error: "cutout_failed", message: "לא הצלחתי להוריד את הרקע מהאיור הפעם, והקרוסלה נשארה כמו שהייתה. נסו שוב." },
        { status: 502 },
      )
    }
    if (isInvalidClaudeKey(msg)) {
      return NextResponse.json({ error: "anthropic_key_invalid", message: CLAUDE_KEY_INVALID_MESSAGE }, { status: 400 })
    }
    return NextResponse.json({ error: msg, message: "העריכה לא הצליחה הפעם. נסו שוב." }, { status: 500 })
  }
}
