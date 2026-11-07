import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * "איך לייצר סרטון דיבור למצלמה" (Hani, 2026-11-07): her standing
 * instructions for every AI edit of a talking-head video — saved from the AI
 * panel ("לשמור כתבנית לסרטוני דיבור למצלמה"), edited in Settings → מדיה →
 * העדפות ויזואליות → דיבור למצלמה, and read by the next edit.
 *
 * A small JSON file next to her media (no schema change), like style-memory:
 *   user-media/<userId>/talking-head-template.json → { instructions, at }
 */
const BUCKET = "user-media"
const path = (userId: string) => `${userId}/talking-head-template.json`
export const MAX_TEMPLATE_CHARS = 4000

export async function loadTalkingHeadTemplate(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path(userId))
  if (error || !data) return ""
  try {
    const parsed = JSON.parse(await data.text()) as { instructions?: unknown }
    return typeof parsed.instructions === "string" ? parsed.instructions : ""
  } catch {
    return ""
  }
}

export async function saveTalkingHeadTemplate(supabase: SupabaseClient, userId: string, instructions: string): Promise<string> {
  const text = instructions.trim().slice(0, MAX_TEMPLATE_CHARS)
  const body = JSON.stringify({ instructions: text, at: new Date().toISOString() })
  const opts = { contentType: "application/json", upsert: true }
  const { error } = await supabase.storage.from(BUCKET).upload(path(userId), body, opts)
  if (error) {
    // No UPDATE policy on the bucket → replace by delete + insert (as style-memory).
    await supabase.storage.from(BUCKET).remove([path(userId)])
    const retry = await supabase.storage.from(BUCKET).upload(path(userId), body, { contentType: "application/json" })
    if (retry.error) throw new Error(retry.error.message)
  }
  return text
}

/** A request from the panel, added as its own line unless it's there already. */
export function withRequest(current: string, request: string): string {
  const line = request.trim()
  if (!line) return current
  const lines = current.split("\n").map((l) => l.trim()).filter(Boolean)
  return lines.includes(line) ? current : [...lines, line].join("\n")
}
