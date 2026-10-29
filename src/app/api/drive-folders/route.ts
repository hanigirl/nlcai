import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAuthUser } from "@/lib/auth-user"
import {
  listPublicFolder,
  parseFolderLink,
  type DriveFolderError,
  type DriveFolderListing,
} from "@/lib/drive-folder"

/**
 * Her Drive media folders — one per kind of media (Settings → מדיה →
 * "מדיה מ-Google Drive"). Saved on her auth profile (user_metadata), so no
 * table is needed for five links; read with the service role so a save is
 * seen at once rather than on the next token refresh.
 *
 * GET                       → { folders: { [key]: Folder | null } }  (listed live)
 * GET ?key=carousel         → { folder: Folder | null }               (one, listed live)
 * POST { key, link }        → { folder } | { error }                  (check + save)
 * POST { key, link: "" }    → { folder: null }                        (disconnect)
 */

const KEYS = ["broll", "talking", "images", "story", "carousel"] as const
type Key = (typeof KEYS)[number]
type Saved = { link: string; id: string; name: string }
type Folder = { link: string; name: string; items: DriveFolderListing["items"] } | { link: string; error: DriveFolderError }

const isKey = (k: unknown): k is Key => typeof k === "string" && (KEYS as readonly string[]).includes(k)

async function readSaved(userId: string): Promise<Partial<Record<Key, Saved>>> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const raw = (data.user?.user_metadata as Record<string, unknown> | undefined)?.drive_folders
  return raw && typeof raw === "object" ? (raw as Partial<Record<Key, Saved>>) : {}
}

async function writeSaved(userId: string, folders: Partial<Record<Key, Saved>>) {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  const meta = (data.user?.user_metadata as Record<string, unknown> | undefined) ?? {}
  const { error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, drive_folders: folders },
  })
  if (error) throw new Error(error.message)
}

async function list(saved: Saved, preview: boolean): Promise<Folder> {
  try {
    const r = await listPublicFolder(saved.id, preview)
    if ("error" in r) return { link: saved.link, error: r.error }
    return { link: saved.link, name: r.name || saved.name, items: r.items }
  } catch {
    return { link: saved.link, error: "not_public" }
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const saved = await readSaved(user.id)
  const preview = true

  const key = req.nextUrl.searchParams.get("key")
  if (key) {
    if (!isKey(key)) return NextResponse.json({ error: "bad key" }, { status: 400 })
    const s = saved[key]
    return NextResponse.json({ folder: s ? await list(s, preview) : null })
  }

  const entries = await Promise.all(
    KEYS.map(async (k) => [k, saved[k] ? await list(saved[k]!, preview) : null] as const),
  )
  return NextResponse.json({ folders: Object.fromEntries(entries) })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { key, link } = (await req.json().catch(() => ({}))) as { key?: unknown; link?: unknown }
  if (!isKey(key)) return NextResponse.json({ error: "bad key" }, { status: 400 })
  const saved = await readSaved(user.id)
  const preview = true

  const trimmed = typeof link === "string" ? link.trim() : ""
  if (!trimmed) {
    const next = { ...saved }
    delete next[key]
    await writeSaved(user.id, next)
    return NextResponse.json({ folder: null })
  }

  const parsed = parseFolderLink(trimmed)
  if ("error" in parsed) return NextResponse.json({ error: parsed.error })
  let listing: Awaited<ReturnType<typeof listPublicFolder>>
  try {
    listing = await listPublicFolder(parsed.id, preview)
  } catch {
    listing = { error: "not_public" }
  }
  // Not saved until it can actually be read — a folder she can't use is
  // shown as the error with its fix, not quietly remembered.
  if ("error" in listing) return NextResponse.json({ error: listing.error })

  // Re-read right before writing. Listing the folder takes seconds, and
  // `saved` from before it is stale: connecting the images folder while the
  // b-roll one was still being checked wrote back the old set and silently
  // dropped one of them — "connected" on screen, gone on the next load.
  const fresh = preview ? await readSaved(user.id) : saved
  await writeSaved(user.id, { ...fresh, [key]: { link: trimmed, id: parsed.id, name: listing.name } })
  return NextResponse.json({ folder: { link: trimmed, name: listing.name, items: listing.items } })
}
