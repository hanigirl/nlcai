"use client"

// Layout-level provider that owns the hook-generation streaming fetch so it
// survives page navigation. When the /hooks page calls startGeneration(),
// the fetch lives here (in the persistent layout), not in the page component.
// If the user navigates away, the fetch + state continue, and a persistent
// sonner toast at the bottom shows progress. When done, the toast flips to
// "ההוקים מוכנים" with a link back to /hooks.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { userKey } from "@/lib/user-scoped-storage"

export interface StreamedHook {
  id: string
  hook_text: string
  is_used: boolean
  is_favorite?: boolean
  created_at: string
  product_ids?: string[]
}

type HookListener = (hook: StreamedHook) => void
type DoneListener = () => void

interface HookGenContextValue {
  isGenerating: boolean
  progress: number
  total: number
  sessionHookIds: string[]
  error: string | null
  /**
   * Model that wrote the most recent batch, as reported by the server — never
   * inferred from the absence of a warning. null before the first batch.
   */
  engine: string | null
  /**
   * Kick off a hook-generation batch. Pass a `product` to generate hooks
   * focused on (and tagged with) that product; omit it for a general batch.
   */
  startGeneration: (product?: { id: string; name: string }) => Promise<void>
  /** Subscribe to hooks as they arrive. Returns an unsubscribe. */
  subscribeHook: (fn: HookListener) => () => void
  /** Subscribe to "generation complete" signal. Returns an unsubscribe. */
  subscribeDone: (fn: DoneListener) => () => void
}

const HookGenContext = createContext<HookGenContextValue | null>(null)

export function useHookGeneration(): HookGenContextValue {
  const ctx = useContext(HookGenContext)
  if (!ctx) throw new Error("useHookGeneration must be used inside <HookGenerationProvider>")
  return ctx
}

// Mirrors HOOK_COUNT in /api/homepage-hooks. Keep in sync — used only
// for the progress toast denominator ("X מתוך TOTAL").
const TOTAL_HOOKS = 6
const TOAST_ID = "hook-generation-status"

// The route streams raw error codes. Without this map the user sees English
// snake_case in a toast — most of these are new since hooks moved to Gemini.
const ERROR_MESSAGES: Record<string, string> = {
  audience_missing: "לא הצלחנו לקרוא את ניתוח קהל היעד. יש לעדכן את הקובץ בהגדרות.",
  gemini_not_connected: "לא חובר מפתח Gemini. צריך לחבר אותו בהגדרות כדי לייצר הוקים.",
  gemini_key_invalid: "מפתח ה-Gemini לא תקף. צריך לחבר אותו מחדש בהגדרות.",
  gemini_quota_exceeded: "חרגתם מהמכסה של Gemini. בדקו את המגבלות בחשבון או נסו שוב מאוחר יותר.",
  gemini_overloaded: "השרתים של Gemini עמוסים כרגע. נסו שוב בעוד דקה.",
  anthropic_not_connected: "לא חובר מפתח Anthropic. צריך לחבר אותו בהגדרות.",
  anthropic_overloaded: "השרתים של Anthropic עמוסים כרגע. נסו שוב בעוד דקה.",
  credits_exhausted: "נגמרו הקרדיטים של Anthropic.",
}

function hookErrorMessage(code: unknown): string {
  if (typeof code !== "string" || !code) return "שגיאה ביצירת הוקים"
  return ERROR_MESSAGES[code] ?? code
}

