import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"

const linkSizes = {
  default: { text: "text-p", icon: "size-4", gap: "gap-2" },
  small: { text: "text-small", icon: "size-3.5", gap: "gap-1.5" },
} as const

type LinkSize = keyof typeof linkSizes

interface AppLinkProps
  extends Omit<React.ComponentProps<typeof Link>, "className"> {
  className?: string
  linkSize?: LinkSize
  iconLeft?: React.ReactNode | null
  iconRight?: React.ReactNode | null
}

function AppLink({
  className,
  children,
  linkSize = "default",
  iconLeft,
  iconRight,
  ...props
}: AppLinkProps) {
  const s = linkSizes[linkSize]
  const defaultIcon = <ChevronLeft className={s.icon} />

  return (
    <Link
      className={cn(
        "inline-flex items-center text-button-primary-default hover:text-button-primary-hover transition-colors",
        s.text,
        s.gap,
        className
      )}
      {...props}
    >
      {iconRight}
      {children}
      {iconLeft === undefined ? defaultIcon : iconLeft}
    </Link>
  )
}

export { AppLink }
