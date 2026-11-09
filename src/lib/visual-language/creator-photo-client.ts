"use client"

import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { languageShowsPerson } from "@/lib/visual-language/creator-photo"
import type { VisualFormat, VisualLanguage } from "@/lib/visual-language/types"

/**
 * Her saved language, read at the moment she asks for media — a re-analysis
 * in Settings applies at once. Any failure reads as "no": the caller then
 * generates as before (and the model still draws no one).
 */
export async function myLanguageShowsPerson(format: VisualFormat): Promise<boolean> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await getCurrentUser(supabase)
    if (!user) return false
    const { data } = await supabase.from("users").select("visual_language").eq("id", user.id).single()
    return languageShowsPerson((data as { visual_language?: VisualLanguage | null } | null)?.visual_language, format)
  } catch {
    return false
  }
}
