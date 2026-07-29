"use client"

/**
 * DriveMediaLinks — the "one Drive link per frame, in order" field.
 *
 * Extracted from the carousel panel so the story can use the exact same
 * mechanic (Hani, 2026-07-28: "בדיוק באותה לוגיקה של שקופיות בקרוסלה").
 * Sharing the component rather than copying it is the point — the row/media
 * pairing rules below are subtle, and two divergent copies would drift.
 *
 * The contract in one line: **row i owns media item i**. That drives
 * everything —
 *   - Dragging a row reorders the saved media, not just the text field.
 *   - Rows are padded to the media count, so a set that arrived without links
 *     (imported before links were persisted) still has a handle per item.
 *   - An interior blank row is preserved on save; only trailing blanks are
 *     dropped. Collapsing a gap in the middle would silently re-point every
 *     link below it at a different item.
 *
 * The host owns the import itself (each format assembles its media
 * differently) and owns persistence of the link list. This component owns the
 * rows on screen, the drag, and the pairing maths.
 */

import { useEffect, useRef, useState } from "react"
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isCompleteDriveUrl } from "@/lib/drive-media"

export type DriveMediaLinksProps = {
  /** Persisted link list for this (post, format). Null when none saved. */
  savedLinks: string[] | null
  /** Persist the list. Called on every row mutation. */
  onSaveLinks: (links: string[] | null) => void
  /**
   * The media currently saved for this format, in order. Row i pairs with
   * item i. Null/empty when the format has no media yet.
   */
  items: string[] | null
  /**
   * True when reordering rows should reorder `items`. Hosts set this false
   * when the media didn't come from these links (e.g. a carousel generated
   * from a template), so a drag only rearranges the form.
   */
  pairItems: boolean
  /** Hand back the reordered media set. Only fires when `pairItems`. */
  onItemsReorder: (items: string[]) => void
  /**
   * Kick off the import. Receives ALL rows in order, trimmed, blanks
   * included — position is meaningful, and a host that already has media
   * needs to know WHICH rows changed so it can keep the rest. Hosts whose
   * media comes only from links can just filter the blanks out.
   */
  onImport: (rows: string[]) => void
  importing: boolean
  /** Progress line shown inside the import button while it runs. */
  importProgress?: string
  importError?: string | null
  onImportErrorClear?: () => void
  /** Section heading, e.g. "ייבוא שקופיות מגוגל דרייב". */
  heading: string
  /** Explainer under the heading. */
  helpText: string
  /** Singular unit for a11y labels, e.g. "שקופית" / "סטורי". */
  unitLabel: string
  /** Add-a-row link text, e.g. "הוסיפו שקופית". */
  addRowLabel: string
  /** Import button text. */
  importLabel: string
  /**
   * Optional sentence shown only when a drag will actually move media.
   * Omit it where the grip icon is explanation enough — the line is a
   * permanent cost paid for a one-time lesson.
   */
  reorderHint?: string
  maxRows?: number
  /**
   * Load as soon as a row holds a complete Drive link, with no button
   * (Hani, 2026-07-29). Pasting a link IS the instruction — a "load" button
   * next to it is a second way to say the same thing. The button still shows
   * when this is off, for hosts whose import is expensive enough to want an
   * explicit trigger.
   */
  autoImport?: boolean
  /**
   * Slot rendered between the explainer and the rows — hosts use it for the
   * "here's what you already imported" tile, which belongs under the heading
   * but above the link list.
   */
  beforeRows?: React.ReactNode
}

