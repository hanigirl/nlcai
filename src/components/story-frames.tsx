"use client"

import { useState } from "react"
import { Merge, Plus } from "lucide-react"
import { RichBodyEditor } from "@/components/rich-body-editor"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { MAX_STORY_SCRIPT_FRAMES, removeStorySplit, sectionsToScript, storySections } from "@/lib/story-text-split"

/**
 * The story card's text, as the stories it becomes — Hani's design
 * (2026-11-05): a grey "סטורי 1" label (not editable, not part of her text),
 * the story's text under it as usual, a divider, "סטורי 2", and so on.
 * Right-click: "הוספת סטורי" adds one at the end; "איחוד סטורי N עם N-1"
 * removes the split before the story she right-clicked — her text joins the
 * story before it (story 1's joins story 2), never deleted. Offered while
 * more than one story is left.
 *
 * The sections are the generator's own split (lib/story-text-split), and
 * what she changes is saved with the "סטורי N" lines that split reads — those
 * lines live only in the card: they are stripped from every picture, caption
 * and copy.
 */
export function StorySections({
  value,
  onChange,
  onFocus,
  onBlur,
  textClassName,
}: {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  /** The card's text look (size, leading, selection); no border of its own. */
  textClassName?: string
}) {
  const sections = storySections(value)
  const shown = sections.length ? sections : [""]
  // The story she right-clicked — the one "מחיקה" acts on.
  const [target, setTarget] = useState(0)
  const set = (next: string[]) => onChange(sectionsToScript(next))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex flex-col">
          {shown.map((text, i) => (
            <div
              key={i}
              onContextMenu={() => setTarget(i)}
              className={i > 0 ? "mt-3 border-t border-border-neutral-default pt-3" : undefined}
            >
              {/* Not editable, not part of her text. */}
              <p className="mb-1 select-none text-xs-body text-text-neutral-default">
                סטורי {i + 1}
              </p>
              <RichBodyEditor
                value={text}
                onChange={(t) => set(shown.map((s, j) => (j === i ? t : s)))}
                onFocus={onFocus}
                onBlur={onBlur}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                // Only story 1 opens with the hook.
                boldFirstLine={i === 0}
                placeholder={i === 0 ? undefined : "כתבו כאן את הטקסט לסטורי"}
                className={textClassName}
              />
            </div>
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={shown.length >= MAX_STORY_SCRIPT_FRAMES}
          onSelect={() => set([...shown, ""])}
        >
          <Plus className="text-text-neutral-default" />
          הוספת סטורי
        </ContextMenuItem>
        {shown.length > 1 && (
          // Removes the split, never her words: the text joins the story
          // before it (story 1's joins the next one).
          <ContextMenuItem onSelect={() => set(removeStorySplit(shown, target))}>
            <Merge className="text-text-neutral-default" />
            {target === 0 ? "איחוד סטורי 1 עם 2" : `איחוד סטורי ${target + 1} עם ${target}`}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
