import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"

interface FormatVariantRow {
  format: string
  body: string
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Replace the FULL set of image assets for a multi-image format
 * (carousel, story). Each base64 PNG becomes one `media_assets` image row
 * under the format's variant. These formats are versioned as a GROUP — we
 * wipe the existing images and insert the new set, so partial replacement
 * never leaves stale frames.
 *
 *   - `images === null | []` clears the set (the UI's "delete" path).
 *   - The variant row is auto-created when missing (mirrors the /media
 *     endpoint), but only when there is actually a set to insert.
 *
 * Returns a discriminated result. A failed/So-called-silent wipe (RLS
 * mismatches match zero rows instead of erroring — this bit us on
 * 2026-07-09 with ~100 stale carousel slides) is surfaced as an error so
 * the caller can return a 500 instead of silently duplicating assets.
 * `changed` is false only when there was no variant and nothing to insert.
 */
async function replaceImageAssetSet(
  supabase: ServerSupabase,
  userId: string,
  postId: string,
  format: string,
  images: string[] | null | undefined,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  let { data: variant } = await supabase
    .from("format_variants")
    .select("id")
    .eq("core_post_id", postId)
    .eq("format", format)
    .single()

  if (!variant && Array.isArray(images) && images.length > 0) {
    const { data: newVariant } = await supabase
      .from("format_variants")
      .insert({ core_post_id: postId, format, body: "" } as never)
      .select("id")
      .single()
    variant = newVariant
  }

  // No variant and nothing to insert — nothing to clear either.
  if (!variant) return { ok: true, changed: false }

  const variantRow = variant as unknown as { id: string }

  // Drop existing image assets — the set is replaced as a whole.
  const { error: wipeErr } = await supabase
    .from("media_assets")
    .delete()
    .eq("format_variant_id", variantRow.id)
    .eq("asset_type", "image")
  if (wipeErr) {
    return { ok: false, error: `${format}_wipe_failed: ${wipeErr.message}` }
  }

  // RLS mismatches don't error — they silently match zero rows. Verify the
  // wipe actually happened before inserting the new set.
  const { data: leftover } = await supabase
    .from("media_assets")
    .select("id")
    .eq("format_variant_id", variantRow.id)
    .eq("asset_type", "image")
    .limit(1)
  if (leftover && leftover.length > 0) {
    console.error(
      `[core-posts PATCH] ${format} wipe matched zero rows (RLS?)`,
      { variantId: variantRow.id },
    )
    return {
      ok: false,
      error: `${format}_wipe_failed: existing images could not be replaced`,
    }
  }

  // null/empty → just the deletion above. Otherwise upload + insert in order.
  if (Array.isArray(images) && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      const base64 = images[i]
      if (!base64) continue

      // An entry that is ALREADY a stored URL is re-pointed, not re-uploaded.
      // Reordering a saved set sends back the same frames in a new order; the
      // wipe above only removed the rows, never the storage objects, so the
      // files are still there. Without this branch `Buffer.from(url,"base64")`
      // would decode the URL text as base64 and write a corrupt image over a
      // set the user only meant to rearrange.
      if (/^https?:\/\//i.test(base64)) {
        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "image",
          url: base64,
          status: "completed",
        } as never)
        continue
      }

      const buffer = Buffer.from(base64, "base64")
      const storagePath = `${userId}/${format}/${crypto.randomUUID()}.png`
      await supabase.storage
        .from("user-media")
        .upload(storagePath, buffer, { contentType: "image/png" })
      const publicUrl = supabase.storage
        .from("user-media")
        .getPublicUrl(storagePath).data.publicUrl
      await supabase.from("media_assets").insert({
        format_variant_id: variantRow.id,
        asset_type: "image",
        url: publicUrl,
        status: "completed",
      } as never)
    }
  }

  return { ok: true, changed: true }
}

