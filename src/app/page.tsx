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
  const [nicheError, setNicheError] = useState("")
  const hooksInitRef = useRef(false)

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

    // No cached ideas locally. Before auto-generating, check whether this user
    // has already used the system (existing core_identity older than 2 min,
    // OR any saved favorites). If so, this is a returning user with cleared
    // localStorage — DO NOT auto-generate. They can hit "עוד רעיונות" from /ideas
    // when they want fresh content. Auto-generation is reserved for the truly
    // first-time experience right after onboarding.
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const [{ data: core }, { count: favCount }] = await Promise.all([
        supabase
          .from("core_identities")
          .select("niche, created_at")
          .eq("user_id", user.id)
          .single<{ niche: string | null; created_at: string }>(),
        supabase
          .from("idea_favorites")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ])

      if (!core?.niche?.trim()) {
        setNicheError("אין מספיק פרטים על הנישה שלך")
        return
      }

      const coreAgeMs = core.created_at ? Date.now() - new Date(core.created_at).getTime() : 0
      const isReturningUser = (favCount ?? 0) > 0 || coreAgeMs > 2 * 60 * 1000

      if (isReturningUser) {
        // Established user with no local cache — leave the ideas section empty.
        // They can manually generate from /ideas if they want.
        return
      }

      // Genuine first visit (just onboarded, no favorites yet) — auto-generate.
      streamIdeas([])
    })
  }, [])

  // No useEffect for localStorage — saved explicitly in streamIdeas finally block

  useEffect(() => {
    // Guard against Strict Mode double-run + async race. Without this, both
    // effect invocations fly past the isFirstVisit check before either writes
    // the flag, so both POST to /api/homepage-hooks and we get duplicate hooks.
    if (hooksInitRef.current) return
    hooksInitRef.current = true

    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return

      // Try cache first (fast path).
      try {
        const cached = localStorage.getItem("homepageHooks_v5")
        if (cached) {
          const parsed: string[] = JSON.parse(cached)
          if (parsed.length > 0) {
            setHooks(parsed)
            // Mark this device as having seen hooks — purely informational; the
            // real "have I generated already?" answer comes from the DB below.
            localStorage.setItem("hooksCleanup_v3", "done")
            return
          }
        }
      } catch { /* ignore */ }

      // No cache — check the DB. If the user already has hooks, load them and
      // never auto-regenerate. The DB is the source of truth: localStorage can
      // be cleared, the user can switch browsers/devices, etc.
      const { data: dbHooks } = await supabase
        .from("hooks")
        .select("hook_text")
        .eq("user_id", user.id)
        .eq("is_used", false)
        .order("display_order", { ascending: true })

      if (dbHooks && dbHooks.length > 0) {
        const hookTexts = (dbHooks as Array<{ hook_text: string }>).map((h) => h.hook_text)
        setHooks(hookTexts)
        localStorage.setItem("homepageHooks_v5", JSON.stringify(hookTexts))
        localStorage.setItem("hooksCleanup_v3", "done")
        return
      }

      // True first visit: no hooks anywhere for this user. Auto-generate.
      localStorage.setItem("hooksCleanup_v3", "done")

      setHooksLoading(true)
      try {
        const res = await fetch("/api/homepage-hooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldIdeas: ideas.map((i) => ({
              text: i.text,
              source: i.source,
              category: i.category,
              url: i.url,
            })),
          }),
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
              if (h.model_fallback) { setModelFallback(true); continue }
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
  const [modelFallback, setModelFallback] = useState(false)

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
        const known = ["audience_missing", "credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "core_identity_missing", "unauthorized", "no_trends_found", "no_creator_content", "trend_search_failed", "search_not_configured"]
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
            if (idea.model_fallback) { setModelFallback(true); continue }
            if (idea.error) {
              const known = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "no_ideas_generated", "all_ideas_duplicate"]
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
      {modelFallback && (
        <div dir="rtl" className="fixed top-4 right-1/2 translate-x-1/2 z-50 max-w-md mx-auto rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-2 shadow-sm">
          <p className="text-small text-text-primary-default text-center">
            ⚡ עברנו זמנית למודל קל יותר בגלל עומס. האיכות עשויה להיות מעט נמוכה
          </p>
        </div>
      )}
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

          <h1
            className="text-text-primary-default animate-in fade-in slide-in-from-top-3 duration-600"
            style={{
              animationDelay: "500ms",
              animationFillMode: "backwards",
              animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            היי {userName.split(" ")[0]},
            <br />
            מה ניצור היום?
          </h1>
          <div
            className="animate-in fade-in slide-in-from-top-3 duration-600"
            style={{
              animationDelay: "700ms",
              animationFillMode: "backwards",
              animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <Typewriter className="text-p text-text-primary-default mt-4 h-6" />
          </div>
        </div>

        <div className="flex flex-col gap-10">
          {/* Section 1: Hooks */}
          <div
            className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-700"
            style={{
              animationDelay: "900ms",
              animationFillMode: "backwards",
              animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
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
                    // Render real hook as soon as it arrives (streamed or cached).
                    // The per-item CSS fade-in animation gives a smooth entrance —
                    // no separate "reveal one by one" state, which used to reset on
                    // every stream update and cause a visible jump.
                    if (hooks[i]) {
                      return (
                        <div
                          key={`hook-${i}`}
                          className="animate-hook-bump"
                          style={{ animationDelay: `${i * 60}ms` }}
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
          <div
            className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-700"
            style={{
              animationDelay: "1150ms",
              animationFillMode: "backwards",
              animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
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
          <div
            className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-700"
            style={{
              animationDelay: "1400ms",
              animationFillMode: "backwards",
              animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
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
                  עדכנו פרטים בהגדרות →
                </a>
              </div>
            )}

            <div className="grid w-full grid-cols-3 gap-4">
              {ideas.slice(0, 9).map((note, i) => (
                <div key={`${note.text}-${i}`} className="aspect-square">
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
              const infoStyles = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "audience_missing", "core_identity_missing", "unauthorized", "no_trends_found", "no_creator_content", "no_ideas_generated", "all_ideas_duplicate", "trend_search_failed", "search_not_configured"]
              const isInfo = infoStyles.includes(ideasError)
              const config: Record<string, { message: string; action?: { href: string; label: string; external?: boolean } }> = {
                credits_exhausted: {
                  message: "לא הצלחנו לייצר את התכנים כי נגמרו לך הקרדיטים של Anthropic",
                  action: { href: "https://console.anthropic.com/settings/billing", label: "לרכישת קרדיטים נוספים →", external: true },
                },
                anthropic_overloaded: {
                  message: "השרתים של Anthropic עמוסים כרגע. נסו שוב בעוד דקה",
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
                no_trends_found: {
                  message: "לא מצאנו טרנדים חדשים בנישה שלכם כרגע. הוסיפו יוצרים מובילים כדי לקבל רעיונות גם מהם, או נסו שוב בעוד כמה דקות",
                  action: { href: "/settings?tab=business", label: "להוספת יוצרים מובילים →" },
                },
                no_creator_content: {
                  message: "לא מצאנו תוכן ויראלי אצל היוצרים שהוספתם וגם אין טרנדים רלוונטיים. בדקו שהקישורים תקינים או נסו יוצרים נוספים",
                  action: { href: "/settings?tab=business", label: "לעדכון רשימת היוצרים →" },
                },
                no_ideas_generated: {
                  message: "הסוכן סיים אבל לא החזיר אף רעיון. זה יכול לקרות כשאין מספיק חומר גלם — נסו שוב בעוד רגע",
                },
                all_ideas_duplicate: {
                  message: "כל הרעיונות שהתקבלו כבר קיימים במחסן שלכם. נסו שוב — בדרך כלל ריצה חדשה מביאה נושאים חדשים",
                },
                trend_search_failed: {
                  message: "חיפוש הטרנדים ברשת נכשל. נסו שוב בעוד רגע — אם זה חוזר כנראה יש בעיה בשירות החיפוש שלנו",
                },
                search_not_configured: {
                  message: "שירות החיפוש לא מוגדר במערכת. צרו קשר עם התמיכה",
                },
                connection_error: {
                  message: "בעיית חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב",
                },
                generic: {
                  message: "משהו השתבש ביצירת הרעיונות. נסו שוב בעוד רגע",
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
