"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { Check, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { userKey } from "@/lib/user-scoped-storage"
import onboardingHero from "../../../images/onboarding-hero.png"
import { getCurrentUser } from "@/lib/supabase/current-user"

// LocalStorage keys — must match the ones the home page reads, so prefetched
// results land in its cache and it skips its own auto-generation branch.
const HOMEPAGE_HOOKS_KEY = "homepageHooks_v6"
const HOOKS_FIRST_VISIT_KEY = "hooksCleanup_v3"
const IDEAS_STORAGE_KEY = "generatedIdeas_v23"

// Steps shown once, right after first-ever signup. Each row appears, spins
// for its own duration, then ticks off. Durations are calibrated to the
// actual backend pipeline timing on the home page — Serper searches for
// creators + Claude streaming of 9 ideas + 20 hooks generation — so the user
// sees a realistic preview of what's happening behind the scenes.
const STEPS: Array<{ text: string; durationMs: number }> = [
  { text: "מכינים עבורכם את הסביבה האישית", durationMs: 2000 },
  { text: "טוענים את זהות העסק שלכם", durationMs: 2500 },
  { text: "מנתחים את קהל היעד", durationMs: 2000 },
  { text: "מזהים את סגנון הכתיבה שלכם", durationMs: 2000 },
  { text: "סורקים פוסטים מהיוצרים המובילים שלכם", durationMs: 4500 },
  { text: "מייצרים 9 רעיונות רעננים מותאמים אליכם", durationMs: 8500 },
  { text: "יוצרים 20 הוקים ראשוניים", durationMs: 7000 },
  { text: "הכל מוכן — יוצאים לדרך!", durationMs: 1200 },
]

const FINAL_PAUSE_MS = 1400 // pause after last tick before marking animation done
const MAX_GEN_WAIT_MS = 45000 // safety: force-finish if generations hang past this

type IdeaItem = {
  text: string
  source: string
  url?: string
  profileUrl?: string
  category?: string
  createdAt?: string
}

// Read a streaming JSON-lines response into an array of parsed items. The
// onItem callback lets us decide what to do with each line without the
// caller needing to repeat the SSE parsing dance.
async function streamSSE(res: Response, onItem: (item: unknown) => void): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() || ""
    for (const part of parts) {
      const d = part.replace(/^data: /, "").trim()
      if (!d || d === "[DONE]") continue
      try {
        onItem(JSON.parse(d))
      } catch {
        // partial or malformed chunk — ignore
      }
    }
  }
}

async function prefetchHooks(userId: string): Promise<void> {
  const res = await fetch("/api/homepage-hooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldIdeas: [] }),
  })
  if (!res.ok) return
  const collected: string[] = []
  await streamSSE(res, (item) => {
    const h = item as { hook_text?: string }
    if (h.hook_text) collected.push(h.hook_text)
  })
  if (collected.length > 0) {
    // Cache only the 4 most-recent — must match what the home page expects.
    localStorage.setItem(userKey(HOMEPAGE_HOOKS_KEY, userId), JSON.stringify(collected.slice(-4)))
    // Flag set last, so the home page only skips its auto-gen when we really
    // produced something worth caching.
    localStorage.setItem(userKey(HOOKS_FIRST_VISIT_KEY, userId), "done")
  }
}

async function prefetchIdeas(userId: string): Promise<void> {
  const res = await fetch("/api/ideas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previousIdeas: [], existingCategories: [] }),
  })
  if (!res.ok) return
  const collected: IdeaItem[] = []
  const seen = new Set<string>()
  await streamSSE(res, (item) => {
    const i = item as IdeaItem & { error?: string; model_fallback?: boolean }
    if (i.error || i.model_fallback) return
    const key = i.text?.trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    collected.push({
      text: i.text,
      source: i.source,
      url: i.url,
      profileUrl: i.profileUrl,
      category: i.category,
      createdAt: i.createdAt,
    })
  })
  if (collected.length > 0) {
    localStorage.setItem(userKey(IDEAS_STORAGE_KEY, userId), JSON.stringify(collected))
  }
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-10" />}>
      <WelcomePageInner />
    </Suspense>
  )
}

function WelcomePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Preview mode (?preview=1): skips the "already seen" gate, does NOT fire
  // background generations (saves API cost during QA), never persists the
  // welcome_seen flag, and never redirects home. Refresh to replay.
  const previewMode = searchParams.get("preview") === "1"

  const [initChecked, setInitChecked] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  // runningIndex points at the step currently spinning. Rows at indices below
  // it are already ticked off; rows above it are not yet revealed.
  // Starts at -1 so the very first paint has every card in its hidden state —
  // otherwise React commits card 0 as already-revealed and the browser skips
  // the transition (the card just pops in). A short kick-off delay moves it
  // to 0 on the next frame, so card 0 animates just like its siblings.
  const [runningIndex, setRunningIndex] = useState(-1)
  const [animationDone, setAnimationDone] = useState(false)
  const [hooksDone, setHooksDone] = useState(false)
  const [ideasDone, setIdeasDone] = useState(false)
  // Safety escape hatch for the final gate: flips true if the prefetches hang
  // past MAX_GEN_WAIT_MS while we're holding on the last step, so a stalled
  // generation never traps the user on the welcome screen.
  const [forceReady, setForceReady] = useState(false)

  const kickedOffRef = useRef(false)
  const finalizedRef = useRef(false)

  // Index of the final "הכל מוכן" step — the row we hold on until the data is
  // genuinely ready, so the moment it ticks the home page can paint from cache.
  const lastIndex = STEPS.length - 1
  // The prefetches have landed (or we've waited long enough to stop blocking).
  const dataReady = (hooksDone && ideasDone) || forceReady

  // Gate: only show this page once per user. If already seen, bounce to home.
  useEffect(() => {
    if (previewMode) {
      setInitChecked(true)
      return
    }
    const supabase = createClient()
    getCurrentUser(supabase).then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login")
        return
      }
      if (user.user_metadata?.welcome_seen) {
        router.replace("/")
        return
      }
      setUserId(user.id)
      setInitChecked(true)
    })
  }, [router, previewMode])

  // Kick off the two background generations as soon as we pass the gate,
  // so hooks + ideas are ready (or close to ready) by the time the animation
  // finishes. Preview mode skips this to avoid spending API tokens during QA.
  useEffect(() => {
    if (!initChecked || kickedOffRef.current) return
    if (previewMode) {
      kickedOffRef.current = true
      setHooksDone(true)
      setIdeasDone(true)
      return
    }
    if (!userId) return
    kickedOffRef.current = true
    prefetchHooks(userId).finally(() => setHooksDone(true))
    prefetchIdeas(userId).finally(() => setIdeasDone(true))
  }, [initChecked, previewMode, userId])

  // Drive step progression and the final pause in one effect. The steps before
  // the last run purely on their timers (a believable "this is what's happening
  // behind the scenes" preview). The LAST step is the real sync point: it keeps
  // spinning until the background prefetches have actually landed, so when it
  // ticks off the home page is ready to paint from cache with zero dead time.
  useEffect(() => {
    if (!initChecked) return
    if (runningIndex < 0) {
      // Kick-off tick — gives the browser a frame to paint the hidden state
      // before we flip card 0 to revealed, so its transition actually runs.
      const t = setTimeout(() => setRunningIndex(0), 120)
      return () => clearTimeout(t)
    }
    if (runningIndex < lastIndex) {
      const t = setTimeout(() => setRunningIndex((i) => i + 1), STEPS[runningIndex].durationMs)
      return () => clearTimeout(t)
    }
    if (runningIndex === lastIndex) {
      // Hold the final "הכל מוכן" row spinning until the data is ready. By the
      // time the animation reaches here the prefetches have usually finished, so
      // this normally just runs the step's own duration; it only stretches when
      // a generation is genuinely slow — and that stretch IS the correlation.
      if (!dataReady) return
      const t = setTimeout(() => setRunningIndex((i) => i + 1), STEPS[lastIndex].durationMs)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setAnimationDone(true), FINAL_PAUSE_MS)
    return () => clearTimeout(t)
  }, [runningIndex, initChecked, dataReady, lastIndex])

  const finalize = useCallback(async () => {
    if (finalizedRef.current) return
    finalizedRef.current = true
    // Preview mode skips persistence (so the flag stays off and the page can
    // be replayed) but still redirects, so manual QA can see the full flow
    // through to the home-page cascade animation.
    if (!previewMode) {
      const supabase = createClient()
      await supabase.auth.updateUser({ data: { welcome_seen: true } })
    }
    router.replace("/")
  }, [router, previewMode])

  // Redirect the instant the animation wraps up. animationDone can only be set
  // after the final step's data-ready gate has passed, so by here the home page
  // is guaranteed to have its cache (or we've hit the safety escape below) —
  // no separate prefetch check needed, and no dead time after the last tick.
  useEffect(() => {
    if (!animationDone) return
    finalize()
  }, [animationDone, finalize])

  // Safety net for the final gate: if the prefetches hang (network, quota,
  // overload) while we're holding on the last step, don't trap the user — flip
  // forceReady after MAX_GEN_WAIT_MS so the step ticks and we redirect anyway.
  // The home page's own fallback handles the missing cache.
  useEffect(() => {
    if (previewMode) return
    if (runningIndex !== lastIndex) return
    if (hooksDone && ideasDone) return
    const t = setTimeout(() => setForceReady(true), MAX_GEN_WAIT_MS)
    return () => clearTimeout(t)
  }, [runningIndex, lastIndex, hooksDone, ideasDone, previewMode])

  // Keep the page white while we gate — avoids a flash of content for returning users.
  if (!initChecked) {
    return <div className="min-h-screen bg-white dark:bg-gray-10" />
  }

  return (
    <div
      dir="rtl"
      className="relative min-h-screen bg-white dark:bg-gray-10 overflow-hidden"
    >
      {/* Dot pattern pinned to bottom — matches the home-page pattern. */}
      <div
        className="fixed inset-x-0 bottom-0 h-[350px] pointer-events-none z-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--canvas-dot) 1.5px, transparent 1.5px)",
          backgroundSize: "18px 18px",
          backgroundPosition: "center bottom",
          maskImage: "linear-gradient(to top, black 0%, transparent 80%)",
          WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 80%)",
        }}
      />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-10">
        <Image
          src={onboardingHero}
          alt=""
          width={300}
          height={300}
          priority
          className="select-none pointer-events-none"
        />

        {/* All steps render from the start (invisible placeholders), so the
            column reserves its final height and the illustration above stays
            put. Cards rise into their stable slot with fade + translate as
            their turn comes around. */}
        <div className="flex flex-col gap-3 w-full max-w-md">
          {STEPS.map((step, i) => {
            const revealed = i <= runningIndex && i < STEPS.length
            const done = i < runningIndex
            return (
              <div
                key={i}
                aria-hidden={!revealed}
                className={`flex items-center gap-3 rounded-xl bg-bg-surface dark:bg-gray-10 border border-border-neutral-default px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-700 ${
                  revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
                }`}
                style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
              >
                {done ? (
                  <Check className="size-5 text-yellow-30 shrink-0" />
                ) : (
                  <Loader2 className="size-5 text-text-neutral-default animate-spin shrink-0" />
                )}
                <span className="text-small text-text-primary-default">{step.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
