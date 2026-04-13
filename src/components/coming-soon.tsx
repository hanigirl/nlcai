import { Sparkles } from "lucide-react"

interface ComingSoonProps {
  title?: string
  description?: string
  className?: string
}

export function ComingSoon({
  title = "בקרוב",
  description = "האזור הזה בעבודה ויהיה זמין בקרוב",
  className = "",
}: ComingSoonProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 py-16 text-center ${className}`}>
      <div className="rounded-2xl bg-bg-surface-primary-default p-6 max-w-sm">
        <div className="flex items-center justify-center mb-3">
          <div className="relative">
            <Sparkles className="size-12 text-yellow-20" strokeWidth={1.5} />
            <Sparkles className="size-5 text-yellow-30 absolute -top-1 -end-2" strokeWidth={2} />
          </div>
        </div>
        <p className="text-p-bold text-text-primary-default">{title}</p>
        <p className="text-small text-text-neutral-default mt-1">{description}</p>
      </div>
    </div>
  )
}
