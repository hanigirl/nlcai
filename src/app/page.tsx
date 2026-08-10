"use client"

import { useEffect, useState, useRef, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowUp, Loader2, Bug } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { AppLink } from "@/components/ui/app-link"
import { AppShell } from "@/components/app-shell"
import { GeminiConnectNotice } from "@/components/gemini-connect-notice"
import { Typewriter } from "@/components/typewriter"
import { StickyNote } from "@/components/sticky-note"
import { HookCard } from "@/components/hook-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { BugReportModal } from "@/components/bug-report-modal"
import { HomeMicRecorder } from "@/components/home-mic-recorder"
import { createClient } from "@/lib/supabase/client"
import { userKey } from "@/lib/user-scoped-storage"
import {
  OnboardingProgressBanner,
  makeStages,
  type OnboardingBannerVariant,
} from "@/components/onboarding-progress-banner"

interface IdeaNote {
  text: string
  source: string
  url?: string
  profileUrl?: string
  category?: string
  createdAt?: string
}

// Health-banner data — set by /api/profile/health. enabled:false for
// non-beta users skips the surface entirely so existing users don't see
// the new banner while it's still being validated.
type ProfileHealth = {
  enabled: true
  creditsExhausted: boolean
  styleFileIssue: { reason: string } | null
  audienceFileIssue: { reason: string } | null
  hasProducts: boolean
  hasCreators: boolean
} | { enabled: false }

const ANTHROPIC_BILLING_URL = "https://console.anthropic.com/settings/billing"

// Wrap in Suspense: HomeContent reads useSearchParams (for the ?variant=a|b
// onboarding-banner gate), which requires a Suspense boundary so the route
// doesn't bail out of static rendering at build time.
export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}

