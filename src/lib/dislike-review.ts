/**
 * REVIEW-ONLY gate for the "לא אהבתי → עריכה עם AI" exploration (Joey,
 * 2026-10-29). Delete this file, and every call to it, when a variant ships.
 *
 *   ?dislike=a|b              which option mounts
 *   &state=idle|asking|generating|done|error   where the review lands
 *
 * Under the param nothing reaches the server: the 👍/👎 save and the AI edit
 * are simulated locally (no credits, no DB / storage writes).
 */
export type DislikeVariant = "a" | "b"
export type DislikeReviewState = "idle" | "asking" | "generating" | "done" | "error"

const STATES: DislikeReviewState[] = ["idle", "asking", "generating", "done", "error"]

export function getDislikeReview(): { variant: DislikeVariant; state: DislikeReviewState } | null {
  if (typeof window === "undefined") return null
  const p = new URLSearchParams(window.location.search)
  const v = p.get("dislike")
  if (v !== "a" && v !== "b") return null
  const s = p.get("state") as DislikeReviewState | null
  return { variant: v, state: s && STATES.includes(s) ? s : "idle" }
}

/** A fake AI edit: "generating" never finishes, "error" fails, else succeeds. */
export function simulateAiEdit(
  state: DislikeReviewState,
): Promise<{ ok: true; remembered?: string | null } | { ok: false; message: string }> {
  if (state === "generating") return new Promise(() => {})
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          state === "error"
            ? { ok: false, message: "העריכה לא הצליחה הפעם. אפשר לנסות שוב, או לנסח את הבקשה אחרת." }
            : { ok: true, remembered: "פחות עומס בשקופיות, צבעי המותג במקום צבעים חזקים" },
        ),
      1400,
    ),
  )
}
