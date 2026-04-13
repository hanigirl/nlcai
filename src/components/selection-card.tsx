"use client"

import React, { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Radio } from "@/components/ui/radio"

interface SelectionCardProps {
  title?: string
  description: string
  isSelected?: boolean
  editable?: boolean
  icon?: React.ReactNode
  onSelect?: () => void
  onTextChange?: (text: string) => void
  className?: string
}

export function SelectionCard({
  title,
  description,
  isSelected,
  editable,
  icon,
  onSelect,
  onTextChange,
  className,
}: SelectionCardProps) {
  const [editing, setEditing] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isClamped, setIsClamped] = useState(false)

  useEffect(() => {
    if (textRef.current) {
      setIsClamped(textRef.current.scrollHeight > textRef.current.clientHeight)
    }
  }, [description, editing])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
    }
  }, [description, editing])

  const handleMouseEnter = () => {
    if (!editing && isClamped) {
      tooltipTimer.current = setTimeout(() => setShowTooltip(true), 1000)
    }
  }

  const handleMouseLeave = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setShowTooltip(false)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editable) onSelect?.()
      }}
      className={cn(
        "relative flex w-full items-start gap-4 rounded-[10px] border p-3 text-right transition-all cursor-pointer",
        isSelected
          ? "border-gray-80 bg-gray-95"
          : "border-border-neutral-default bg-bg-surface hover:border-gray-80",
        className
      )}
    >
      <Radio checked={isSelected} className="mt-1" />

      {/* Content */}
      <div
        className="flex-1 min-w-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {title && (
          <span className="text-p-bold text-text-primary-default block">{title}</span>
        )}
        {editable ? (
          <div
            className={cn(
              "rounded-lg p-1 transition-colors",
              editing
                ? isSelected ? "bg-gray-90" : "bg-gray-95"
                : "bg-transparent"
            )}
          >
            {editing ? (
              <textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => onTextChange?.(e.target.value)}
                onFocus={(e) => {
                  e.stopPropagation()
                  setEditing(true)
                }}
                onBlur={() => setEditing(false)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="w-full resize-none bg-transparent text-small text-text-primary-default outline-none"
              />
            ) : (
              <p
                ref={textRef}
                className="text-small text-text-primary-default line-clamp-3 cursor-text"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(true)
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
              >
                {description}
              </p>
            )}
          </div>
        ) : (
          <p
            ref={textRef}
            className="text-small text-text-primary-default line-clamp-3"
          >
            {description}
          </p>
        )}

        {/* Tooltip */}
        {showTooltip && isClamped && (
          <div className="absolute z-50 start-0 end-0 top-full mt-1 rounded-lg bg-gray-10 dark:bg-gray-90 text-white dark:text-gray-10 text-xs-body p-3 shadow-lg">
            {description}
          </div>
        )}
      </div>

      {/* Icon on the left (end in RTL) */}
      {icon && <div className="shrink-0 text-text-neutral-default mt-1">{icon}</div>}
    </div>
  )
}
