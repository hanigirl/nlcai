import { cn } from "@/lib/utils"

interface StickyNoteProps {
  text: string
  productName: string
  date: string
  onClick?: () => void
  className?: string
}

export function StickyNote({
  text,
  productName,
  date,
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
      <p className="text-p text-text-primary-default dark:text-yellow-95 line-clamp-5">{text}</p>
      <div className="flex items-end justify-between">
        <span className="text-xs-body text-yellow-30">{date}</span>
        <span dir="auto" className="text-xs-body text-yellow-30 truncate max-w-[10ch]">{productName}</span>
      </div>
    </div>
  )
}
