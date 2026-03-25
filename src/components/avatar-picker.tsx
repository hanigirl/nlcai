"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"


export interface Avatar {
  avatar_id: string
  avatar_name: string
  preview_image_url: string
  preview_video_url: string
}

interface AvatarPickerProps {
  onSelect: (avatar: Avatar) => void
}

const CACHE_KEY = "heygen_avatars_cache"
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

function getCachedAvatars(): Avatar[] | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem(CACHE_KEY)
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
  const [avatars, setAvatars] = useState<Avatar[]>(() => getCachedAvatars() ?? [])
  const [loading, setLoading] = useState(() => getCachedAvatars() === null)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  useEffect(() => {
    // Skip fetch if we already have cached data
    if (avatars.length > 0) return

    fetch("/api/avatars")
      .then((res) => res.json())
      .then((data) => {
        if (data.error === "heygen_not_connected") {
          setNotConnected(true)
        } else if (data.error) {
          setError(data.error)
        } else {
          setAvatars(data.avatars)
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ avatars: data.avatars, timestamp: Date.now() }))
          } catch {
            // localStorage full, ignore
          }
        }
      })
      .catch(() => setError("Failed to load avatars"))
      .finally(() => setLoading(false))
  }, [avatars.length])

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
          className="relative aspect-[9/16] rounded-xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-yellow-50"
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
