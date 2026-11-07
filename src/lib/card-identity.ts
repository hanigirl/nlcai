import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Her identity for a card-like design (a tweet card, a post card) built from
 * a reference (Hani, 2026-11-07: "ל tweet צריך תמונת פרופיל ושם עמוד
 * האינסטגרם"): her display name, @handle and profile picture.
 *
 * Read from, in order: what she gave in the AI panel (kept in her storage,
 * `<uid>/profile/card-identity.json` — never asked again), her connected
 * Instagram account (handle, picture), her account name. Nothing is scraped.
 */

export type CardIdentity = { name?: string; handle?: string; avatarUrl?: string }

const fileOf = (userId: string) => `${userId}/profile/card-identity.json`

async function readSaved(supabase: SupabaseClient, userId: string): Promise<CardIdentity> {
  const { data, error } = await supabase.storage.from("user-media").download(fileOf(userId))
  if (error || !data) return {}
  try {
    const raw = JSON.parse(await data.text()) as Record<string, unknown>
    return {
      ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
      ...(typeof raw.handle === "string" && raw.handle.trim() ? { handle: raw.handle.trim().replace(/^@/, "") } : {}),
      ...(typeof raw.avatarUrl === "string" && raw.avatarUrl.trim() ? { avatarUrl: raw.avatarUrl.trim() } : {}),
    }
  } catch {
    return {}
  }
}

export async function loadCardIdentity(supabase: SupabaseClient, userId: string): Promise<CardIdentity> {
  const saved = await readSaved(supabase, userId)
  const [{ data: ig }, { data: me }] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("handle, avatar_url")
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .eq("status", "connected")
      .limit(1)
      .maybeSingle(),
    supabase.from("users").select("full_name").eq("id", userId).maybeSingle(),
  ])
  const igRow = ig as { handle: string | null; avatar_url: string | null } | null
  const name = saved.name || (me as { full_name: string | null } | null)?.full_name?.trim() || undefined
  const handle = saved.handle || igRow?.handle?.trim().replace(/^@/, "") || undefined
  const avatarUrl = saved.avatarUrl || igRow?.avatar_url?.trim() || undefined
  return { ...(name ? { name } : {}), ...(handle ? { handle } : {}), ...(avatarUrl ? { avatarUrl } : {}) }
}

/** What she supplied, merged over what was saved. */
export async function saveCardIdentity(supabase: SupabaseClient, userId: string, given: CardIdentity): Promise<CardIdentity> {
  const next = { ...(await readSaved(supabase, userId)) }
  if (given.name?.trim()) next.name = given.name.trim().slice(0, 60)
  if (given.handle?.trim()) next.handle = given.handle.trim().replace(/^@/, "").slice(0, 40)
  if (given.avatarUrl?.trim()) next.avatarUrl = given.avatarUrl.trim()
  const body = new Blob([JSON.stringify(next)], { type: "application/json" })
  const { error } = await supabase.storage.from("user-media").upload(fileOf(userId), body, { upsert: true, contentType: "application/json" })
  if (error) throw new Error(error.message)
  return next
}

/** The avatar as a data URL for the renderer (a CDN link may not load headless, or expire). */
export async function avatarDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 2_000_000) return null
    return `data:${type};base64,${buf.toString("base64")}`
  } catch {
    return null
  }
}

const NEED_WORDS: Record<string, string> = {
  avatar: "תמונת פרופיל",
  name: "השם שיופיע",
  handle: "ה-@ שלכם באינסטגרם",
  photo: "תמונה שלכם או של המוצר",
}

/** The chat's ask for exactly what's missing. */
export function missingMessage(missing: string[]): string {
  const words = missing.map((m) => NEED_WORDS[m]).filter(Boolean)
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} ו${words[words.length - 1]}`
  const attach = missing.includes("avatar") || missing.includes("photo")
  const write = missing.includes("name") || missing.includes("handle")
  const how = [
    attach ? `צרפו ${missing.includes("avatar") ? "תמונת פרופיל" : "את התמונה"}` : "",
    write ? `כתבו ${missing.includes("name") && missing.includes("handle") ? "את השם ואת ה-@" : missing.includes("name") ? "את השם" : "את ה-@"}` : "",
  ]
    .filter(Boolean)
    .join(" ו")
  return `כדי שזה ייראה כמו ברפרנס חסרים לי ${list}. ${how}, ואמשיך.`
}
