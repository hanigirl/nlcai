import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * A new b-roll starts a new conversation (Hani, 2026-11-10: "הוא זוכר גם
 * בירול שמחקתי כבר"). Called when the b-roll is deleted and when a fresh one
 * is generated — the old talk is archived (kept, like "שיחה חדשה"), never
 * deleted. Edits of the same b-roll keep their conversation.
 */
export async function resetAgentChat(db: SupabaseClient, userId: string, postId: string, format = "b_roll"): Promise<void> {
  await db
    .from("ai_chat_threads")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("user_id", userId)
    .eq("chat_key", `agent:${postId}:${format}`)
    .is("archived_at", null)
}
