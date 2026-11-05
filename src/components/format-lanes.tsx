import type { ReactNode } from "react"

/**
 * Format lanes on the project canvas. The flow only ever runs sideways (RTL):
 *
 *   פוסט ← פורמטים ←┬─ [ דיבור למצלמה ← וידאו ← קאבר ]
 *                    ├─ [ קרוסלה ← שקופיות ]
 *                    └─ [ סטורי ← פריימים ]
 *
 * Every format sits in its own outlined lane; lanes stack one above the other,
 * and inside a lane each new card lands to the LEFT of the one before it. One
 * spine runs down from the formats card and turns into each lane on a rounded
 * elbow. (Picked by Hani as "מסלולים" over a bare-lines tree, 2026-11-05.)
 */

/** Every card in a lane is this wide. */
export const LANE_CARD_WIDTH = 346

/**
 * Where a connector meets a card, measured from the card's top. The main row
 * (idea → hooks → core post → formats) attaches at 55px; lanes keep that line.
 */
const ATTACH_Y = 55
/** The lane outline pads its cards by this much on every side. */
const LANE_PAD = 20
/** Vertical space between two lanes. */
const LANE_GAP = 40
/** Elbow radius where the spine turns into a lane. */
const ELBOW = 16
/** Length of the line from the spine into a lane. */
const STUB = 40

/** The line between two cards of the same lane, pointing at the next card. */
export function TreeConnector() {
  return (
    <div
      aria-hidden
      className="h-[2px] w-7 shrink-0 bg-gray-80"
      style={{ marginTop: ATTACH_Y }}
    />
  )
}

/** The short line out of the formats card into the fork. */
export function LaneStem() {
  return (
    <div
      aria-hidden
      className="h-[2px] w-10 shrink-0 bg-gray-80"
      style={{ marginTop: ATTACH_Y }}
    />
  )
}

/**
 * The column that holds the lanes. Pulled up by the lane padding so the first
 * lane's cards sit on the same row line as the formats card.
 */
export function LaneColumn({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col" style={{ marginTop: -LANE_PAD }} dir="rtl">
      {children}
    </div>
  )
}

/**
 * One format's lane: its cards in a row, wired into the shared spine.
 * `data-lane` / `data-lane-row` let the page find the lane's newest card.
 */
export function FormatLane({
  fid,
  index,
  count,
  children,
}: {
  fid: string
  index: number
  count: number
  children: ReactNode
}) {
  const first = index === 0
  const last = index === count - 1
  // Where the spine meets this lane, from the lane's top edge.
  const y = ATTACH_Y + LANE_PAD

  return (
    <div
      data-lane={fid}
      className="relative flex items-start"
      style={{ paddingBottom: last ? 0 : LANE_GAP }}
    >
      {/* The spine — the stretch of it that belongs to this lane. */}
      {!last && (
        <div
          aria-hidden
          className="absolute start-0 bottom-0 w-[2px] bg-gray-80"
          style={{ top: first ? y : 0 }}
        />
      )}
      {!first && (
        <div
          aria-hidden
          className="absolute start-0 top-0 border-s-2 border-b-2 border-gray-80 rounded-es-2xl"
          style={{ height: y + 2, width: ELBOW }}
        />
      )}

      {/* Into the lane. Past the first lane the elbow covers its first 16px. */}
      <div
        aria-hidden
        className="h-[2px] shrink-0 bg-gray-80"
        style={{
          marginTop: y,
          marginInlineStart: first ? 0 : ELBOW,
          width: first ? STUB : STUB - ELBOW,
        }}
      />

      {/* Soft outline, exactly as Hani approved it in review (2026-11-05). */}
      <div
        className="rounded-[28px] border border-dashed border-gray-80 bg-gray-98/60 dark:bg-gray-10/40"
        style={{ padding: LANE_PAD }}
      >
        {/* Cards are written `w-full` (they used to stack in a column); in a
            row each one is pinned to the card width instead. */}
        <div data-lane-row className="flex items-start [&>*]:shrink-0 [&>div.w-full]:w-[346px]">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The card a lane is working on right now: its last card — cards only ever
 * land at the far (left) end of a lane. Connectors are aria-hidden.
 */
export function newestLaneCard(fid: string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`[data-lane="${fid}"] [data-lane-row]`)
  if (!row) return null
  const cards = Array.from(row.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.hasAttribute("aria-hidden"),
  )
  return cards[cards.length - 1] ?? null
}

/** A lane's own format card — its first card (the format's text). */
export function laneFormatCard(fid: string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`[data-lane="${fid}"] [data-lane-row]`)
  if (!row) return null
  return (
    Array.from(row.children).find(
      (c): c is HTMLElement => c instanceof HTMLElement && !c.hasAttribute("aria-hidden"),
    ) ?? null
  )
}

/**
 * Take her to a format's card (Hani, 2026-11-05: a ✓ format in "לאיזה
 * פורמטים לשכפל?" jumps to its card). The same canvas glide as the lanes'
 * auto-follow; two frames first so a layout change (the picker closing) has
 * settled before the card is measured.
 */
export function goToLaneCard(
  canvas: { focusOn: (el: HTMLElement, opts?: { mode?: "centre" | "follow" }) => void } | null,
  fid: string,
) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const card = laneFormatCard(fid)
      // "centre", not "follow": she asked to go there — follow mode stands
      // down right after her own click on the canvas.
      if (card) canvas?.focusOn(card, { mode: "centre" })
    }),
  )
}
