import { cn } from "@/lib/utils"

interface IdeaCardProps {
  text: string
  label?: string
  date?: string
  className?: string
}

export function IdeaCard({ text, label = "קלוד קוד", date, className }: IdeaCardProps) {
  const formattedDate = date ?? new Date().toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).replace(/\//g, ".")

  return (
    <div
      dir="rtl"
      className={cn(
        "flex w-[207px] h-[207px] flex-col justify-between rounded-[16px] bg-bg-surface-primary-default p-5",
        className
      )}
    >
      <p className="text-small-bold text-text-primary-default">{text}</p>

      <div className="flex items-end justify-between">
        <span className="text-xs-body text-text-primary-default">{formattedDate}</span>
        <span className="text-xs-body text-text-primary-default font-semibold">{label}</span>
      </div>
    </div>
  )
}
