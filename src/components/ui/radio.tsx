import { cn } from "@/lib/utils"

interface RadioProps {
  checked?: boolean
  className?: string
}

export function Radio({ checked, className }: RadioProps) {
  return (
    <div
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full transition-all",
        checked
          ? "bg-yellow-20"
          : "border border-gray-60 bg-transparent",
        className
      )}
    >
      {checked && (
        <svg
          className="size-[9px] text-white"
          viewBox="0 0 6 4.125"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5.5 0.5 2.25 3.625 0.5 1.875" />
        </svg>
      )}
    </div>
  )
}
