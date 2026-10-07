import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthUser } from "@/lib/auth-user"
import { resolveOwnImagePath } from "@/lib/visual-language/media-source"
import { MAX_BRAND_EXAMPLES } from "@/lib/visual-language/types"

/**
 * "להפוך לשפה הוויזואלית שלי" — offered after a 👍 on a niche-language
 * image. Copies that image into her design examples (Settings → Media →
 * שפה ויזואלית); she then runs the analysis there to turn it into her own
 * visual language. A copy, so deleting the post never removes the example.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { mediaUrl, postId, format } = (await req.json().catch(() => ({}))) as {
    mediaUrl?: string
    postId?: string
    format?: string
  }
  const source = await resolveOwnImagePath(supabase, user.id, format ?? "", mediaUrl, postId)
  if (!source) {
    return NextResponse.json({ error: "no_image", message: "לא מצאנו תמונה להוסיף." }, { status: 400 })
  }

  const { count } = await supabase
    .from("user_media")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("category", "brand_example")
  if ((count ?? 0) >= MAX_BRAND_EXAMPLES) {
    return NextResponse.json(
      { error: "too_many", message: `יש כבר ${MAX_BRAND_EXAMPLES} דוגמאות. מחקו אחת בהגדרות ← מדיה ← שפה ויזואלית ונסו שוב.` },
      { status: 400 },
    )
  }

  const ext = source.split(".").pop() || "png"
  const dest = `${user.id}/brand_example/${crypto.randomUUID()}.${ext}`
  const { error: copyErr } = await supabase.storage.from("user-media").copy(source, dest)
  if (copyErr) {
    console.error("[adopt-example][copy]", copyErr)
    return NextResponse.json({ error: "copy_failed", message: "ההוספה נכשלה. נסו שוב." }, { status: 500 })
  }
  const { error } = await supabase.from("user_media").insert({
    user_id: user.id,
    category: "brand_example",
    file_name: `${format ?? "media"}-${new Date().toISOString().slice(0, 10)}.${ext}`,
    storage_path: dest,
    metadata: { source: "liked_niche_media" },
  } as never)
  if (error) {
    console.error("[adopt-example][insert]", error)
    await supabase.storage.from("user-media").remove([dest])
    return NextResponse.json({ error: "insert_failed", message: "ההוספה נכשלה. נסו שוב." }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
