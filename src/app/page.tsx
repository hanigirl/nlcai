"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, Mic, Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { AppLink } from "@/components/ui/app-link"
import { AppShell } from "@/components/app-shell"
import { Typewriter } from "@/components/typewriter"
import { StickyNote } from "@/components/sticky-note"
import { HookCard } from "@/components/hook-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"

interface IdeaNote {
  text: string
  source: string
  url?: string
  profileUrl?: string
  category?: string
  createdAt?: string
}

export default function Home() {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [idea, setIdea] = useState("")
  const [ideas, setIdeas] = useState<IdeaNote[]>([])
  const [generating, setGenerating] = useState(false)
  const [hooks, setHooks] = useState<string[]>([])
  const [hooksLoading, setHooksLoading] = useState(false)
  const [visibleHooks, setVisibleHooks] = useState(0)
  const [nicheError, setNicheError] = useState("")

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = dedupe(JSON.parse(saved))
        if (parsed.length > 0) {
          setIdeas(parsed)
          ideasRef.current = parsed
          return
        }
      }
    } catch {
      // ignore
    }

    // First visit — no cached ideas, auto-generate
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: core } = await supabase
        .from("core_identities")
        .select("niche")
        .eq("user_id", user.id)
        .single<{ niche: string | null }>()

      if (!core?.niche?.trim()) {
        setNicheError("אין מספיק פרטים על הנישה שלך")
        return
      }

      // Auto-generate ideas via stream
      streamIdeas([])
    })
  }, [])

  // No useEffect for localStorage — saved explicitly in streamIdeas finally block

  // Stagger hook reveal one by one
  useEffect(() => {
    if (hooks.length === 0) {
      setVisibleHooks(0)
      return
    }
    setVisibleHooks(0)
    let i = 0
    const interval = setInterval(() => {
      i++
      setVisibleHooks(i)
      if (i >= Math.min(hooks.length, 4)) clearInterval(interval)
    }, 300)
    return () => clearInterval(interval)
  }, [hooks])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return

      // One-time cleanup: delete old hooks without trend context
      const didCleanup = localStorage.getItem("hooksCleanup_v3")
      if (!didCleanup) {
        await supabase.from("hooks").delete().eq("user_id", user.id).eq("is_used", false)
        localStorage.removeItem("homepageHooks_v5")
        localStorage.setItem("hooksCleanup_v3", "done")
      } else {
        // Try localStorage cache
        try {
          const cached = localStorage.getItem("homepageHooks_v5")
          if (cached) {
            const parsed: string[] = JSON.parse(cached)
            if (parsed.length > 0) {
              setHooks(parsed)
              return
            }
          }
        } catch { /* ignore */ }

        // Load existing hooks from DB
        const { data: dbHooks } = await supabase
          .from("hooks")
          .select("hook_text")
          .eq("user_id", user.id)
          .eq("is_used", false)
          .order("display_order", { ascending: true })

        if (dbHooks && dbHooks.length > 0) {
          const hookTexts = dbHooks.map((h: { hook_text: string }) => h.hook_text)
          setHooks(hookTexts)
          localStorage.setItem("homepageHooks_v5", JSON.stringify(hookTexts))
          return
        }
      }

      // No hooks — generate fresh via stream
      setHooksLoading(true)
      try {
        const res = await fetch("/api/homepage-hooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldIdeas: ideas.map((i) => i.text) }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          if (errData.error === "audience_missing") {
            setNicheError("לא הצלחנו לקרוא את ניתוח קהל היעד. יש לעדכן את הקובץ בהגדרות.")
          }
          setHooksLoading(false)
          return
        }
        const reader = res.body?.getReader()
        if (!reader) { setHooksLoading(false); return }
        const decoder = new TextDecoder()
        let buf = ""
        const streamed: string[] = []
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
              const h = JSON.parse(d)
              if (h.hook_text) {
                streamed.push(h.hook_text)
                setHooks([...streamed])
              }
            } catch { /* skip */ }
          }
        }
        if (streamed.length > 0) {
          localStorage.setItem("homepageHooks_v5", JSON.stringify(streamed))
        }
      } catch { /* ignore */ }
      setHooksLoading(false)
    })
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        const { data: profile } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", data.user.id)
          .single<{ full_name: string | null }>()
        setUserName(
          profile?.full_name ||
            data.user.user_metadata?.full_name ||
            data.user.email?.split("@")[0] ||
            ""
        )
      }
    })
  }, [])

  const handleSubmit = () => {
    if (!idea.trim()) return
    router.push(`/project?idea=${encodeURIComponent(idea)}`)
  }

  const [ideasError, setIdeasError] = useState("")

  const STORAGE_KEY = "generatedIdeas_v23"
  const generatingRef = useRef(false)
  const ideasRef = useRef<IdeaNote[]>([])

  const dedupe = useCallback((arr: IdeaNote[]): IdeaNote[] => {
    const seen = new Set<string>()
    return arr.filter((idea) => {
      const key = idea.text.slice(0, 60)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [])

  const streamIdeas = async (prevIdeas: IdeaNote[]) => {
    if (generatingRef.current) return
    generatingRef.current = true
    setGenerating(true)
    setIdeasError("")
    const existingCategories = [...new Set(prevIdeas.map((i) => i.category).filter(Boolean))]
    const seenKeys = new Set(prevIdeas.map((i) => i.text.slice(0, 60)))
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousIdeas: prevIdeas.map((i) => i.text), existingCategories }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const known = ["audience_missing", "credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "core_identity_missing", "unauthorized"]
        const raw = data.error === "Unauthorized" ? "unauthorized" : data.error === "Core identity not found." ? "core_identity_missing" : data.error
        setIdeasError(known.includes(raw) ? raw : (raw || "generic"))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setIdeasError("connection_error"); return }

      const decoder = new TextDecoder()
      let buffer = ""

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
            const idea = JSON.parse(data)
            if (idea.error) {
              const known = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected"]
              setIdeasError(known.includes(idea.error) ? idea.error : (idea.error || "generic"))
              continue
            }
            const key = idea.text?.slice(0, 60)
            if (idea.text && key && !seenKeys.has(key)) {
              seenKeys.add(key)
              ideasRef.current = [idea, ...ideasRef.current]
              setIdeas([...ideasRef.current])
            }
          } catch { /* skip partial */ }
        }
      }
    } catch (err) {
      setIdeasError("connection_error")
      console.error("Ideas stream error:", err)
    } finally {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dedupe(ideasRef.current)))
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const handleGenerateIdeas = () => {
    streamIdeas(ideas)
  }

  return (
    <AppShell isHome>
      <div dir="rtl" className="mx-auto max-w-3xl relative z-10 px-20 pt-[72px] pb-[100px]">
        {/* Greeting */}
        <div className="text-center mb-[72px]">
          {/* Card fan */}
          <div className="flex items-center justify-center mb-6">
            {[
              { src: "/images/hook.png", rotate: "rotate-[14deg]", delay: "0ms" },
              { src: "/images/idea.png", rotate: "rotate-[-7.5deg]", delay: "100ms" },
              { src: "/images/letter.png", rotate: "rotate-[-12.5deg]", delay: "200ms" },
            ].map((card, i) => (
              <img
                key={i}
                src={card.src}
                alt=""
                className={`-mr-4 w-[66px] h-[66px] ${card.rotate} animate-[fan-in_0.6s_ease-out_both]`}
                style={{ animationDelay: card.delay }}
              />
            ))}
          </div>

          <h2 className="text-text-primary-default">
            היי {userName.split(" ")[0]},
            <br />
            מה ניצור היום?
          </h2>
          <Typewriter className="text-p text-text-primary-default mt-4 h-6" />
        </div>

        <div className="flex flex-col gap-10">
          {/* Section 1: Hooks */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs-body text-text-neutral-default">
                התחלה מ-הוק
              </span>
              <AppLink href="/hooks" linkSize="small">
                למחסן ההוקים המלא
              </AppLink>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {hooksLoading && hooks.length === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={`skel-${i}`} className="rounded-[16px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4 flex flex-col gap-3">
                      <Skeleton className="h-4 w-full rounded-md" />
                      <Skeleton className="h-4 w-3/4 rounded-md" />
                      <Skeleton className="h-8 w-8 self-end rounded-lg" />
                    </div>
                  ))
                : Array.from({ length: 4 }).map((_, i) => {
                    if (i < visibleHooks && hooks[i]) {
                      return (
                        <div
                          key={i}
                          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                          style={{ animationFillMode: "backwards" }}
                        >
                          <HookCard
                            hookText={hooks[i]}
                            onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hooks[i])}`)}
                          />
                        </div>
                      )
                    }
                    return (
                      <div key={`skel-${i}`} className="rounded-[16px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4 flex flex-col gap-3">
                        <Skeleton className="h-4 w-full rounded-md" />
                        <Skeleton className="h-4 w-3/4 rounded-md" />
                        <Skeleton className="h-8 w-8 self-end rounded-lg" />
                      </div>
                    )
                  })
              }
            </div>
          </div>

          {/* Section 2: Idea textarea */}
          <div className="flex flex-col gap-4">
            <span className="text-xs-body text-text-neutral-default">
              התחלה מרעיון
            </span>
            <div className="rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 p-4 flex flex-col gap-4">
              <Textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="כאן כותבים או מקליטים אותו"
                className="min-h-[56px] border-none bg-transparent px-0 py-0 text-p text-text-primary-default shadow-none placeholder:text-text-neutral-default resize-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="p-2 text-text-neutral-default hover:text-text-primary-default transition-colors"
                >
                  <Mic className="size-4" />
                </button>
                <Button onClick={handleSubmit} disabled={!idea.trim()} className="gap-2">
                  תייצר לי הוקים
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Section 3: Ideas */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex w-full items-center justify-between">
              <span className="text-xs-body text-text-neutral-default">
                רעיונות מהשטח
              </span>
              <AppLink href="/ideas" linkSize="small">
                למחסן הרעיונות המלא
              </AppLink>
            </div>

            {nicheError && (
              <div className="w-full rounded-xl border border-border-neutral-default bg-bg-surface p-4 text-center">
                <p className="text-small text-text-neutral-default mb-2">{nicheError}</p>
                <a href="/settings?tab=business" className="text-small-bold text-text-primary-default hover:underline">
                  עדכני פרטים בהגדרות →
                </a>
              </div>
            )}

            <div className="grid w-full grid-cols-3 gap-4">
              {ideas.slice(0, 9).map((note, i) => (
                <div
                  key={`${note.text}-${i}`}
                  className="animate-in fade-in slide-in-from-bottom-3 duration-300 aspect-square"
                  style={{ animationFillMode: "backwards" }}
                >
                  <StickyNote
                    text={note.text}
                    source={note.source}
                    url={note.url}
                    profileUrl={note.profileUrl}
                    onClick={() =>
                      router.push(`/project?idea=${encodeURIComponent(note.text)}`)
                    }
                  />
                </div>
              ))}
              {generating && Array.from({ length: Math.max(0, 9 - (ideas.length % 9 || 9)) }).map((_, i) => (
                <div key={`skel-${i}`} className="aspect-square rounded-lg bg-white dark:bg-gray-10 border border-border-neutral-default p-5 flex flex-col justify-between">
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-5/6 rounded" />
                    <Skeleton className="h-3 w-4/6 rounded" />
                    <Skeleton className="h-3 w-full rounded" />
                    <Skeleton className="h-3 w-3/6 rounded" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-6 rounded" />
                    <Skeleton className="h-3 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>

            {ideas.length < 9 && (
              <Button
                variant="outline"
                onClick={handleGenerateIdeas}
                disabled={generating}
                className="rounded-xl border-border-neutral-default text-text-primary-default text-p-bold"
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {generating ? "מייצר..." : "זרוק לי עוד רעיונות"}
              </Button>
            )}
            {ideasError && (() => {
              const infoStyles = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "audience_missing", "core_identity_missing", "unauthorized"]
              const isInfo = infoStyles.includes(ideasError)
              const config: Record<string, { message: string; action?: { href: string; label: string; external?: boolean } }> = {
                credits_exhausted: {
                  message: "לא הצלחנו לייצר את התכנים כי נגמרו לך הקרדיטים של Anthropic",
                  action: { href: "https://console.anthropic.com/settings/billing", label: "לרכישת קרדיטים נוספים →", external: true },
                },
                anthropic_overloaded: {
                  message: "השרתים של Anthropic עמוסים כרגע. נסי שוב בעוד דקה",
                },
                anthropic_not_connected: {
                  message: "לא חובר מפתח Anthropic API. צריך לחבר אותו בהגדרות כדי להתחיל",
                  action: { href: "/settings?tab=connections", label: "לחיבור מפתח API →" },
                },
                audience_missing: {
                  message: "לא הצלחנו לקרוא את ניתוח קהל היעד. יש לעדכן את הקובץ בהגדרות",
                  action: { href: "/settings?tab=business", label: "לעמוד ההגדרות →" },
                },
                core_identity_missing: {
                  message: "חסרה זהות ליבה. יש להשלים את תהליך ה־onboarding",
                  action: { href: "/onboarding", label: "להשלמת onboarding →" },
                },
                unauthorized: {
                  message: "נראה שהתנתקת. יש להתחבר מחדש",
                  action: { href: "/login", label: "למסך ההתחברות →" },
                },
                connection_error: {
                  message: "בעיית חיבור לשרת. בדקי את החיבור לאינטרנט ונסי שוב",
                },
                generic: {
                  message: "משהו השתבש ביצירת הרעיונות. נסי שוב בעוד רגע",
                },
              }
              const c = config[ideasError] ?? { message: ideasError }
              return (
                <div className={`w-full rounded-xl border p-4 text-center ${
                  isInfo ? "border-yellow-50 bg-yellow-95" : "border-border-neutral-default bg-bg-surface"
                }`}>
                  <p className={`text-small ${isInfo ? "text-text-primary-default" : "text-button-destructive-default"} mb-1`}>
                    {c.message}
                  </p>
                  {c.action && (
                    <a
                      href={c.action.href}
                      {...(c.action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="text-small-bold text-text-primary-default hover:underline"
                    >
                      {c.action.label}
                    </a>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Dot pattern pinned to bottom of page */}
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
    </AppShell>
  )
}