function HomeContent() {
  const router = useRouter()

  // --- Onboarding-progress banner (Notion task 3714d905) ---------------
  // Gated behind ?variant=a|b. With NO param the page is byte-identical to
  // production — the banner never mounts. Under the param we seed dummy data
  // (2 of 3 stages done) locally, so the reviewer lands directly on the design
  // with ZERO side effects: no API call, no DB read/write, no credits.
  const searchParams = useSearchParams()
  const bannerVariant = searchParams.get("variant") as OnboardingBannerVariant | null
  const showBanner = bannerVariant === "a" || bannerVariant === "b"
  // Review-only state toggle: lets the reviewer jump between setup states
  // without driving the real onboarding flow. Default 2 (the requested 2/3).
  const [bannerDone, setBannerDone] = useState(2)

  const [userName, setUserName] = useState("")
  const [idea, setIdea] = useState("")
  const [profileHealth, setProfileHealth] = useState<ProfileHealth | null>(null)
  const [ideas, setIdeas] = useState<IdeaNote[]>([])
  const [generating, setGenerating] = useState(false)
  const [hooks, setHooks] = useState<string[]>([])
  const [hooksLoading, setHooksLoading] = useState(false)
  const [nicheError, setNicheError] = useState("")
  const hooksInitRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return

      try {
        const saved = localStorage.getItem(userKey(STORAGE_KEY, user.id))
        if (saved) {
          const parsed = dedupe(JSON.parse(saved))
          if (parsed.length > 0) {
            setIdeas(parsed)
            ideasRef.current = parsed
            return
          }
        }
      } catch (err) {
        console.error("[home][ideas-cache-read]", err)
      }

      // No cached ideas locally. Before auto-generating, check whether this user
      // has already used the system (existing core_identity older than 2 min,
      // OR any saved favorites). If so, this is a returning user with cleared
      // localStorage — rehydrate ideas from DB favorites instead of regenerating.
      const [coreRes, favsRes] = await Promise.all([
        supabase
          .from("core_identities")
          .select("niche, created_at")
          .eq("user_id", user.id)
          .single<{ niche: string | null; created_at: string }>(),
        supabase
          .from("idea_favorites")
          .select("idea_text, idea_data")
          .eq("user_id", user.id),
      ])
      const core = coreRes.data
      const favsData = favsRes.data as { idea_text: string; idea_data: Record<string, unknown> }[] | null

      if (!core?.niche?.trim()) {
        setNicheError("אין מספיק פרטים על הנישה שלך")
        return
      }

      const coreAgeMs = core.created_at ? Date.now() - new Date(core.created_at).getTime() : 0
      const isReturningUser = (favsData?.length ?? 0) > 0 || coreAgeMs > 2 * 60 * 1000

      if (isReturningUser) {
        // Returning user with no local cache — rehydrate from DB favorites so
        // their ideas don't disappear when localStorage clears (new device,
        // browser data wiped, etc.). Matches the rehydration on /ideas.
        if (favsData && favsData.length > 0) {
          const rehydrated = favsData
            .map((f) => f.idea_data as unknown as IdeaNote)
            .filter((i) => i && i.text)
          if (rehydrated.length > 0) {
            const deduped = dedupe(rehydrated)
            setIdeas(deduped)
            ideasRef.current = deduped
            localStorage.setItem(userKey(STORAGE_KEY, user.id), JSON.stringify(deduped))
          }
        }
        return
      }

      // Genuine first visit (just onboarded, no favorites yet) — auto-generate.
      streamIdeas([], user.id)
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

      // Try cache first (fast path). Per-user key: switching accounts on the
      // same browser must not surface the previous user's cached hooks.
      const hooksCacheKey = userKey("homepageHooks_v6", user.id)
      const hooksFlagKey = userKey("hooksCleanup_v3", user.id)
      try {
        const cached = localStorage.getItem(hooksCacheKey)
        if (cached) {
          const parsed: string[] = JSON.parse(cached)
          if (parsed.length > 0) {
            setHooks(parsed)
            localStorage.setItem(hooksFlagKey, "done")
            return
          }
        }
      } catch (err) {
        console.error("[home][hooks-cache-read]", err)
      }

      // No cache — check the DB. If the user already has hooks, load them and
      // never auto-regenerate. The DB is the source of truth: localStorage can
      // be cleared, the user can switch browsers/devices, etc.
      // Show the 4 most-recently-generated hooks so the homepage reflects the
      // user's freshest batch (display_order resets per batch, so we order by
      // created_at desc instead).
      const { data: dbHooks } = await supabase
        .from("hooks")
        .select("hook_text")
        .eq("user_id", user.id)
        .eq("is_used", false)
        .order("created_at", { ascending: false })
        .limit(4)

      if (dbHooks && dbHooks.length > 0) {
        const hookTexts = (dbHooks as Array<{ hook_text: string }>).map((h) => h.hook_text)
        setHooks(hookTexts)
        localStorage.setItem(hooksCacheKey, JSON.stringify(hookTexts))
        localStorage.setItem(hooksFlagKey, "done")
        return
      }

      // True first visit: no hooks anywhere for this user. Auto-generate.
      localStorage.setItem(hooksFlagKey, "done")

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
          } else if (errData.error === "gemini_not_connected") {
            setNicheError("לא חובר מפתח Gemini. צריך לחבר אותו בהגדרות כדי לייצר הוקים.")
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
              if (typeof h.save_failures === "number" && h.save_failures > 0) {
                toast.error(
                  `${h.save_failures} הוקים לא נשמרו עקב תקלת רשת. נסי לרענן בעוד רגע.`,
                  { duration: 8000 },
                )
                continue
              }
              if (h.hook_text) {
                streamed.push(h.hook_text)
                setHooks([...streamed])
              }
            } catch (err) { console.error("[home][hooks-stream-parse]", err) }
          }
        }
        if (streamed.length > 0) {
          // Cache only the 4 most-recent (last to stream in) so the homepage
          // matches what the DB returns on next load.
          localStorage.setItem(hooksCacheKey, JSON.stringify(streamed.slice(-4)))
        }
      } catch (err) {
        console.error("[home][hooks-stream]", err)
      }
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

  // Profile-health check for the home banner. Fires once per mount; the
  // endpoint returns enabled:false for non-beta users so this stays inert
  // for everyone outside the preview ring.
  useEffect(() => {
    let cancelled = false
    fetch("/api/profile/health")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data && (data.enabled === true || data.enabled === false)) {
          setProfileHealth(data as ProfileHealth)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = () => {
    if (!idea.trim()) return
    router.push(`/project?idea=${encodeURIComponent(idea)}`)
  }

  const [ideasError, setIdeasError] = useState("")
  const [modelFallback, setModelFallback] = useState(false)
  const [bugModalOpen, setBugModalOpen] = useState(false)

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

  const streamIdeas = async (prevIdeas: IdeaNote[], userId: string) => {
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
          } catch (err) { console.error("[home][ideas-stream-parse]", err) }
        }
      }
    } catch (err) {
      setIdeasError("connection_error")
      console.error("Ideas stream error:", err)
    } finally {
      localStorage.setItem(userKey(STORAGE_KEY, userId), JSON.stringify(dedupe(ideasRef.current)))
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const handleGenerateIdeas = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    streamIdeas(ideas, user.id)
  }

  return (
    <AppShell isHome>
      {/* Review-only state toggle for the onboarding-progress banner. Visible
          only under ?variant=a|b — lets the reviewer jump between setup states
          (0/3 · 2/3 · 3/3) without driving the real onboarding flow. Not part
          of the shipped design. */}
      {showBanner && (
        <div
          dir="rtl"
          className="fixed top-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-3 py-2 shadow-sm"
        >
          <span className="text-xs-body text-text-neutral-default">תצוגת מצב:</span>
          {[
            { n: 0, label: "0/3" },
            { n: 2, label: "2/3" },
            { n: 3, label: "3/3" },
          ].map((opt) => (
            <button
              key={opt.n}
              type="button"
              onClick={() => setBannerDone(opt.n)}
              aria-pressed={bannerDone === opt.n}
              className={`rounded-lg px-2.5 py-1 text-small-bold transition-colors ${
                bannerDone === opt.n
                  ? "bg-button-primary-default text-white"
                  : "bg-bg-surface text-text-primary-default hover:bg-bg-surface-hover"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {modelFallback && (
        <div dir="rtl" className="fixed top-4 right-1/2 translate-x-1/2 z-50 max-w-md mx-auto rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-2 shadow-sm">
          <p className="text-small text-text-primary-default text-center">
            {/* Shared by the ideas stream (Claude overload) and the hooks
                stream (a free Gemini key has no Pro access at all), so the
                wording can't claim a single cause. */}
            ⚡ עברנו למודל קל יותר. האיכות עשויה להיות מעט נמוכה
          </p>
        </div>
      )}
      <div dir="rtl" className="mx-auto max-w-3xl relative z-10 px-20 pt-[72px] pb-[100px]">
        {/* Profile-health banner — shown above the greeting when the API
            flags an unusable identity file or a missing products/creators
            list. Priority: file issues come first (critical, blocks
            generation quality); only when both identity files are healthy
            do we surface the products/creators improvement nudge.
            Non-beta users see nothing — the endpoint returns enabled:false
            for them. */}
        {profileHealth && profileHealth.enabled && (() => {
          // `missing` and `parse_failed` are what /api/profile/health actually
          // returns today; the rest are reserved for finer-grained reasons we
          // surface from the file-upload path. Keep all of them here so the
          // banner stays in sync with both ends — a reason the client doesn't
          // know about used to fall through `reasonCopy`'s switch and crash
          // the home page with "Right side of assignment cannot be destructured".
          type FileIssueReason =
            | "missing"
            | "parse_failed"
            | "no_file"
            | "file_invalid"
            | "file_too_long"
            | "multiple_audiences"
            | "ai_failed"
            | "no_credits"
            | "empty_content"
          type FileIssue = { key: "style" | "audience"; label: string; reason: FileIssueReason }

          // Highest-priority banner — when Anthropic credits are out, no
          // content can be generated until the user tops up. Suppress the
          // file/inventory banners below since acting on them won't help
          // until credits return.
          if (profileHealth.creditsExhausted) {
            return (
              <div className="mb-8 rounded-xl border border-red-50 bg-red-95 px-4 py-3 flex items-center justify-between gap-3">
                <div className="text-small text-text-primary-default">
                  <p className="text-small-bold">
                    לא ניתן לייצר תוכן נוסף כי נגמרו הקרדיטים מאנתרופיק.
                  </p>
                  <p>יש להטעין קרדיטים מחדש באתר אנתרופיק.</p>
                </div>
                <a
                  href={ANTHROPIC_BILLING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-small-bold text-text-primary-default hover:underline shrink-0"
                >
                  להטעינה ←
                </a>
              </div>
            )
          }

          // Two-line copy per reason: bold title (what went wrong) on top,
          // action description below. Lets the user scan the banner without
          // parsing a full sentence.
          const reasonCopy = (reason: FileIssueReason, fileLabel: string): { title: string; description: string } => {
            switch (reason) {
              case "missing":
              case "no_file":
                return {
                  title: `עדיין לא הוזן ${fileLabel}`,
                  description: "אפשר להעלות קובץ או להזין ידנית בהגדרות.",
                }
              case "parse_failed":
                return {
                  title: `הניתוח של ${fileLabel} לא הצליח`,
                  description: "אפשר לנסות להעלות שוב או להזין ידנית בהגדרות.",
                }
              case "file_invalid":
                return {
                  title: `הקובץ שהועלה עבור ${fileLabel} לא תקין`,
                  description: "צריך לנסות קובץ docx/pdf אחר, ולוודא שאינו פגום.",
                }
              case "file_too_long":
                return {
                  title: `הקובץ שהועלה עבור ${fileLabel} ארוך מדי לעיבוד`,
                  description: "צריך לקצר אותו ולהעלות שוב.",
                }
              case "multiple_audiences":
                return {
                  title: `הקובץ של ${fileLabel} מכיל יותר מקהל יעד אחד`,
                  description: "צריך להעלות קובץ נפרד לכל קהל, או להשאיר קהל אחד בלבד.",
                }
              case "ai_failed":
                return {
                  title: `הניתוח של ${fileLabel} נכשל`,
                  description: "אפשר לנסות להעלות שוב או להזין ידנית בהגדרות.",
                }
              case "no_credits":
                return {
                  title: `הניתוח של ${fileLabel} לא הצליח כי נגמרו הקרדיטים מאנתרופיק`,
                  description: "צריך להטעין קרדיטים ולנסות שוב.",
                }
              case "empty_content":
                return {
                  title: `הקובץ שהועלה עבור ${fileLabel} ריק או קצר מדי`,
                  description: "צריך להוסיף תוכן ולהעלות שוב.",
                }
              default:
                // Safety net — a future server-side reason must never bring
                // the home page down via undefined destructuring.
                return {
                  title: `יש בעיה ב-${fileLabel}`,
                  description: "אפשר לעדכן את הפרטים בהגדרות.",
                }
            }
          }

          // Per-reason deep link. `missing`/`no_file` point at the manual-entry
          // sub-section (about/you), everything else points at the file-upload
          // sub-section since the user is recovering from an upload/parse failure.
          const fileSettingsHref = (reason: FileIssueReason, kind: "style" | "audience") => {
            if (reason === "missing" || reason === "no_file") {
              return kind === "style"
                ? "/settings?tab=business&sub=about"
                : "/settings?tab=business&sub=you"
            }
            return "/settings?tab=business&sub=files"
          }

          const styleReason = profileHealth.styleFileIssue?.reason as FileIssueReason | undefined
          const audienceReason = profileHealth.audienceFileIssue?.reason as FileIssueReason | undefined

          const fileIssues: FileIssue[] = []
          if (styleReason) fileIssues.push({ key: "style", label: "מידע על העסק", reason: styleReason })
          if (audienceReason) fileIssues.push({ key: "audience", label: "ניתוח קהל היעד", reason: audienceReason })

          if (fileIssues.length > 0) {
            return (
              <div className="flex flex-col gap-2 mb-8">
                {fileIssues.map((issue) => {
                  const { title, description } = reasonCopy(issue.reason, issue.label)
                  return (
                    <div
                      key={issue.key}
                      className="rounded-xl border border-red-50 bg-red-95 px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="text-small text-text-primary-default">
                        <p className="text-small-bold">{title}</p>
                        <p>{description}</p>
                      </div>
                      <a
                        href={fileSettingsHref(issue.reason, issue.key)}
                        className="text-small-bold text-text-primary-default hover:underline shrink-0"
                      >
                        להגדרות ←
                      </a>
                    </div>
                  )
                })}
              </div>
            )
          }

          // Only when both identity files are healthy do we nudge toward
          // products/creators. The two files are the floor for generation
          // quality; pushing the user to add creators while their style
          // file is broken would scatter their attention.
          // Each missing inventory gets its own banner so the action wording
          // can stay specific ("יוצרים מהשטח שיפתחו את החשיבה" vs "מוצרים
          // לדייק את התוכן"). The "הכל מוכן ליצור תוכן! אבל..." prefix
          // repeats intentionally — treating the two as separate cards
          // keeps the link target tied to its message.
          const improvements: Array<{ key: string; body: string; href: string }> = []
          if (!profileHealth.hasCreators) {
            improvements.push({
              key: "creators",
              body: "כדי להפיק את המירב מהמערכת יש לעדכן גם יוצרים ולקבל רעיונות מהשטח שיפתחו את החשיבה.",
              href: "/settings?tab=creators",
            })
          }
          if (!profileHealth.hasProducts) {
            improvements.push({
              key: "products",
              body: "כדי לדייק עבורך את התוכן יש להכניס את כל המוצרים המוצעים בעסק.",
              href: "/settings?tab=products",
            })
          }

          if (improvements.length > 0) {
            return (
              <div className="flex flex-col gap-2 mb-8">
                {improvements.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="text-small text-text-primary-default">
                      <p className="text-small-bold">הכל מוכן ליצור תוכן! אבל...</p>
                      <p>{item.body}</p>
                    </div>
                    <a
                      href={item.href}
                      className="text-small-bold text-text-primary-default hover:underline shrink-0"
                    >
                      להגדרות ←
                    </a>
                  </div>
                ))}
              </div>
            )
          }

          return null
        })()}

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

        {/* Onboarding-progress banner — sits BELOW the greeting/title per the
            brief ("באנר מתחת לכותרת"). Only rendered under ?variant=a|b. */}
        {showBanner && bannerVariant && (
          <OnboardingProgressBanner
            variant={bannerVariant}
            stages={makeStages(bannerDone)}
          />
        )}

        <div className="flex flex-col gap-10">
          {/* Same notice as /hooks — the home page generates hooks too, so a
              user who never opens the warehouse still has to see it. Renders
              nothing once a Gemini key is connected. */}
          <GeminiConnectNotice />

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
                <HomeMicRecorder value={idea} onChange={setIdea} />
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

      {/* Floating "report a bug" button — bottom corner, to the left of the
          right-pinned sidebar (3rem on desktop). Home page only. */}
      <button
        type="button"
        dir="rtl"
        onClick={() => setBugModalOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-full bg-button-primary-default px-3.5 py-2.5 text-sm font-semibold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)] transition hover:brightness-90 md:right-[4.5rem]"
      >
        <Bug className="size-[18px]" />
        נתקלת בבאג?
      </button>

      <BugReportModal open={bugModalOpen} onOpenChange={setBugModalOpen} />
    </AppShell>
  )
}
