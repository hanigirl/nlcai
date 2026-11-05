"use client"

/**
 * The networks' own logos, in their own colours (Hani, 2026-11-05).
 *
 * Paths from simple-icons (CC0): YouTube and TikTok from 16.36.0; LinkedIn
 * from 9.0.0, since later releases dropped it at the brand's request.
 * Instagram is the filled app mark, drawn here from basic shapes.
 * Inline SVG, no dependency.
 *
 * The hex values here are the brands' own and are the one deliberate
 * exception to the token rule: a logo recoloured to our palette is no longer
 * the logo. They live in this file only.
 *
 * Every logo takes `className` for size and `aria-hidden` by default — the
 * label belongs to whatever wraps it.
 */

import { useId, type SVGProps } from "react"
import type { SocialPlatform } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

type LogoProps = SVGProps<SVGSVGElement> & { className?: string }

const YOUTUBE_PATH =
  "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"

const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"

const TIKTOK_PATH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"

/**
 * Instagram — the filled app mark (Hani, 2026-11-05: filled, like the
 * others): a gradient rounded square with the camera in white.
 */
export function InstagramLogo({ className, ...props }: LogoProps) {
  const id = `ig-${useId().replace(/:/g, "")}`
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...props}>
      <defs>
        <radialGradient id={id} cx="0.28" cy="1.08" r="1.3">
          <stop offset="0" stopColor="#FFDC80" />
          <stop offset="0.15" stopColor="#FCAF45" />
          <stop offset="0.35" stopColor="#F77737" />
          <stop offset="0.5" stopColor="#F56040" />
          <stop offset="0.65" stopColor="#E1306C" />
          <stop offset="0.8" stopColor="#C13584" />
          <stop offset="1" stopColor="#5851DB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill={`url(#${id})`} />
      <rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#FFFFFF" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#FFFFFF" strokeWidth="1.9" />
      <circle cx="16.1" cy="7.9" r="1.05" fill="#FFFFFF" />
    </svg>
  )
}

/** YouTube — red play button, white triangle. */
export function YouTubeLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...props}>
      <path d="M9.545 8.432 15.818 12l-6.273 3.568z" fill="#FFFFFF" />
      <path d={YOUTUBE_PATH} fill="#FF0000" />
    </svg>
  )
}

/** LinkedIn — blue square, white "in". */
export function LinkedInLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...props}>
      <rect x="2" y="2" width="20" height="20" rx="1" fill="#FFFFFF" />
      <path d={LINKEDIN_PATH} fill="#0A66C2" />
    </svg>
  )
}

/** TikTok — the note in black (white in dark mode), with its cyan and pink offsets. */
export function TikTokLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...props}>
      <path d={TIKTOK_PATH} fill="#25F4EE" transform="translate(-0.7 -0.7)" />
      <path d={TIKTOK_PATH} fill="#FE2C55" transform="translate(0.7 0.7)" />
      <path d={TIKTOK_PATH} className="fill-gray-10 dark:fill-white" />
    </svg>
  )
}

export type NetworkLogoId = SocialPlatform | "tiktok"

export const NETWORK_LOGO: Record<NetworkLogoId, (p: LogoProps) => React.ReactElement> = {
  instagram: InstagramLogo,
  youtube: YouTubeLogo,
  linkedin: LinkedInLogo,
  tiktok: TikTokLogo,
}

/**
 * One network's logo. `off` = not connected: the colour drained and the logo
 * faded, so it reads as present-but-inactive next to the live ones.
 */
export function NetworkLogo({
  platform,
  off = false,
  className,
}: {
  platform: NetworkLogoId
  off?: boolean
  className?: string
}) {
  const Logo = NETWORK_LOGO[platform]
  return <Logo className={cn(className, off && "opacity-45 grayscale")} />
}
