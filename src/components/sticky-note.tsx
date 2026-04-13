import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface StickyNoteProps {
  text: string
  source: string
  url?: string
  profileUrl?: string
  onClick?: () => void
  className?: string
}

export function StickyNote({
  text,
  source,
  url,
  profileUrl,
  onClick,
  className,
}: StickyNoteProps) {
  return (
    <div
      dir="rtl"
      onClick={onClick}
      title={text}
      className={cn(
        "w-full h-full bg-bg-surface-hover hover:bg-bg-surface-primary-default-80 dark:bg-yellow-10 dark:hover:bg-yellow-20 rounded-lg p-5 flex flex-col justify-between cursor-pointer transition-colors",
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
  )
}
