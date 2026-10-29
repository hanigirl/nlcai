"use client"

import { Loader2, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipLabel } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * An icon-only action on a media card — delete, download — sitting in one row
 * with "אישור לתזמון" (Hani, 2026-10-29). The project's outline button at the
 * primary button's height, grey hover, with the action's noun as tooltip and
 * accessible name. `destructive` paints the icon red; the surface stays the
 * same so the row reads as one set.
 *
 * Pass `href` for a plain download link (`download` names the file).
 */
export function IconActionButton({
  label,
  icon: Icon,
  onClick,
  destructive = false,
  disabled = false,
  busy = false,
  href,
  download,
  className,
}: {
  /** Action noun — "מחיקה", "הורדה". Tooltip + aria-label. */
  label: string
  icon: LucideIcon
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  /** Working on it — spinner instead of the icon. */
  busy?: boolean
  href?: string
  download?: string
  className?: string
}) {
  const glyph = busy ? (
    <Loader2 className="size-4 animate-spin" aria-hidden />
  ) : (
    <Icon className={cn("size-4", destructive && "text-button-destructive-default")} aria-hidden />
  )
  const classes = cn("size-11 shrink-0 px-0", className)

  return (
    <TooltipLabel label={label}>
      {href ? (
        <Button asChild variant="outline" aria-label={label} className={classes}>
          <a
            href={href}
            download={download}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {glyph}
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          aria-label={label}
          disabled={disabled || busy}
          className={classes}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClick?.()
          }}
        >
          {glyph}
        </Button>
      )}
    </TooltipLabel>
  )
}
