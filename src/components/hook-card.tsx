"use client"

import { useState } from "react"
import { ArrowLeft, Copy, Check, Trash2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

interface HookCardProps {
  hookText: string
  onNavigate: () => void
  onCopy?: () => void
  onDelete?: () => void
  used?: boolean
}

export function HookCard({ hookText, onNavigate, onCopy, onDelete, used }: HookCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(hookText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    onCopy?.()
  }

  return (
    <Card
      dir="rtl"
      className={`group gap-4 rounded-[16px] border-border-neutral-default bg-white dark:bg-gray-10 p-4 py-4 shadow-none transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 ${
        used ? "opacity-60" : ""
      }`}
    >
      <CardContent className="flex flex-col gap-2 p-0">
        {/* Hook text */}
        <p className="text-sm text-text-primary-default line-clamp-2">
          {hookText}
        </p>

        {/* Actions row */}
        <div className="flex items-center gap-2">
          {/* Copy - visible on hover */}
          <button
            onClick={handleCopy}
            className="flex items-center justify-center size-8 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            {copied ? (
              <Check className="size-4 text-green-600" />
            ) : (
              <Copy className="size-4 text-text-primary-default" />
            )}
          </button>

          {/* Delete - visible on hover */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center justify-center size-8 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Trash2 className="size-4 text-text-primary-default" />
            </button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Navigate arrow - always visible */}
          <button
            onClick={onNavigate}
            className="flex items-center justify-center size-8 shrink-0 rounded-lg bg-bg-surface group-hover:bg-bg-surface-primary-default-80 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4 text-text-primary-default" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
