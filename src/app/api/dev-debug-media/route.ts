import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 1. Check user_media rows
  const { data: rows, error: rowsErr } = await supabase
    .from("user_media")
    .select("id, category, file_name, storage_path, created_at")
    .eq("user_id", user.id)

  // 2. List storage objects under the user's prefix
  const folders = ["style_file", "audience_file"]
  const storageListings: Record<string, unknown> = {}
  for (const folder of folders) {
    const { data: listed, error: listErr } = await supabase.storage
      .from("user-media")
      .list(`${user.id}/${folder}`)
    storageListings[folder] = listErr ? { error: listErr.message } : listed
  }

  // 3. Try a test insert to see if check constraint allows style_file
  let constraintTest: unknown = null
  try {
    const { error: testErr } = await supabase.from("user_media").insert({
      user_id: user.id,
      category: "style_file",
      file_name: "__test__",
      storage_path: "__test__",
      metadata: {},
    } as never)
    if (testErr) {
      constraintTest = { error: testErr.message, code: testErr.code }
    } else {
      constraintTest = "ok"
      // Clean up test row
      await supabase
        .from("user_media")
        .delete()
        .eq("user_id", user.id)
        .eq("file_name", "__test__")
    }
  } catch (e) {
    constraintTest = { thrown: String(e) }
  }

  return NextResponse.json({
    user_id: user.id,
    rows,
    rows_error: rowsErr,
    storageListings,
    constraintTest,
  })
}
