"use client"

// Layout-level provider that owns the hook-generation streaming fetch so it
// survives page navigation. When the /hooks page calls startGeneration(),
// the fetch lives here (in the persistent layout), not in the page component.
// If the user navigates away, the fetch + state continue, and a persistent
// sonner toast at the bottom shows progress. When done, the toast flips to
// "ההוקים מוכנים" with a link back to /hooks.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

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
  startGeneration: () => Promise<void>
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

const TOTAL_HOOKS = 20
const TOAST_ID = "hook-generation-status"

export function HookGenerationProvider({ children }: { children: React.ReactNode }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(TOTAL_HOOKS)
  const [sessionHookIds, setSessionHookIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

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

  const startGeneration = useCallback(async () => {
    if (isGenerating) return

    setIsGenerating(true)
    setProgress(0)
    setTotal(TOTAL_HOOKS)
    setSessionHookIds([])
    setError(null)

    // Persistent loading toast — survives page navigation because it lives
    // on the layout's <Toaster />. Updated as progress flows.
    toast.loading(`מייצר הוקים חדשים... 0 מתוך ${TOTAL_HOOKS}`, { id: TOAST_ID, duration: Infinity })

    // Collect field ideas from localStorage (structured, for server-side favorite matching).
    type FieldIdea = { text: string; source?: string; category?: string; url?: string }
    let fieldIdeas: FieldIdea[] = []
    try {
      const saved = localStorage.getItem("generatedIdeas_v23")
      if (saved) {
        fieldIdeas = JSON.parse(saved).map((i: FieldIdea) => ({
          text: i.text, source: i.source, category: i.category, url: i.url,
        }))
      }
    } catch { /* ignore */ }

    try {
      const res = await fetch("/api/homepage-hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldIdeas }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg = data.error || "שגיאה ביצירת הוקים"
        setError(msg)
        setIsGenerating(false)
        toast.error(msg, { id: TOAST_ID, duration: 6000 })
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
              toast.error(parsed.error === "audience_missing"
                ? "לא הצלחנו לקרוא את ניתוח קהל היעד. יש לעדכן את הקובץ בהגדרות."
                : (parsed.error || "שגיאה ביצירת הוקים"),
                { id: TOAST_ID, duration: 6000 },
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
              toast.loading(`מייצר הוקים חדשים... ${count} מתוך ${TOTAL_HOOKS}`, { id: TOAST_ID, duration: Infinity })
              // Fire listeners (page component receives if mounted)
              for (const fn of hookListenersRef.current) {
                try { fn(streamed) } catch { /* listener crash shouldn't break stream */ }
              }
            }
          } catch { /* malformed line, skip */ }
        }
      }

      setIsGenerating(false)
      if (errorSeen) return

      if (count === 0) {
        toast.error("לא נוצרו הוקים חדשים. נסו שוב בעוד רגע", { id: TOAST_ID, duration: 6000 })
      } else {
        // Success — clear homepage hook cache so next home visit refetches
        try { localStorage.removeItem("homepageHooks_v5") } catch { /* ignore */ }
        toast.success("ההוקים מוכנים במחסן ההוקים!", {
          id: TOAST_ID,
          duration: 10000,
          action: {
            label: "לצפייה →",
            onClick: () => { window.location.href = "/hooks" },
          },
        })
        // Fire done listeners so the /hooks page (if mounted) can resync from DB
        for (const fn of doneListenersRef.current) {
          try { fn() } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setIsGenerating(false)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(`שגיאה ביצירת הוקים: ${msg}`, { id: TOAST_ID, duration: 6000 })
    }
  }, [isGenerating])

  const value = useMemo<HookGenContextValue>(() => ({
    isGenerating,
    progress,
    total,
    sessionHookIds,
    error,
    startGeneration,
    subscribeHook,
    subscribeDone,
  }), [isGenerating, progress, total, sessionHookIds, error, startGeneration, subscribeHook, subscribeDone])

  return <HookGenContext.Provider value={value}>{children}</HookGenContext.Provider>
}
