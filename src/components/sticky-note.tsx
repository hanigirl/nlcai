import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface StickyNoteProps {
  text: string
  source: string
  url?: string
  profileUrl?: string
  onClick?: () => void
  className?: string
  /** Overlay elements (e.g. favorite star) rendered above the note and rotated together with it. */
  overlay?: React.ReactNode
}

// Deterministic angle per note — same text always gets the same tilt, so notes
// don't shuffle on re-renders but still sit at varied, natural-looking angles.
function angleFor(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash) + text.charCodeAt(i)
  return ((Math.abs(hash) % 81) - 40) / 10 // −4.0° to +4.0°
}

export function StickyNote({
  text,
  source,
  url,
  profileUrl,
  onClick,
  className,
  overlay,
}: StickyNoteProps) {
  const angle = angleFor(text)
  return (
    <div className="w-full h-full animate-hook-bump">
      <div
        className="w-full h-full relative group transition-transform duration-300 ease-out hover:z-10 [transform:rotate(var(--rot))] hover:[transform:rotate(var(--rot-hover))]"
        style={{
          "--rot": `${angle}deg`,
          "--rot-hover": `${-angle * 0.35}deg`,
        } as React.CSSProperties}
      >
        <div
          dir="rtl"
          onClick={onClick}
          title={text}
          className={cn(
            "w-full h-full bg-bg-surface-hover hover:bg-bg-surface-primary-default-80 dark:bg-yellow-10 dark:hover:bg-yellow-20 rounded-lg p-5 flex flex-col justify-between cursor-pointer transition-[background-color,box-shadow] shadow-[0_2px_5px_rgba(0,0,0,0.08)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.12)]",
            className
          )}
        >
          <p className="text-xs text-text-primary-default dark:text-yellow-95 line-clamp-6 leading-relaxed">{text}</p>
          <div className="flex items-end justify-between">
            {(url || profileUrl) ? (
              <a
                href={url || profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-yellow-30 hover:text-yellow-10 dark:text-yellow-70 dark:hover:text-yellow-90 transition-colors"
                title={url ? "פתח פוסט" : "פתח פרופיל"}
              >
                <ExternalLink className="size-4" />
              </a>
            ) : (
              <span />
            )}
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs-body text-yellow-30 hover:text-yellow-10 dark:text-yellow-70 dark:hover:text-yellow-90 truncate max-w-[14ch] transition-colors underline"
                dir="auto"
                title="פתח פרופיל"
              >
                {source}
              </a>
            ) : url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs-body text-yellow-30 hover:text-yellow-10 dark:text-yellow-70 dark:hover:text-yellow-90 truncate max-w-[14ch] transition-colors underline"
                dir="auto"
              >
                {source}
              </a>
            ) : (
              <span dir="auto" className="text-xs-body text-yellow-30 dark:text-yellow-70 truncate max-w-[14ch]">{source}</span>
            )}
          </div>
        </div>
        {overlay}
      </div>
    </div>
  )
}
