export const PRIMARY_MODEL = "claude-sonnet-4-6"
export const FALLBACK_MODEL = "claude-haiku-4-5-20251001"
// Used for reasoning-heavy tasks where Sonnet falls short — specifically the
// hook judge where logical coherence + curiosity-gap judgement matter. Costs
// ~5x Sonnet but catches logic breaks Sonnet misses.
export const JUDGE_MODEL = "claude-opus-4-7"

export function isOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /overloaded|529|503/i.test(msg)
}
