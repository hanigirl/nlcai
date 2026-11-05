"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Horizontal format lanes on the project canvas — REVIEW ONLY (Joey,
 * `joey/horizontal-format-lanes`). Mounted when /project carries
 * `?variant=a|b`; with no param the context is null and every component here
 * renders exactly the vertical tree that ships today.
 *
 *   פוסט ← פורמטים ←┬─ טוקינג הד ← סרטון ← קאבר
 *                    ├─ קרוסלה ← תמונות
 *                    └─ סטורי ← פריימים
 *
 * A — "עץ עם שדרה": bare orthogonal lines. The first lane continues the main
 *     row straight; the others hang off one vertical spine.
 * B — "מסלולים": every format sits in its own outlined lane, and the spine
 *     turns into each lane on a rounded elbow.
 */
export type LaneLayout = "a" | "b" | null

export const LaneLayoutContext = createContext<LaneLayout>(null)

export function useLaneLayout() {
  return useContext(LaneLayoutContext)
}

/** Card width shared with the page — every card in a lane is this wide. */
export const LANE_CARD_WIDTH = 346

/**
 * Where a connector meets a card, measured from the card's top. The main row
 * (idea → hooks → core post) already attaches at 55px; lanes keep that line.
 */
const ATTACH_Y = 55
/** B's lane outline pads the cards by this much on every side. */
const BAND_PAD = 20
/** Vertical space between two lanes. */
const LANE_GAP = 40
/** B's elbow radius. */
const ELBOW = 16

/**
 * The line between two cards of the same format. Vertical in the shipped tree,
 * horizontal (pointing to the next card on the left) in a lane.
 */
export function TreeConnector() {
  const lanes = useLaneLayout()
  if (!lanes) return <div className="w-[2px] h-7 bg-gray-80" />
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

/** The column that holds the lanes, one under the other. */
export function laneColumnClass(lanes: Exclude<LaneLayout, null>) {
  return "flex flex-col"
    + (lanes === "b" ? " -mt-5" : "") // B: the outline's padding sits above the row line
}

/**
 * One format: in the shipped tree a 346px column whose results stack DOWN;
 * in a lane, a row whose results run LEFT, wired into the shared spine.
 */
export function FormatColumn({
  index,
  count,
  children,
}: {
  index: number
  count: number
  children: ReactNode
}) {
  const lanes = useLaneLayout()
  if (!lanes) {
    return (
      <div className="flex flex-col items-center" style={{ width: LANE_CARD_WIDTH }}>
        {children}
      </div>
    )
  }

  const first = index === 0
  const last = index === count - 1
  // Where the spine meets this lane, from the lane's top edge.
  const y = lanes === "b" ? ATTACH_Y + BAND_PAD : ATTACH_Y

  // Cards inside a column are `w-full`; in a row that has nothing to be full
  // of, so every direct child is pinned to the card width instead.
  const row = (
    <div className="flex items-start [&>*]:shrink-0 [&>div.w-full]:w-[346px]">
      {children}
    </div>
  )

  return (
    <div
      className="relative flex items-start"
      style={{ paddingBottom: last ? 0 : LANE_GAP }}
    >
      {/* Spine — the part of it that belongs to this lane. */}
      {lanes === "a" && !first && (
        <div aria-hidden className="absolute start-0 top-0 w-[2px] bg-gray-80" style={{ height: y }} />
      )}
      {!last && (
        <div
          aria-hidden
          className="absolute start-0 bottom-0 w-[2px] bg-gray-80"
          style={{ top: lanes === "a" || first ? y : 0 }}
        />
      )}
      {lanes === "b" && !first && (
        <div
          aria-hidden
          className="absolute start-0 top-0 border-s-2 border-b-2 border-gray-80 rounded-es-2xl"
          style={{ height: y + 2, width: ELBOW }}
        />
      )}

      {/* Stub into the lane. B's elbow already covers its first 16px. */}
      <div
        aria-hidden
        className="h-[2px] shrink-0 bg-gray-80"
        style={{
          marginTop: y,
          marginInlineStart: lanes === "b" && !first ? ELBOW : 0,
          width: lanes === "b" && !first ? 40 - ELBOW : 40,
        }}
      />

      {lanes === "b" ? (
        <div
          className="rounded-[28px] border border-dashed border-gray-80 bg-gray-98/60 dark:bg-gray-10/40"
          style={{ padding: BAND_PAD }}
        >
          {row}
        </div>
      ) : (
        row
      )}
    </div>
  )
}
