"use client"

/**
 * State preview for the project canvas's format lanes.
 *
 * Route: /test/format-lanes — the lane layout /project uses after "שכפל!",
 * built from the real lane pieces (FormatLane, LaneColumn, LaneStem,
 * TreeConnector) and the real InfiniteCanvas, with stand-in cards of the same
 * size and chrome. No fetches, no DB.
 *
 *   ?state=full   — three lanes, every card landed (default)
 *   ?state=single — one format only
 *   ?state=live   — cards land one by one; the canvas follows each new card
 *                   (drag the canvas mid-run: it stops following while you do)
 *   ?state=jump   — the real "לאיזה פורמטים לשכפל?" tiles: pressing a ✓
 *                   (already duplicated) format closes the picker and glides
 *                   to that format's card (Hani, 2026-11-05).
 *                   "שיכפול לפורמטים" on the core post opens it again.
 */

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Layers, Smartphone, Video, ImageIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@/components/infinite-canvas"
import { FormatLane, LaneColumn, LaneStem, TreeConnector, goToLaneCard, newestLaneCard } from "@/components/format-lanes"
import { SelectionCard } from "@/components/selection-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type Card = { title: string; icon: LucideIcon; tall?: boolean; loading?: boolean }
type Lane = { fid: string; cards: Card[] }

const FULL: Lane[] = [
  {
    fid: "talking_head",
    cards: [
      { title: "דיבור למצלמה", icon: Video },
      { title: "הוידאו שלכם", icon: Video, tall: true },
      { title: "קאבר", icon: ImageIcon, tall: true },
    ],
  },
  { fid: "carousel", cards: [{ title: "קרוסלה", icon: Layers }, { title: "הקרוסלה שלכם", icon: Layers, tall: true }] },
  { fid: "story", cards: [{ title: "סטורי", icon: Smartphone }, { title: "הסטורי שלכם", icon: Smartphone, tall: true }] },
]

/** `live`: how many cards each lane shows at each step, and which one is still loading. */
const LIVE_STEPS: { counts: number[]; loading?: [number, number] }[] = [
  { counts: [1, 0, 0] },
  { counts: [1, 1, 1] },
  { counts: [2, 1, 1], loading: [0, 1] },
  { counts: [2, 1, 1] },
  { counts: [3, 1, 1], loading: [0, 2] },
  { counts: [3, 1, 1] },
  { counts: [3, 2, 1], loading: [1, 1] },
  { counts: [3, 2, 1] },
  { counts: [3, 2, 2], loading: [2, 1] },
  { counts: [3, 2, 2] },
]
const STEP_MS = 1800

function StandInCard({ title, icon: Icon, tall, loading }: Card) {
  return (
    <div
      dir="rtl"
      className="flex flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white dark:bg-gray-10 pb-6 w-full"
    >
      <div
        className={`flex items-center gap-2 px-6 py-3 rounded-t-[20px] ${loading ? "bg-bg-surface-primary-default-80" : "bg-bg-surface"}`}
      >
        <span className="text-p-bold text-text-primary-default">{title}</span>
        <Icon className="size-4 text-text-neutral-default" />
      </div>
      <div className="px-6 flex flex-col items-center gap-3">
        {loading ? (
          <Skeleton className="w-[200px] aspect-[9/16] rounded-xl" />
        ) : (
          <div
            className={`w-full rounded-[10px] border border-border-neutral-default ${tall ? "h-[360px]" : "h-[200px]"}`}
          />
        )}
      </div>
    </div>
  )
}