export function DriveMediaLinks({
  savedLinks,
  onSaveLinks,
  items,
  pairItems,
  onItemsReorder,
  onImport,
  importing,
  importProgress = "",
  importError = null,
  onImportErrorClear,
  heading,
  helpText,
  unitLabel,
  addRowLabel,
  importLabel,
  reorderHint,
  maxRows = 10,
  autoImport = false,
  beforeRows,
}: DriveMediaLinksProps) {
  // Rows are DERIVED, not synced. `edited` is null until she touches the
  // form; while it's null the rows come straight from the persisted list, so
  // a post that finishes loading after this mounts just appears — no effect
  // racing the async GET and overwriting what she may have typed.
  const [edited, setEdited] = useState<string[] | null>(null)

  // A single-slot field (b-roll: one clip) starts with exactly one row and
  // never grows; a multi-frame field keeps a spare so the form doesn't
  // collapse to a lone input.
  const singleSlot = maxRows === 1
  const baseRows =
    edited ??
    (savedLinks && savedLinks.length > 0
      ? singleSlot
        ? [savedLinks[0]]
        : [...savedLinks, ...(savedLinks.length === 1 ? [""] : [])]
      : singleSlot
        ? [""]
        : ["", ""])

  // One handle per media item, even when there are no links to show. Without
  // this a 5-item set with no saved links renders the two default blank rows,
  // leaving items 3-5 with nothing to grab. Padding here rather than in state
  // keeps it a pure function of (links, items).
  const rows =
    !singleSlot && items && items.length > baseRows.length
      ? [...baseRows, ...Array(items.length - baseRows.length).fill("")]
      : baseRows

  // Single write path, so every mutation persists.
  const commit = (next: string[]) => {
    setEdited(next)
    const trimmed = next.map((l) => l.trim())
    while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop()
    onSaveLinks(trimmed.length > 0 ? trimmed : null)
  }

  const setRow = (i: number, v: string) =>
    commit(rows.map((l, idx) => (idx === i ? v : l)))
  // Adding a blank row changes nothing worth persisting, so it only touches
  // local state — but it must snapshot `rows` so the padding isn't lost.
  const addRow = () =>
    setEdited(rows.length >= maxRows ? rows : [...rows, ""])
  const removeRow = (i: number) => commit(rows.filter((_, idx) => idx !== i))

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const canPair = pairItems && !!items && items.length > 0 && rows.length >= items.length

  const moveRow = (from: number, to: number) => {
    if (from === to) return

    // Pair every row with the item at the same position, move the pair, then
    // read the items back off in the new row order. One splice, no index
    // arithmetic to get wrong. Rows past the last item own nothing, so
    // dragging one of those leaves the media untouched.
    const paired = rows.map((link, idx) => ({
      link,
      item: canPair && items ? (items[idx] ?? null) : null,
    }))
    const [moved] = paired.splice(from, 1)
    paired.splice(to, 0, moved)

    commit(paired.map((r) => r.link))

    if (!canPair || !items) return
    const next = paired
      .map((r) => r.item)
      .filter((item): item is string => !!item)
    if (next.length !== items.length) return
    onItemsReorder(next)
  }

  const trimmedRows = rows.map((l) => l.trim())
  const hasAnyLink = trimmedRows.some(Boolean)

  // Fire the import once a row holds a complete Drive link and typing has
  // settled. Keyed on the joined links so a reorder (same links, new order)
  // doesn't re-pull anything — reordering is handled by `onItemsReorder`.
  const autoKey = trimmedRows.join("|")
  const lastAutoKeyRef = useRef<string | null>(null)
  const importingRef = useRef(importing)
  importingRef.current = importing
  useEffect(() => {
    if (!autoImport) return
    if (!trimmedRows.some((l) => isCompleteDriveUrl(l))) return
    if (lastAutoKeyRef.current === autoKey) return
    const t = setTimeout(() => {
      // Re-check at fire time: an import that started while we were waiting
      // would otherwise get a second one stacked on top of it.
      if (importingRef.current) return
      lastAutoKeyRef.current = autoKey
      onImport(trimmedRows)
    }, 900)
    return () => clearTimeout(t)
    // `onImport` is a fresh closure each render; depending on it would reset
    // the debounce on every keystroke and never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport, autoKey])

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small-bold text-text-primary-default">{heading}</p>
      <p className="text-xs-body text-text-neutral-default">{helpText}</p>

      {beforeRows}

      {canPair && reorderHint && (
        <p className="text-xs-body text-text-neutral-default">{reorderHint}</p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((link, i) => (
          <div
            key={i}
            // Row-level drop target. The row is not itself draggable — only
            // the grip is — so dragging inside the URL field still selects
            // text instead of picking the row up.
            onDragOver={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = "move"
              setDragOverIndex(i)
            }}
            onDragLeave={() => {
              setDragOverIndex((cur) => (cur === i ? null : cur))
            }}
            onDrop={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              moveRow(dragIndex, i)
              setDragIndex(null)
              setDragOverIndex(null)
            }}
            className={`flex items-center gap-2 rounded-lg transition-colors ${
              dragOverIndex === i && dragIndex !== i ? "bg-gray-90" : ""
            } ${dragIndex === i ? "opacity-50" : ""}`}
          >
            {/* Drag handle, doubling as the position number so the row doesn't
                grow a column — the number IS what you grab, which matches
                "row 3 is item 3".
                A <span>, not a <button>: Chrome gives a button's own
                mousedown behaviour priority over `draggable`, so the drag
                never started. role/tabIndex keep it operable, and the arrow
                keys do the same job without a mouse. */}
            {!singleSlot && (
            <span
              role="button"
              tabIndex={0}
              draggable={!importing && rows.length > 1}
              onDragStart={(e) => {
                // Firefox refuses to begin a drag unless dataTransfer carries
                // a payload, even one nothing reads.
                e.dataTransfer.setData("text/plain", String(i))
                e.dataTransfer.effectAllowed = "move"
                setDragIndex(i)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setDragOverIndex(null)
              }}
              onKeyDown={(e) => {
                if (importing) return
                if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault()
                  moveRow(i, i - 1)
                } else if (e.key === "ArrowDown" && i < rows.length - 1) {
                  e.preventDefault()
                  moveRow(i, i + 1)
                }
              }}
              aria-label={`${unitLabel} ${i + 1} — גררו או השתמשו בחצים למעלה/למטה כדי לשנות את הסדר`}
              title="גררו כדי לשנות את הסדר"
              className={`inline-flex w-6 shrink-0 select-none items-center justify-center gap-0.5 rounded-md py-1 text-xs text-text-neutral-default transition-colors hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 ${
                importing || rows.length < 2
                  ? "cursor-default opacity-40"
                  : "cursor-grab active:cursor-grabbing"
              }`}
            >
              <GripVertical className="size-3" aria-hidden />
              {i + 1}
            </span>
            )}
            <Input
              dir="ltr"
              inputSize="small"
              type="url"
              value={link}
              onChange={(e) => {
                setRow(i, e.target.value)
                if (importError) onImportErrorClear?.()
              }}
              placeholder="https://drive.google.com/file/d/..."
              disabled={importing}
              className="flex-1 text-xs"
              aria-label={`קישור ל${unitLabel} ${i + 1}`}
            />
            {(rows.length > 1 || singleSlot) && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={importing}
                aria-label={`הסירו את ${unitLabel} ${i + 1}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-neutral-default transition-colors hover:bg-bg-surface hover:text-button-destructive-default disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {rows.length < maxRows && (
        <button
          type="button"
          onClick={addRow}
          disabled={importing}
          className="inline-flex items-center gap-1 self-start text-xs font-medium text-text-primary-default transition-colors hover:text-text-primary-default/70 disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          {addRowLabel}
        </button>
      )}

      {autoImport ? (
        // No button — but the work still has to be visible, or a paste looks
        // like it did nothing for the ten seconds the pull takes.
        importing && (
          <p className="inline-flex items-center gap-2 self-start text-xs text-text-neutral-default">
            <Loader2 className="size-3.5 animate-spin" />
            {importProgress || "טוען..."}
          </p>
        )
      ) : (
        <Button
          onClick={() => onImport(trimmedRows)}
          disabled={importing || !hasAnyLink}
          variant="outline"
          className="w-full gap-2"
        >
          {importing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {importProgress || "טוען..."}
            </>
          ) : (
            importLabel
          )}
        </Button>
      )}

      {importError && (
        <p className="text-xs text-button-destructive-default">{importError}</p>
      )}
    </div>
  )
}
