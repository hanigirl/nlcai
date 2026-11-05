"use client"

import { useSyncExternalStore } from "react"
import { MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * "לדבר איתו קודם" (Hani, 2026-11-05): "גם כשאני יוצרת מהשפה הוויזואלית שלי,
 * אני רוצה אפשרות לדבר איתו קודם, אולי בא לי להוסיף לו תמונת רפרנס או קישור
 * לפני שהוא מתחיל לעבוד".
 *
 * With any tile but "חדש לגמרי" the generate button still generates at once —
 * that stays the quick default. Talking first opens the AI panel on "איך
 * תרצו להתחיל?" in that style (lib/ai-edit-intent, `style`).
 *
 * REVIEW (joey/talk-first-visual-language): two places for that option, behind
 * `?talk=a|b` on /project; with no param nothing changes.
 *   a — a second, quieter button under the generate button: a one-off choice
 *       made at the moment of generating.
 *   b — a checkbox under the tiles that turns the generate button into
 *       "פתיחת שיחה עם AI": a habit, remembered on this device.
 */
export type TalkFirstVariant = "a" | "b"

const noSubscribe = () => () => {}

/** Review gate: `?talk=a|b` on the page URL. null = as in production. */
export function useTalkFirstVariant(override?: TalkFirstVariant | null): TalkFirstVariant | null {
  const fromUrl = useSyncExternalStore(
    noSubscribe,
    () => {
      const v = new URLSearchParams(window.location.search).get("talk")
      return v === "a" || v === "b" ? v : null
    },
    () => null,
  )
  return override !== undefined ? override : fromUrl
}

const STORAGE_KEY = "nlc:talk-first"
const habitListeners = new Set<() => void>()

function readHabit(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false // storage blocked — starts off
  }
}

/** Variant b's checkbox — remembered on this device (a convenience, not a setting). */
export function useTalkFirstHabit(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      habitListeners.add(cb)
      return () => habitListeners.delete(cb)
    },
    readHabit,
    () => false,
  )
  const set = (next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {
      /* not remembered — fine */
    }
    habitListeners.forEach((l) => l())
  }
  return [on, set]
}

/**
 * Everything a media card needs: whether the generate button asks first, and
 * the control to render. `blank` = "חדש לגמרי" picked: it always asks, so no
 * option is shown.
 */
export function useTalkFirst(override?: TalkFirstVariant | null) {
  const variant = useTalkFirstVariant(override)
  const [habit, setHabit] = useTalkFirstHabit()
  return {
    variant,
    /** b: the generate button opens the conversation. */
    askFirst: variant === "b" && habit,
    habit,
    setHabit,
  }
}
export type TalkFirst = ReturnType<typeof useTalkFirst>

/** The generate button's label under variant b's checkbox. */
export const TALK_FIRST_BUTTON = "פתיחת שיחה עם AI"

/** a — the quieter second button, under the generate button. */
export function TalkFirstButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="w-full gap-1.5 text-text-primary-default"
    >
      <MessageCircle className="size-3.5" aria-hidden />
      לדבר עם ה-AI קודם
    </Button>
  )
}

/** b — the checkbox under the tiles. */
export function TalkFirstCheckbox({
  checked,
  onCheckedChange,
  id = "talk-first",
}: {
  checked: boolean
  onCheckedChange: (on: boolean) => void
  id?: string
}) {
  return (
    <div className="flex w-full items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5 text-start">
        <span className="text-xs text-text-primary-default">לדבר עם ה-AI לפני שהוא מתחיל</span>
        <span className="text-xs text-text-neutral-default">להוסיף תמונת רפרנס, קישור או כמה מילים</span>
      </label>
    </div>
  )
}

/**
 * The control in its place for the variant. `blank` hides it ("חדש לגמרי"
 * always asks). Variant a renders under the generate button, b above it —
 * the card passes `slot` for where it is rendering.
 */
export function TalkFirstControl({
  talk,
  slot,
  blank,
  disabled,
  onTalk,
  id,
}: {
  talk: TalkFirst
  slot: "above" | "below"
  blank: boolean
  disabled?: boolean
  onTalk: () => void
  id?: string
}) {
  if (!talk.variant || blank) return null
  if (talk.variant === "a" && slot === "below") return <TalkFirstButton onClick={onTalk} disabled={disabled} />
  if (talk.variant === "b" && slot === "above")
    return <TalkFirstCheckbox id={id} checked={talk.habit} onCheckedChange={talk.setHabit} />
  return null
}