/**
 * Clear a SINGLE-slot asset (`video` or `cover`) for one format variant.
 *
 * `video` and `cover` are one-per-variant by contract — unlike `image`, which
 * carousel and story legitimately hold N of. Every writer below replaces such a
 * slot by deleting and re-inserting, and every one of them used to discard the
 * delete's error.
 *
 * That is not a theoretical gap. RLS mismatches don't raise — they match zero
 * rows — so once the media_assets policies stopped covering standalone posts, the
 * delete became a no-op and the insert ran anyway. By 2026-07-28 that had left 238
 * cover rows across 13 variants and 125 video rows across 16, including one
 * variant holding 138 cover rows that each pointed at a separate uploaded PNG.
 * Migration 028 cleaned those up; this helper is what stops them coming back,
 * and migration 029's partial unique index is the backstop under it.
 *
 * Same wipe-then-verify shape as `replaceImageAssetSet`, which learned this
 * lesson first (see its comment above).
 */
async function clearAssetSlot(
  supabase: ServerSupabase,
  variantId: string,
  assetType: "video" | "cover",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: wipeErr } = await supabase
    .from("media_assets")
    .delete()
    .eq("format_variant_id", variantId)
    .eq("asset_type", assetType)
  if (wipeErr) {
    return { ok: false, error: `${assetType}_wipe_failed: ${wipeErr.message}` }
  }

  const { data: leftover } = await supabase
    .from("media_assets")
    .select("id")
    .eq("format_variant_id", variantId)
    .eq("asset_type", assetType)
    .limit(1)
  if (leftover && leftover.length > 0) {
    console.error(
      `[core-posts PATCH] ${assetType} wipe matched zero rows (RLS?)`,
      { variantId },
    )
    return {
      ok: false,
      error: `${assetType}_wipe_failed: existing ${assetType} could not be replaced`,
    }
  }

  return { ok: true }
}

