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
      <div className="rounded-2xl bg-white border border-border-neutral-default shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] p-6 max-w-sm">
        <p className="text-p-bold text-text-primary-default">{title}</p>
        <p className="text-small text-text-neutral-default mt-1">{description}</p>
      </div>
    </div>
  )
}