export function HookGenerationProvider({ children }: { children: React.ReactNode }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(TOTAL_HOOKS)
  const [sessionHookIds, setSessionHookIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<string | null>(null)

  // Listener sets — /hooks page subscribes while mounted so it can add hooks
  // to its local state in real time. If the page is unmounted (user navigated),
  // nothing listens and the stream just updates provider state + toast.
  const hookListenersRef = useRef<Set<HookListener>>(new Set())
  const doneListenersRef = useRef<Set<DoneListener>>(new Set())

  const subscribeHook = useCallback((fn: HookListener) => {
    hookListenersRef.current.add(fn)
    return () => { hookListenersRef.current.delete(fn) }
  }, [])

  const subscribeDone = useCallback((fn: DoneListener) => {
    doneListenersRef.current.add(fn)
    return () => { doneListenersRef.current.delete(fn) }
  }, [])

  const startGeneration = useCallback(async (product?: { id: string; name: string }) => {
    if (isGenerating) return

    setIsGenerating(true)
    setProgress(0)
    setTotal(TOTAL_HOOKS)
    setSessionHookIds([])
    setError(null)

    // Subject of this batch — a product name when the user picked "לפי מוצר",
    // otherwise the generic "new hooks". Threaded into the progress toasts.
    const subject = product ? `הוקים ל${product.name}` : "הוקים חדשים"

    // Persistent loading toast — survives page navigation because it lives
    // on the layout's <Toaster />. Updated as progress flows.
    toast.loading(`מייצר ${subject}... 0 מתוך ${TOTAL_HOOKS}`, { id: TOAST_ID, duration: Infinity })

    // Everything from here down runs inside one try/finally.
    //
    // It used to start OUTSIDE the try, and `supabase.auth.getUser()` is a
    // network call — an expired session or a momentary connection drop threw
    // right there, past every `setIsGenerating(false)`. The flag stayed `true`
    // forever, which both greys out the "ייצר לי עוד הוקים" button AND makes
    // the `if (isGenerating) return` guard above swallow every later click.
    // From the user's side the button was simply dead until a page refresh,
    // with the "מייצר..." toast (duration: Infinity) stuck on screen. The
    // `finally` now guarantees the flag is released no matter how we exit.
    try {
      // Per-user storage — without scoping, switching accounts surfaces the
      // previous user's cached ideas/hooks.
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id ?? null

      // Collect field ideas from localStorage (structured, for server-side favorite matching).
      type FieldIdea = { text: string; source?: string; category?: string; url?: string }
      let fieldIdeas: FieldIdea[] = []
      try {
        const saved = uid ? localStorage.getItem(userKey("generatedIdeas_v23", uid)) : null
        if (saved) {
          fieldIdeas = JSON.parse(saved).map((i: FieldIdea) => ({
            text: i.text, source: i.source, category: i.category, url: i.url,
          }))
        }
      } catch (err) { console.error("[hook-gen-provider][fetch-ideas]", err) }

      const res = await fetch("/api/homepage-hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldIdeas,
          productId: product?.id ?? null,
          productName: product?.name ?? null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "שגיאה ביצירת הוקים")
        setIsGenerating(false)
        toast.error(hookErrorMessage(data.error), { id: TOAST_ID, duration: 6000 })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setError("שגיאה בחיבור")
        setIsGenerating(false)
        toast.error("שגיאה בחיבור", { id: TOAST_ID, duration: 6000 })
        return
      }

      const decoder = new TextDecoder()
      let buffer = ""
      let count = 0
      let errorSeen = false
      // The route emits model_fallback once, but guard anyway — one toast per
      // batch, not one per hook.
      let fallbackNotified = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const data = line.replace(/^data: /, "").trim()
          if (!data || data === "[DONE]") continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              errorSeen = true
              setError(parsed.error)
              toast.error(hookErrorMessage(parsed.error), { id: TOAST_ID, duration: 6000 })
              continue
            }
            // The route has always streamed this; the warehouse path used to
            // drop it on the floor, so a whole batch could come from the
            // weaker model with nothing on screen saying so. That matters now
            // that hook quality is the thing being judged — a free Gemini key
            // can't reach Pro at all, and silently reading Flash output as if
            // it were Pro would send us to the wrong conclusion.
            // Positive statement of which model wrote the batch. Kept separate
            // from the fallback warning below on purpose: a warning that fails
            // to appear reads as "all good", and that misread cost a whole
            // evaluation session — every hook was judged as Pro output when it
            // had all come from Flash.
            if (typeof parsed.engine === "string") {
              console.log(`[hooks] batch written by ${parsed.engine}`)
              setEngine(parsed.engine)
              continue
            }
            if (parsed.model_fallback && !fallbackNotified) {
              fallbackNotified = true
              toast("⚡ נוצר במודל קל יותר — האיכות עשויה להיות נמוכה מהרגיל", { duration: 10000 })
              continue
            }
            // Partial failure, not fatal — some hooks got through before the
            // user's Gemini plan started rate-limiting. Warn, but let the
            // success path below run for the hooks that did land.
            if (parsed.gemini_quota_warning) {
              toast.error(
                "חלק מההוקים לא נוצרו כי חרגתם מהמכסה של Gemini. נסו שוב בעוד דקה.",
                { duration: 8000 },
              )
              continue
            }
            if (typeof parsed.save_failures === "number" && parsed.save_failures > 0) {
              toast.error(
                `${parsed.save_failures} הוקים לא נשמרו עקב תקלת רשת. נסי לג'נרט שוב.`,
                { duration: 8000 },
              )
              continue
            }
            if (parsed.hook_text && parsed.id) {
              count++
              const streamed: StreamedHook = {
                id: parsed.id,
                hook_text: parsed.hook_text,
                is_used: parsed.is_used ?? false,
                is_favorite: parsed.is_favorite ?? false,
                created_at: parsed.created_at ?? new Date().toISOString(),
                product_ids: parsed.product_ids,
              }
              setProgress(count)
              setSessionHookIds((prev) => [...prev, streamed.id])
              // Update toast text in place
              toast.loading(`מייצר ${subject}... ${count} מתוך ${TOTAL_HOOKS}`, { id: TOAST_ID, duration: Infinity })
              // Fire listeners (page component receives if mounted)
              for (const fn of hookListenersRef.current) {
                try { fn(streamed) } catch (err) { console.error("[hook-gen-provider][listener-crash]", err) }
              }
            }
          } catch (err) { console.error("[hook-gen-provider][stream-line-parse]", err) }
        }
      }

      setIsGenerating(false)
      if (errorSeen) return

      if (count === 0) {
        toast.error("לא נוצרו הוקים חדשים. נסו שוב בעוד רגע", { id: TOAST_ID, duration: 6000 })
      } else {
        // Success — clear homepage hook cache so next home visit refetches
        try {
          if (uid) localStorage.removeItem(userKey("homepageHooks_v6", uid))
        } catch (err) { console.error("[hook-gen-provider][cache-clear]", err) }
        toast.success("ההוקים מוכנים במחסן ההוקים!", {
          id: TOAST_ID,
          duration: 10000,
          action: {
            label: "לצפייה ←",
            onClick: () => { window.location.href = "/hooks" },
          },
        })
        // Fire done listeners so the /hooks page (if mounted) can resync from DB
        for (const fn of doneListenersRef.current) {
          try { fn() } catch (err) { console.error("[hook-gen-provider][done-listener-crash]", err) }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(`שגיאה ביצירת הוקים: ${msg}`, { id: TOAST_ID, duration: 6000 })
    } finally {
      // The single guaranteed release point. Without it, any throw on a path
      // that isn't explicitly handled leaves the generate button disabled for
      // the rest of the session. Every exit path above already replaces the
      // `duration: Infinity` loading toast with a terminal success/error one
      // under the same id, and the catch covers the rest — so the toast can no
      // longer outlive the run either.
      setIsGenerating(false)
    }
  }, [isGenerating])

  const value = useMemo<HookGenContextValue>(() => ({
    isGenerating,
    progress,
    total,
    sessionHookIds,
    error,
    engine,
    startGeneration,
    subscribeHook,
    subscribeDone,
  }), [isGenerating, progress, total, sessionHookIds, error, engine, startGeneration, subscribeHook, subscribeDone])

  return <HookGenContext.Provider value={value}>{children}</HookGenContext.Provider>
}