// GET — load a single core post with format variants
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // In parallel: the variants query doesn't depend on the post row, and RLS
    // scopes format_variants through core_posts.user_id anyway — so a
    // non-owner gets zero rows here and still 404s on the post check below.
    // Serialising them just added a round trip to every panel open.
    const [{ data: post, error }, { data: vData }] = await Promise.all([
      supabase.from("core_posts").select("*").eq("id", id).eq("user_id", user.id).single(),
      supabase
        .from("format_variants")
        .select("id, format, body, drive_slide_links")
        .eq("core_post_id", id),
    ])

    if (error || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const variants = (vData ?? []) as unknown as {
      id: string
      format: string
      body: string
      drive_slide_links: string[] | null
    }[]

    const formatPosts: Record<string, string> = {}
    for (const v of variants) {
      formatPosts[v.format] = v.body
    }

    // Carousel only (027): the Drive links the slides were imported from.
    // They ride along with the post so the media panel can restore the exact
    // list on any device, instead of the per-browser copy it used to keep.
    const carouselLinksVariant = variants.find((v) => v.format === "carousel")
    const carouselDriveLinks = Array.isArray(carouselLinksVariant?.drive_slide_links)
      ? carouselLinksVariant.drive_slide_links
      : null
    // Story imports frames the same way the carousel imports slides, so it
    // stores its links in the same per-format column on its own variant row.
    const storyLinksVariant = variants.find((v) => v.format === "story")
    const storyDriveLinks = Array.isArray(storyLinksVariant?.drive_slide_links)
      ? storyLinksVariant.drive_slide_links
      : null
    // B-roll keeps its source link too. It can't be read back off the asset
    // like a raw link-mode video can, because burning the caption REPLACES
    // the asset with a rendered mp4 — so without storing it, the field would
    // empty itself the moment the caption went on.
    const bRollLinksVariant = variants.find((v) => v.format === "b_roll")
    const bRollDriveLinks = Array.isArray(bRollLinksVariant?.drive_slide_links)
      ? bRollLinksVariant.drive_slide_links
      : null

    // Per-format readiness needs to know which formats have media. We do a
    // single batched lookup against media_assets and project to a set of
    // format ids that have at least one non-cover asset. The Sheet uses
    // this to render the per-format status chips without an N+1 fan-out.
    //
    // Alongside that boolean set we also build `formatMedia` — a map of
    // format → first non-cover URL. Without it, the Sheet has no way to
    // tell story / carousel / image_post media apart: it would fall back
    // to a single post-level `primaryMediaUrl` and show the same asset
    // (typically the talking_head video) on every tab. Per Hani 2026-05-13:
    // each format must surface its own upload.
    //
    // Precedence inside a format: prefer `video` over `image`, since a
    // talking_head row has both (cover is filtered out by the assetType
    // check above) and `video` is the primary playable asset.
    const variantIds = variants.map((v) => v.id)
    const formatsWithMedia: string[] = []
    const formatMedia: Record<string, string> = {}
    // EVERY media row for this post, read once. The video / cover / carousel
    // / story lookups below used to be four more round trips against this
    // same table for subsets of these same rows — five sequential queries
    // where one does. `metadata` rides along for the cover's pill colour,
    // the only field the others needed that this select was missing.
    type MediaRow = {
      format_variant_id: string
      url: string | null
      asset_type: string | null
      metadata: Record<string, unknown> | null
    }
    let allMedia: MediaRow[] = []
    if (variantIds.length > 0) {
      const { data: mediaRows } = await supabase
        .from("media_assets")
        .select("format_variant_id, url, asset_type, created_at, metadata")
        .in("format_variant_id", variantIds)
        // ASCENDING, deliberately. Carousel and story insert their frames in
        // array order, so oldest-first is slide 1. This used to sort descending,
        // which made `formatMedia.carousel` the LAST slide (usually the CTA) —
        // contradicting the comment below and every thumbnail that reads it.
        // Matches the ordering `carouselImageUrls` / `storyImageUrls` use later.
        .order("created_at", { ascending: true })
      allMedia = (mediaRows ?? []) as unknown as MediaRow[]
      const variantToFormat: Record<string, string> = {}
      for (const v of variants) variantToFormat[v.id] = v.format
      const seen = new Set<string>()
      const formatBestType: Record<string, string> = {}
      for (const m of allMedia) {
        if (!m.url || m.asset_type === "cover") continue
        const fmt = variantToFormat[m.format_variant_id]
        if (!fmt) continue
        if (!seen.has(fmt)) {
          seen.add(fmt)
          formatsWithMedia.push(fmt)
        }
        // Pick the canonical URL for this format. Video wins over image
        // (talking_head has both video + cover; carousel can have many
        // images — first one is fine for the Sheet's "primary" slot).
        const prevType = formatBestType[fmt]
        const isVideo = m.asset_type === "video"
        const prevIsVideo = prevType === "video"
        if (!formatMedia[fmt] || (isVideo && !prevIsVideo)) {
          formatMedia[fmt] = m.url
          formatBestType[fmt] = m.asset_type ?? "image"
        }
      }
    }

    // Load video URL from media_assets for talking_head
    let videoUrl: string | null = null
    let coverUrl: string | null = null
    // Pill colour the cover was generated with. Stored in the cover's
    // media_assets.metadata blob so the picker on /project can open with
    // the same colour the PNG was baked with (otherwise the swatch resets
    // to black on every reload while the cover stays whatever the user
    // last picked → user-visible mismatch).
    let coverPillColor: string | null = null
    const thVariant = variants.find((v) => v.format === "talking_head")
    if (thVariant) {
      // `allMedia` is ascending by created_at, so the LAST match is the
      // newest — the same row the old `order(desc).limit(1)` returned.
      const newest = (assetType: string) => {
        for (let i = allMedia.length - 1; i >= 0; i--) {
          const m = allMedia[i]
          if (m.format_variant_id === thVariant.id && m.asset_type === assetType) {
            return m
          }
        }
        return undefined
      }

      videoUrl = newest("video")?.url ?? null

      const cover = newest("cover")
      if (cover?.url) {
        coverUrl = cover.url
        const pill = cover.metadata?.pill_color
        if (typeof pill === "string" && /^#[0-9a-fA-F]{6}$/.test(pill)) {
          coverPillColor = pill
        }
      }
    }

    // Load carousel slide image URLs so the editor can rehydrate the
    // carousel panel. Each slide is its own media_assets row (asset_type
    // "image") under the `carousel` format_variant. Order ascending by
    // created_at to preserve the slide order they were uploaded in (the
    // PATCH handler inserts them sequentially in array order).
    const imageUrlsFor = (variantId: string | undefined): string[] =>
      variantId
        ? allMedia
            .filter(
              (m) => m.format_variant_id === variantId && m.asset_type === "image",
            )
            .map((m) => m.url)
            .filter((u): u is string => !!u)
        : []

    const carouselVariant = variants.find((v) => v.format === "carousel")
    const carouselImageUrls = imageUrlsFor(carouselVariant?.id)

    // Story frames rehydrate the same way — each of the 1-3 AI-generated
    // frames is an `image` row under the `story` variant, ordered by
    // created_at so the frame sequence is preserved.
    const storyVariant = variants.find((v) => v.format === "story")
    const storyImageUrls = imageUrlsFor(storyVariant?.id)

    return NextResponse.json({
      post: {
        ...(post as Record<string, unknown>),
        formatPosts,
        formatsWithMedia,
        formatMedia,
        videoUrl,
        coverUrl,
        coverPillColor,
        carouselImageUrls,
        carouselDriveLinks,
        storyDriveLinks,
        bRollDriveLinks,
        storyImageUrls,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — update a core post and/or its format variants
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { body, hookText, hookId, idea, productId, triggerWord, userResponse, formatPosts, videoUrl, deleteVideo, coverBase64, coverPillColor, coverText, deleteCover, carouselImages, carouselDriveLinks, storyImages, storyDriveLinks, bRollDriveLinks } = (await req.json()) as {
      body?: string
      hookText?: string
      hookId?: string
      idea?: string
      productId?: string | null
      triggerWord?: string
      userResponse?: string
      formatPosts?: Record<string, string>
      videoUrl?: string
      deleteVideo?: boolean
      coverBase64?: string
      // Hex colour (#rrggbb) the cover was generated with. Persisted on
      // the cover's media_assets.metadata so the picker on /project can
      // open showing the same colour that's actually baked into the PNG.
      coverPillColor?: string
      coverText?: string
      deleteCover?: boolean
      // Array of base64 PNG buffers — output of /api/carousel/generate.
      // Saved as multiple `media_assets` rows under the `carousel`
      // format_variant. `null` clears the slate (matches the UI's
      // "delete carousel" path that sets carouselImages=null).
      carouselImages?: string[] | null
      // The per-slide Drive links the carousel was imported from, in slide
      // order (migration 027). Order matters: dragging a link row in the
      // media panel reorders the slides too, so position IS slide position.
      // `null` clears them back to "this carousel didn't come from Drive".
      carouselDriveLinks?: string[] | null
      // Same shape/contract for the story format — the 1-3 frame set from
      // /api/story/generate-media. Saved as image rows under the `story`
      // variant; `null` clears it.
      storyImages?: string[] | null
      /** Same contract as `carouselDriveLinks`, for the story frame set. */
      storyDriveLinks?: string[] | null
      /** Same again for b-roll, which holds exactly one. */
      bRollDriveLinks?: string[] | null
    }

    // Track whether the PATCH touched any *child* table (format_variants,
    // media_assets) without writing to core_posts itself. If so we bump
    // core_posts.updated_at at the end so the /core_posts listing — sorted
    // by updated_at desc — bubbles the post to the top after any kind of
    // edit (Google-Docs-style "recently edited first"). Writes that go
    // directly through core_posts already fire its own updated_at trigger.
    let didIndirectEdit = false

    // Update core post body if provided. We treat empty string as "user
    // intentionally cleared" and still write it; callers that only want to
    // touch other fields should omit the body key entirely.
    if (body !== undefined) {
      const update: { body: string; status?: string } = { body }
      // A previously-empty draft graduates to "completed" the moment a real
      // body lands; conversely, clearing back to empty isn't worth demoting.
      if (body.trim().length > 0) update.status = "completed"
      await supabase
        .from("core_posts")
        .update(update as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update hook_text if provided. Used when the user re-picks a hook on
    // /project after the draft was already created — we keep the row's
    // hook_text in sync with the chosen one and flip is_used on the new
    // source hook so /hooks reflects reality.
    if (hookText !== undefined) {
      await supabase
        .from("core_posts")
        .update({ hook_text: hookText } as never)
        .eq("id", id)
        .eq("user_id", user.id)
      if (hookId) {
        await supabase
          .from("hooks")
          .update({ is_used: true } as never)
          .eq("user_id", user.id)
          .eq("id", hookId)
      }
    }

    // Backfill idea_text once. We only write when it's currently null on the
    // row, so editing the textarea on /project doesn't overwrite the original
    // idea the post was generated from.
    if (idea !== undefined && idea.trim()) {
      const { data: existing } = await supabase
        .from("core_posts")
        .select("idea_text")
        .eq("id", id)
        .eq("user_id", user.id)
        .single()
      const currentIdea = (existing as { idea_text: string | null } | null)?.idea_text
      if (!currentIdea) {
        await supabase
          .from("core_posts")
          .update({ idea_text: idea.trim() } as never)
          .eq("id", id)
          .eq("user_id", user.id)
      }
    }

    // Update cover text if provided
    if (coverText !== undefined) {
      await supabase
        .from("core_posts")
        .update({ cover_text: coverText } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update product selection. null clears the FK, a uuid sets it. Omit
    // entirely to leave alone.
    if (productId !== undefined) {
      await supabase
        .from("core_posts")
        .update({ product_id: productId } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update trigger word. Empty string is a valid "user cleared the field"
    // signal; only `undefined` skips the write.
    if (triggerWord !== undefined) {
      await supabase
        .from("core_posts")
        .update({ trigger_word: triggerWord } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Update the "what do you want to say" textarea. Same semantics as
    // trigger word — empty string clears, undefined skips. Without this
    // the autosave on /project couldn't reach the row and a refresh /
    // navigation back wiped the textarea to its draft-time "" value.
    if (userResponse !== undefined) {
      await supabase
        .from("core_posts")
        .update({ user_response: userResponse } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    // Upsert format variants if provided
    if (formatPosts) {
      for (const [format, text] of Object.entries(formatPosts)) {
        if (!text || text === "מייצר...") continue
        await supabase
          .from("format_variants")
          .upsert(
            {
              core_post_id: id,
              format,
              body: text,
            } as never,
            { onConflict: "core_post_id,format" },
          )
        didIndirectEdit = true
      }
    }

    // Delete video if requested
    if (deleteVideo) {
      const { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        const cleared = await clearAssetSlot(supabase, variantRow.id, "video")
        if (!cleared.ok) {
          return NextResponse.json({ error: cleared.error }, { status: 500 })
        }
        didIndirectEdit = true
      }
    }

    // Delete cover if requested
    if (deleteCover) {
      const { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        const cleared = await clearAssetSlot(supabase, variantRow.id, "cover")
        if (!cleared.ok) {
          return NextResponse.json({ error: cleared.error }, { status: 500 })
        }
        didIndirectEdit = true
      }
    }

    // Save/update video URL
    if (videoUrl) {
      // Find or create the talking_head format variant
      let { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (!thVariant) {
        const { data: newVariant } = await supabase
          .from("format_variants")
          .insert({ core_post_id: id, format: "talking_head", body: "" } as never)
          .select("id")
          .single()
        thVariant = newVariant
      }

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }
        // Replace the existing video asset. The clear MUST be verified before
        // the insert — an unverified delete here is what let the video slot
        // accumulate 40 rows for a single post.
        const cleared = await clearAssetSlot(supabase, variantRow.id, "video")
        if (!cleared.ok) {
          return NextResponse.json({ error: cleared.error }, { status: 500 })
        }

        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "video",
          url: videoUrl,
          provider: "heygen",
          status: "completed",
        } as never)
        didIndirectEdit = true
      }
    }

    // Save cover image
    if (coverBase64) {
      let { data: thVariant } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
        .eq("format", "talking_head")
        .single()

      if (!thVariant) {
        const { data: newVariant } = await supabase
          .from("format_variants")
          .insert({ core_post_id: id, format: "talking_head", body: "" } as never)
          .select("id")
          .single()
        thVariant = newVariant
      }

      if (thVariant) {
        const variantRow = thVariant as unknown as { id: string }

        // Clear the existing cover BEFORE uploading the replacement. The old
        // order uploaded first, so a clear that silently matched zero rows left
        // both a duplicate row AND a fresh orphaned PNG in the bucket — that is
        // how one variant reached 138 cover rows with 138 distinct URLs.
        // Bailing here costs nothing; bailing after the upload would not.
        const cleared = await clearAssetSlot(supabase, variantRow.id, "cover")
        if (!cleared.ok) {
          return NextResponse.json({ error: cleared.error }, { status: 500 })
        }

        // Upload cover to storage
        const coverBuffer = Buffer.from(coverBase64, "base64")
        const storagePath = `${user.id}/cover/${crypto.randomUUID()}.png`
        const { error: coverUploadErr } = await supabase.storage
          .from("user-media")
          .upload(storagePath, coverBuffer, { contentType: "image/png" })
        if (coverUploadErr) {
          return NextResponse.json(
            { error: `cover_upload_failed: ${coverUploadErr.message}` },
            { status: 500 },
          )
        }
        const coverUrl = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl

        await supabase.from("media_assets").insert({
          format_variant_id: variantRow.id,
          asset_type: "cover",
          url: coverUrl,
          status: "completed",
          metadata: coverPillColor && /^#[0-9a-fA-F]{6}$/.test(coverPillColor)
            ? { pill_color: coverPillColor }
            : {},
        } as never)
        didIndirectEdit = true
      }
    }

    // Save carousel images — array of base64 PNG buffers from
    // /api/carousel/generate. Each becomes its own `media_assets` row
    // (asset_type "image") under the `carousel` format_variant. We
    // wipe the slate first so re-generation doesn't pile up old slides.
    // Carousel + story are the multi-image formats — both persist their
    // frame set the same way (versioned as a group). Route both through the
    // shared helper so the subtle RLS wipe-verification lives in one place.
    if (carouselImages !== undefined) {
      const r = await replaceImageAssetSet(
        supabase,
        user.id,
        id,
        "carousel",
        carouselImages,
      )
      if (!r.ok) {
        return NextResponse.json({ error: r.error }, { status: 500 })
      }
      if (r.changed) didIndirectEdit = true
    }

    // Drive links, per format. Upsert rather than update: the user can paste
    // links before any media exists, and that shouldn't silently vanish just
    // because the variant row hasn't been created yet.
    for (const [format, links] of [
      ["carousel", carouselDriveLinks],
      ["story", storyDriveLinks],
      ["b_roll", bRollDriveLinks],
    ] as const) {
      if (links === undefined) continue
      const { error: linksErr } = await supabase
        .from("format_variants")
        .upsert(
          {
            core_post_id: id,
            format,
            drive_slide_links: links,
          } as never,
          { onConflict: "core_post_id,format" },
        )
      if (linksErr) {
        return NextResponse.json({ error: linksErr.message }, { status: 500 })
      }
      didIndirectEdit = true
    }

    if (storyImages !== undefined) {
      const r = await replaceImageAssetSet(
        supabase,
        user.id,
        id,
        "story",
        storyImages,
      )
      if (!r.ok) {
        return NextResponse.json({ error: r.error }, { status: 500 })
      }
      if (r.changed) didIndirectEdit = true
    }

    // Touch core_posts so updated_at advances on edits that only hit child
    // tables (format bodies, video / cover / carousel assets). The
    // before-update trigger sets updated_at = now() regardless of what we
    // write, so any successful UPDATE bumps the row to the top of the
    // /core_posts listing.
    if (didIndirectEdit) {
      await supabase
        .from("core_posts")
        .update({ updated_at: new Date().toISOString() } as never)
        .eq("id", id)
        .eq("user_id", user.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE — remove a core post (and let the cascade clean up format_variants /
// media_assets via FK ON DELETE CASCADE if configured). Front-end is the
// source of truth for "are you sure" — this just acts on the request.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Best-effort cleanup of dependent rows in case the schema doesn't have
    // ON DELETE CASCADE wired. We swallow individual errors so a missing
    // table or mismatched FK can't block the core delete the user requested.
    try {
      const { data: variants } = await supabase
        .from("format_variants")
        .select("id")
        .eq("core_post_id", id)
      const variantIds = ((variants ?? []) as { id: string }[]).map((v) => v.id)
      if (variantIds.length > 0) {
        await supabase.from("media_assets").delete().in("format_variant_id", variantIds)
        await supabase.from("format_variants").delete().eq("core_post_id", id)
      }
    } catch (cleanupErr) {
      console.warn("[core-posts][delete] cleanup warning:", cleanupErr)
    }

    const { error } = await supabase
      .from("core_posts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
