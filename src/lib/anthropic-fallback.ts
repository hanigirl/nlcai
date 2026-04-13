export const PRIMARY_MODEL = "claude-sonnet-4-20250514"
export const FALLBACK_MODEL = "claude-haiku-4-5-20251001"

export function isOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /overloaded|529|503/i.test(msg)
}
