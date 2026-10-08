import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * How a round's 6 hooks are split across source families — learned from
 * what she does with the hooks, instead of a fixed "3 from the transcripts"
 * that wears the material out and never asks whether she likes it
 * (Hani, 2026-10-08).
 *
 *   knowledge — her transcripts / documents (business_sources insights)
 *   product   — an audience pain her product solves
 *   audience  — a pain / desire from the audience research
 *   creator   — field ideas: ⭐ favorites first, then creators, then trends
 *
 * Signal per hook (hooks.source_kind, migration 040): a star or turning it
 * into a post is positive, deleting it is negative, leaving it alone is
 * neutral. Each family's score is a smoothed like-rate over its recent
 * hooks, so one round can't swing the mix; every family with material keeps
 * at least one slot so it keeps getting tested.
 */

export const SOURCE_KINDS = ["knowledge", "product", "audience", "creator"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Starting split for 6 — her plan: 3 transcripts · 2 product/audience · 1 field. */
const BASE: Record<SourceKind, number> = { knowledge: 3, product: 1, audience: 1, creator: 1 }
const MAX_PER_KIND = 4
const RECENT_HOOKS = 40

type Row = { source_kind: string | null; is_favorite: boolean | null; is_used: boolean | null; deleted_at: string | null }

export type SourceMix = {
  slots: Record<SourceKind, number>
  /** Smoothed like-rate per family, for the log. 0.5 = no signal yet. */
  scores: Record<SourceKind, number>
}

export async function computeSourceMix(
  supabase: SupabaseClient,
  userId: string,
  available: Record<SourceKind, boolean>,
  total: number,
): Promise<SourceMix> {
  const { data } = await supabase
    .from("hooks")
    .select("source_kind, is_favorite, is_used, deleted_at")
    .eq("user_id", userId)
    .not("source_kind", "is", null)
    .order("created_at", { ascending: false })
    .limit(RECENT_HOOKS)

  const stats = Object.fromEntries(SOURCE_KINDS.map((k) => [k, { n: 0, pos: 0, neg: 0 }])) as Record<
    SourceKind,
    { n: number; pos: number; neg: number }
  >
  for (const r of (data as Row[] | null) ?? []) {
    const k = r.source_kind as SourceKind
    if (!stats[k]) continue
    stats[k].n++
    if (r.deleted_at) stats[k].neg++
    else if (r.is_favorite || r.is_used) stats[k].pos++
  }

  // Beta(1,1)-smoothed: no data → 0.5; a deletion counts against the family.
  const scores = Object.fromEntries(
    SOURCE_KINDS.map((k) => {
      const s = stats[k]
      return [k, (s.pos + 1) / (s.n + s.neg + 2)]
    }),
  ) as Record<SourceKind, number>

  const kinds = SOURCE_KINDS.filter((k) => available[k])
  const slots = Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0])) as Record<SourceKind, number>
  if (kinds.length === 0) return { slots, scores }

  // Everyone with material gets one, so nothing stops being tested.
  let left = total
  for (const k of kinds) {
    if (left === 0) break
    slots[k] = 1
    left--
  }

  // The rest by weight = base share × (score relative to "no signal"),
  // largest remainder, capped per family.
  const weight = (k: SourceKind) => BASE[k] * (scores[k] / 0.5)
  while (left > 0) {
    const open = kinds.filter((k) => slots[k] < MAX_PER_KIND)
    if (open.length === 0) break
    const sum = open.reduce((a, k) => a + weight(k), 0)
    // Pick the family furthest below its fair share.
    const target = (k: SourceKind) => (weight(k) / sum) * total
    open.sort((a, b) => target(b) - slots[b] - (target(a) - slots[a]))
    slots[open[0]]++
    left--
  }
  return { slots, scores }
}
