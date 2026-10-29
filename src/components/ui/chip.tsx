import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The one chip (Hani, 2026-10-29: "צ׳יפים תמיד ייראו ככה"): the outline
 * Button, fully round, small regular-weight text, our grey hover — never
 * yellow. `selected` fills it grey with a darker border (and aria-pressed),
 * for chips that toggle.
 */
function Chip({
  className,
  selected,
  type = "button",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
  selected?: boolean
}) {
  return (
    <Button
      data-slot="chip"
      type={type}
      size="sm"
      variant="outline"
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "h-7 rounded-full px-3 text-xs-body font-normal hover:bg-gray-95 dark:hover:bg-gray-20 focus-visible:ring-2 focus-visible:ring-gray-70",
        selected && "bg-gray-95 dark:bg-gray-20 border-text-primary-default dark:border-gray-70",
        className,
      )}
      {...props}
    />
  )
}

export { Chip }
