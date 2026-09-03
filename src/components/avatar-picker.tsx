"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { userKey } from "@/lib/user-scoped-storage"
import { getCurrentUser } from "@/lib/supabase/current-user"


export interface Avatar {
  avatar_id: string
  avatar_name: string
  preview_image_url: string
  preview_video_url: string
  /**
   * Which HeyGen character shape this id belongs to. Must reach
   * /api/videos/generate — a photo avatar sent as a video avatar is rejected.
   * Optional so older cached shapes still typecheck; the route defaults to
   * "avatar".
   */
  type?: "avatar" | "talking_photo"
}

interface AvatarPickerProps {
  onSelect: (avatar: Avatar) => void
}

// _v2 on purpose: the key is versioned so a shape change or a fix to what the
// route returns invalidates every stale list already sitting in a browser.
// Without that bump, users kept seeing a day-old snapshot and no amount of
// server-side fixing reached them.
const CACHE_KEY = "heygen_avatars_cache_v2"
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// Per-user cache. Avatars come from the user's own HeyGen API key, so two
// users on the same browser would otherwise see each other's avatar list.
function readCachedAvatars(uid: string): Avatar[] | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem(userKey(CACHE_KEY, uid))
    if (cached) {
      const { avatars, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_TTL && avatars?.length > 0) {
        return avatars
      }
    }
  } catch {
    // Invalid cache
  }
  return null
}

export function AvatarPicker({ onSelect }: AvatarPickerProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (cancelled) return
      if (!user) {
        setLoading(false)
        return
      }

      // Stale-while-revalidate. The cache used to be a hard 24h stop: it
      // returned and never re-fetched, so an avatar recorded in HeyGen was
      // invisible here for up to a day with no way to force a refresh. Now the
      // cached list paints immediately (no spinner) and a fetch still runs
      // underneath to correct it.
      const cached = readCachedAvatars(user.id)
      if (cached) {
        setAvatars(cached)
        setLoading(false)
      }

      try {
        const res = await fetch("/api/avatars")
        const data = await res.json()
        if (cancelled) return
        if (data.error === "heygen_not_connected") {
          if (!cached) setNotConnected(true)
        } else if (data.error) {
          if (!cached) setError(data.error)
        } else {
          setAvatars(data.avatars)
          try {
            localStorage.setItem(
              userKey(CACHE_KEY, user.id),
              JSON.stringify({ avatars: data.avatars, timestamp: Date.now() }),
            )
          } catch {
            // localStorage full, ignore
          }
        }
      } catch {
        // A failed background refresh must not blank out a list that is
        // already on screen — keep showing the cached one.
        if (!cancelled && !cached) setError("Failed to load avatars")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-neutral-default text-sm animate-pulse">
          טוען אווטארים...
        </div>
      </div>
    )
  }

  if (notConnected) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="text-small text-text-neutral-default">
          חבר את חשבון HeyGen שלך כדי להשתמש באווטארים
        </p>
        <Link href="/settings" className="text-small font-semibold text-text-primary-default hover:underline">
          עבור להגדרות
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-button-destructive-default text-sm">{error}</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {avatars.map((avatar) => (
        <div
          key={avatar.avatar_id}
          className="relative aspect-[9/16] rounded-xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-gray-80"
          onClick={() => onSelect(avatar)}
          onMouseEnter={() => setHoveredId(avatar.avatar_id)}
          onMouseLeave={() => setHoveredId(null)}
        >
          {hoveredId === avatar.avatar_id && avatar.preview_video_url ? (
            <video
              src={avatar.preview_video_url}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <Image
              src={avatar.preview_image_url}
              alt={avatar.avatar_name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, 33vw"
            />
          )}
          {/* Name overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-6">
            <span className="text-white text-sm font-medium">{avatar.avatar_name}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
