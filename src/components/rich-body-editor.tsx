"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

interface RichBodyEditorProps {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
  className?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * The editor's text, read back the way it looks.
 *
 * Chrome answers Enter and paste with block elements: a new line becomes
 * <div>…</div>, an empty line <div><br></div>. `innerText` then counts an
 * empty block as a line break PLUS the <br> PLUS the next block's break, so
 * one blank line on screen read back as three newline characters, and every
 * edit-and-reload cycle widened the gaps (Hani, 2026-09-03: "I don't want
 * gaps"). This walks the DOM instead: a block is one line, an empty block is
 * one empty line, <br> is one break, text is text.
 */
function domToText(root: HTMLElement): string {
  const isBlock = (n: Node): n is HTMLElement =>
    n.nodeType === Node.ELEMENT_NODE && /^(DIV|P)$/.test((n as HTMLElement).tagName)
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? ""
    if (n.nodeType !== Node.ELEMENT_NODE) return ""
    const el = n as HTMLElement
    if (el.tagName === "BR") return "\n"
    let out = ""
    el.childNodes.forEach((c) => {
      out += isBlock(c) ? block(c) : inline(c)
    })
    return out
  }
  // A block is its content followed by a line break. The lone <br> Chrome
  // uses to give an empty block height is not a break of its own.
  const block = (el: HTMLElement): string => {
    let inner = ""
    el.childNodes.forEach((c) => {
      inner += isBlock(c) ? block(c) : inline(c)
    })
    if (inner === "\n") inner = ""
    return inner.endsWith("\n") ? inner : inner + "\n"
  }
  let out = ""
  root.childNodes.forEach((c) => {
    if (isBlock(c)) {
      // A block after inline text starts on its own line.
      if (out && !out.endsWith("\n")) out += "\n"
      out += block(c)
    } else {
      out += inline(c)
    }
  })
  // The trailing break of the last block, or the <br> Chrome parks at the
  // end of a line, is layout rather than content.
  return out.replace(/\n$/, "")
}

// First line is everything before the first \n (or whole text if no newline).
// We render it inside <strong> so the hook stays visually emphasized whether
// the user just generated the post or is reading an old one.
function buildBodyHtml(text: string): string {
  if (!text) return ""
  const newline = text.indexOf("\n")
  if (newline === -1) {
    return `<strong>${escapeHtml(text)}</strong>`
  }
  const firstLine = text.slice(0, newline)
  const rest = text.slice(newline)
  return `<strong>${escapeHtml(firstLine)}</strong>${escapeHtml(rest)}`
}

/**
 * Editable post body with the first line rendered in <strong>.
 *
 * Used in place of <Textarea> wherever a core post body or format-variant
 * body is displayed on /project, so the hook (always the first line of an
 * AI-generated post) stays visually emphasized during editing.
 *
 * Cursor stability: re-rendering innerHTML on every keystroke would jump
 * the caret to the start. We only sync DOM ← React value when the change
 * came from outside (initial mount, AI regeneration, refresh). User edits
 * flip an isUserEdit flag so the next sync is skipped — the browser keeps
 * the caret where the user left it, and the existing <strong> wrapper
 * holds new characters that the user types inside the first line.
 *
 * The bold catches up on blur: we re-run buildBodyHtml against the current
 * text so the first line is correctly wrapped regardless of how the user
 * navigated/edited (e.g. backspacing across a line break).
 *
 * Paste is forced to plain text — without this, copying styled content
 * from Notion/Google Docs would drag fonts, colors, and links into the
 * post.
 */
export function RichBodyEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  onMouseDown,
  onClick,
  className,
}: RichBodyEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isUserEdit = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (isUserEdit.current) {
      isUserEdit.current = false
      return
    }
    if (domToText(el) !== value) {
      el.innerHTML = buildBodyHtml(value)
    }
  }, [value])

  const handleInput = () => {
    const el = ref.current
    if (!el) return
    isUserEdit.current = true
    onChange(domToText(el))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text/plain")
    if (!text) return
    // execCommand is deprecated in spec but still the most reliable cross-
    // browser way to insert text at the caret inside a contentEditable.
    document.execCommand("insertText", false, text)
  }

  const handleBlur = () => {
    const el = ref.current
    if (el) {
      el.innerHTML = buildBodyHtml(domToText(el))
    }
    onBlur?.()
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      dir="rtl"
      onInput={handleInput}
      onPaste={handlePaste}
      onFocus={onFocus}
      onBlur={handleBlur}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(
        "whitespace-pre-wrap break-words outline-none overflow-y-auto cursor-text",
        className,
      )}
    />
  )
}