function LanesPreview() {
  const state = useSearchParams().get("state") ?? "full"
  const canvasRef = useRef<InfiniteCanvasHandle>(null)
  const [step, setStep] = useState(0)
  // jump: the picker is open until a ✓ format is pressed.
  const [pickerOpen, setPickerOpen] = useState(true)

  useEffect(() => {
    if (state !== "live") return
    const t = window.setInterval(() => setStep((n) => (n + 1) % (LIVE_STEPS.length + 2)), STEP_MS)
    return () => window.clearInterval(t)
  }, [state])

  const live = LIVE_STEPS[Math.min(step, LIVE_STEPS.length - 1)]
  const lanes: Lane[] =
    state === "single"
      ? FULL.slice(0, 1)
      : state === "live"
        ? FULL.map((lane, li) => ({
            ...lane,
            cards: lane.cards.slice(0, live.counts[li]).map((c, ci) => ({
              ...c,
              loading: live.loading?.[0] === li && live.loading?.[1] === ci,
            })),
          })).filter((l) => l.cards.length > 0)
        : FULL

  // The same follow call /project makes when a lane gains or starts a card.
  const prevKey = useRef<string>("")
  const key = JSON.stringify(lanes.map((l) => [l.fid, l.cards.length, l.cards.some((c) => c.loading)]))
  useEffect(() => {
    if (state !== "live") return
    const prev = prevKey.current ? (JSON.parse(prevKey.current) as [string, number, boolean][]) : []
    prevKey.current = key
    const target = (JSON.parse(key) as [string, number, boolean][]).find(([fid, n, busy]) => {
      const p = prev.find((x) => x[0] === fid)
      return !p || n > p[1] || (busy && !p[2])
    })?.[0]
    if (!target) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const card = newestLaneCard(target)
        if (card) canvasRef.current?.focusOn(card, { mode: "follow" })
      }),
    )
  }, [key, state])

  return (
    <div className="h-screen w-full">
      <InfiniteCanvas handleRef={canvasRef}>
        <div className="flex items-start gap-0 pt-24 pr-24" dir="rtl">
          <div className="flex w-[346px] shrink-0 flex-col gap-2 [&>div]:w-full">
            <StandInCard title="פוסט ליבה" icon={Layers} />
            {state === "jump" && (
              <Button onClick={() => setPickerOpen(true)}>שיכפול לפורמטים</Button>
            )}
          </div>
          {(state !== "jump" || pickerOpen) && (
            <>
              <div className="flex items-center mt-[55px] shrink-0">
                <div className="h-[2px] w-7 bg-gray-80" />
              </div>
              {state === "jump" ? (
                <DuplicatePicker
                  duplicated={lanes.map((l) => l.fid)}
                  onJump={(fid) => {
                    setPickerOpen(false)
                    goToLaneCard(canvasRef.current, fid)
                  }}
                />
              ) : (
                <div className="w-[346px] shrink-0 [&>div]:w-full">
                  <StandInCard title="לאיזה פורמטים לשכפל?" icon={Layers} />
                </div>
              )}
            </>
          )}
          <div className="flex items-start" dir="rtl">
            <LaneStem />
            <LaneColumn>
              {lanes.map((lane, i) => (
                <FormatLane key={lane.fid} fid={lane.fid} index={i} count={lanes.length}>
                  {lane.cards.map((c, ci) => (
                    <LaneCard key={c.title} card={c} first={ci === 0} />
                  ))}
                </FormatLane>
              ))}
            </LaneColumn>
          </div>
        </div>
      </InfiniteCanvas>
    </div>
  )
}

const PICKER_FORMATS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "talking_head", label: "דיבור למצלמה", icon: Video },
  { id: "carousel", label: "קרוסלה", icon: Layers },
  { id: "story", label: "סטורי", icon: Smartphone },
  { id: "image_post", label: "פוסט תמונה", icon: ImageIcon },
]

/** The canvas's "לאיזה פורמטים לשכפל?" card, as /project draws it. */
function DuplicatePicker({ duplicated, onJump }: { duplicated: string[]; onJump: (fid: string) => void }) {
  return (
    <div
      dir="rtl"
      className="flex w-[567px] shrink-0 flex-col gap-3 rounded-[20px] border border-border-neutral-default bg-white pb-6 dark:bg-gray-10"
    >
      <div className="flex items-center rounded-t-[20px] bg-bg-surface px-6 py-3">
        <span className="text-p-bold text-text-primary-default">לאיזה פורמטים לשכפל?</span>
      </div>
      <div className="grid grid-cols-2 gap-3 px-6">
        {PICKER_FORMATS.map((f) => {
          const done = duplicated.includes(f.id)
          return (
            <div key={f.id} title={done ? `${f.label} כבר שוכפל, מעבר לכרטיס` : undefined}>
              <SelectionCard
                description={f.label}
                icon={<f.icon className="size-4" />}
                isSelected={done}
                onSelect={() => done && onJump(f.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LaneCard({ card, first }: { card: Card; first: boolean }) {
  return (
    <>
      {!first && <TreeConnector />}
      <StandInCard {...card} />
    </>
  )
}

export default function FormatLanesPreviewPage() {
  return (
    <Suspense fallback={null}>
      <LanesPreview />
    </Suspense>
  )
}
