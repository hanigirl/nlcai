/**
 * The cut pass's summary for the chat (lib/talking-head-cuts) — client-safe.
 * Plural address, short (Hani, 2026-11-08).
 */
export type CutStats = { fillers: number; silence: number; before: number; after: number }

/** What she reads about the cuts, in the chat. */
export function cutMessage(stats: CutStats | null): string {
  if (!stats) return "הקאטים כבר טובים, לא נגענו."
  const s = Math.round(stats.silence)
  const parts = [
    stats.fillers ? `${stats.fillers === 1 ? "״אממ״ אחד" : `${stats.fillers} ״אממ״`}` : "",
    s >= 1 ? `${s === 1 ? "שנייה" : `${s} שניות`} של שקט` : "",
  ].filter(Boolean)
  const what = parts.length ? `הורדנו ${parts.join(" ו-")}` : "הידקנו את הקצב"
  return `${what}, הסרטון עכשיו ${Math.round(stats.after)} שניות במקום ${Math.round(stats.before)}.`
}
