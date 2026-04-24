"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Lightbulb, Loader2, Sparkles, LayoutGrid, List, Star, Search, ChevronDown, Check } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { StickyNote } from "@/components/sticky-note"
import { useAutoAnimate } from "@formkit/auto-animate/react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"

interface IdeaNote {
  text: string
  source: string
  url?: string
  profileUrl?: string
  category?: string
  createdAt?: string
}

function IdeaSkeleton() {
  return (
    <div className="aspect-square rounded-lg bg-white dark:bg-gray-10 border border-border-neutral-default p-5 flex flex-col justify-between">
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
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }).replace(/\//g, ".")
}

// Strip a leading "<source>:" / "טרנד:" label from the idea body — the source
// is already shown as the bottom-left tag, so repeating it in the copy is noise.
// Case-insensitive and tries both with/without the "@" prefix, so "MDS: ..." and
// "@mds: ..." both match when the stored source is "@MDS".
// Safety: if stripping would leave an empty body, return the original text so
// the note still has a description to show.
function stripSourcePrefix(text: string, source: string): string {
  const t = text.trimStart()
  const clean = source.replace(/^@/, "").trim()
  const labels = [source, `@${clean}`, clean, "טרנד"].filter((l) => l.length > 0)
  const seps = [": ", ":", " - ", " — ", " – "]
  const lower = t.toLowerCase()
  for (const label of labels) {
    for (const sep of seps) {
      const prefix = (label + sep).toLowerCase()
      if (lower.startsWith(prefix)) {
        const stripped = t.slice(prefix.length).trimStart()
        if (stripped.length > 0) return stripped
      }
    }
  }
  return t
}

export default function IdeasPage() {
  const router = useRouter()
  const [ideas, setIdeas] = useState<IdeaNote[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [skeletonCount, setSkeletonCount] = useState(0)
  const [error, setError] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [typeFilter, setTypeFilter] = useState<"all" | "creators" | "trends">("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [creatorFilter, setCreatorFilter] = useState("all")
  const [showCreatorDropdown, setShowCreatorDropdown] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  // Keyed by trimmed idea text — stable across re-ordering when new ideas are prepended
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [gridRef] = useAutoAnimate({ duration: 400, easing: "ease-out" })
  const generatingRef = useRef(false)
  const ideasRef = useRef<IdeaNote[]>([])
  const sessionKeysRef = useRef<Set<string>>(new Set())
  const [sessionTick, setSessionTick] = useState(0) // force re-render
  const [statusMessage, setStatusMessage] = useState("")

  // Status messages cycle while generating
  useEffect(() => {
    if (!generating) { setStatusMessage(""); return }
    const messages = [
      "מחפש יוצרי תוכן מובילים בנישה...",
      "סורק מאמרי 'top creators' באינטרנט...",
      "מאמת מספרי עוקבים באינסטגרם...",
      "מאתר רילסים ויראליים...",
      "קורא את הקפשנים מהרילסים...",
      "מסנן תוכן פרסומי...",
      "מצליב עם הכאבים של הקהל שלך...",
      "מחבר רעיונות עם נושאים חמים...",
      "מסכם את מה שהיוצרים אמרו...",
    ]
    let i = 0
    setStatusMessage(messages[0])
    const interval = setInterval(() => {
      i = (i + 1) % messages.length
      setStatusMessage(messages[i])
    }, 2500)
    return () => clearInterval(interval)
  }, [generating])

  const STORAGE_KEY = "generatedIdeas_v23"
  const SESSION_KEYS_STORAGE = "ideaSessionKeys_v1"

  const dedupe = useCallback((arr: IdeaNote[]): IdeaNote[] => {
    const seen = new Set<string>()
    return arr.filter((idea) => {
      const key = idea.text.trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [])

  const saveToStorage = useCallback((arr: IdeaNote[]) => {
    const clean = dedupe(arr)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  }, [dedupe])

  // Load from localStorage + DB favorites — once
  useEffect(() => {
    const load = async () => {
      let loadedIdeas: IdeaNote[] = []
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          loadedIdeas = dedupe(JSON.parse(saved))
        }

        const savedSession = localStorage.getItem(SESSION_KEYS_STORAGE)
        if (savedSession) {
          const sessionArr = JSON.parse(savedSession) as string[]
          const loadedKeys = new Set(loadedIdeas.map((i) => i.text.trim()))
          const validKeys = sessionArr.filter((k) => loadedKeys.has(k))
          if (validKeys.length > 0) {
            sessionKeysRef.current = new Set(validKeys)
          } else if (loadedIdeas.length > 0) {
            sessionKeysRef.current = new Set(loadedIdeas.slice(0, 9).map((i) => i.text.trim()))
          }
        } else if (loadedIdeas.length > 0) {
          sessionKeysRef.current = new Set(loadedIdeas.slice(0, 9).map((i) => i.text.trim()))
        }
      } catch { /* ignore */ }

      // Load favorites from DB (persists across devices/logins)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: favsData } = await supabase
            .from("idea_favorites")
            .select("idea_text, idea_data")
            .eq("user_id", user.id)
          if (favsData) {
            const favTexts = new Set(favsData.map((f) => (f as { idea_text: string }).idea_text))
            setFavorites(favTexts)
            // Rehydrate any DB-favorited ideas that aren't in localStorage (e.g. fresh device)
            const localKeys = new Set(loadedIdeas.map((i) => i.text.trim()))
            const missing = favsData
              .filter((f) => !localKeys.has((f as { idea_text: string }).idea_text))
              .map((f) => (f as { idea_data: Record<string, unknown> }).idea_data as unknown as IdeaNote)
              .filter((i) => i && i.text)
            if (missing.length > 0) loadedIdeas = dedupe([...loadedIdeas, ...missing])
          }
        }
      } catch { /* ignore */ }

      setIdeas(loadedIdeas)
      ideasRef.current = loadedIdeas
      setSessionTick((t) => t + 1)
      setLoading(false)
    }
    load()
  }, [dedupe])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showCategoryDropdown && !showCreatorDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (showCategoryDropdown && !target.closest("[data-category-dropdown]")) setShowCategoryDropdown(false)
      if (showCreatorDropdown && !target.closest("[data-creator-dropdown]")) setShowCreatorDropdown(false)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [showCategoryDropdown, showCreatorDropdown])

  const toggleFavorite = async (idea: IdeaNote) => {
    const key = idea.text.trim()
    const wasFav = favorites.has(key)
    // Optimistic update
    setFavorites((prev) => {
      const next = new Set(prev)
      if (wasFav) next.delete(key)
      else next.add(key)
      return next
    })

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setFavorites((prev) => {
        const next = new Set(prev)
        if (wasFav) next.add(key)
        else next.delete(key)
        return next
      })
      return
    }

    const { error } = wasFav
      ? await supabase.from("idea_favorites").delete().eq("user_id", user.id).eq("idea_text", key)
      : await supabase.from("idea_favorites").insert({
          user_id: user.id,
          idea_text: key,
          idea_data: idea as unknown as Record<string, unknown>,
        } as never)

    if (error) {
      setFavorites((prev) => {
        const next = new Set(prev)
        if (wasFav) next.add(key)
        else next.delete(key)
        return next
      })
      toast.error("שגיאה בשמירת המועדף")
    }
  }

  const isTrend = (idea: IdeaNote) => idea.source === "טרנד" || idea.source.toLowerCase() === "trend" || idea.text.startsWith("טרנד:")
  const isCreator = (idea: IdeaNote) => !isTrend(idea)

  // Extract categories only from ideas that pass current type filter
  const categories = useMemo(() => {
    const cats = new Set<string>()
    ideas.forEach((idea) => {
      if (typeFilter === "creators" && !isCreator(idea)) return
      if (typeFilter === "trends" && !isTrend(idea)) return
      if (idea.category) cats.add(idea.category)
    })
    return [...cats]
  }, [ideas, typeFilter])

  // Extract unique creators (non-trend sources)
  const creators = useMemo(() => {
    const set = new Set<string>()
    ideas.forEach((idea) => {
      if (idea.source && !isTrend(idea)) set.add(idea.source)
    })
    return [...set]
  }, [ideas])

  // Filter ideas — favorites overrides all other filters
  const filtered = useMemo(() => {
    return ideas.filter((idea) => {
      if (showFavorites) return favorites.has(idea.text.trim())
      if (typeFilter === "creators" && !isCreator(idea)) return false
      if (typeFilter === "trends" && !isTrend(idea)) return false
      if (creatorFilter !== "all" && idea.source !== creatorFilter) return false
      if (categoryFilter !== "all" && idea.category !== categoryFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        if (!idea.text.toLowerCase().includes(q) && !idea.source.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [ideas, showFavorites, typeFilter, creatorFilter, categoryFilter, searchQuery, favorites])

  // Split into "session" (חדש) and grouped by date
  const { sessionIdeas, dateGroups } = useMemo(() => {
    const session: { idea: IdeaNote; originalIndex: number }[] = []
    const groups: Record<string, { idea: IdeaNote; originalIndex: number }[]> = {}
    filtered.forEach((idea) => {
      const key = idea.text.trim()
      const item = { idea, originalIndex: ideas.indexOf(idea) }
      if (sessionKeysRef.current.has(key)) {
        session.push(item)
      } else {
        const date = idea.createdAt ? formatDate(idea.createdAt) : "ללא תאריך"
        if (!groups[date]) groups[date] = []
        groups[date].push(item)
      }
    })
    return { sessionIdeas: session, dateGroups: groups }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, ideas, sessionTick])

  const handleGenerateMore = async () => {
    if (generatingRef.current) return // prevent double calls
    generatingRef.current = true
    setGenerating(true)
    setSkeletonCount(9)
    setError("")
    let newCount = 0

    // Reset session keys — new generation starts a fresh "חדש" group
    sessionKeysRef.current = new Set<string>()
    setSessionTick((t) => t + 1)

    // Snapshot current ideas for previousIdeas
    const currentIdeas = ideasRef.current

    // Collect favorited ideas to signal preference
    const favoritedIdeas = currentIdeas
      .map((idea) => favorites.has(idea.text.trim()) ? { text: idea.text, source: idea.source, category: idea.category } : null)
      .filter(Boolean)

    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousIdeas: currentIdeas.map((i) => i.text),
          // Every content URL ever shown on this device — localStorage-backed,
          // never expires. Server uses this to filter contentItems + trends so
          // no post is ever shown twice.
          previousUrls: Array.from(
            new Set(
              currentIdeas
                .map((i) => i.url)
                .filter((u): u is string => !!u && u.trim().length > 0),
            ),
          ),
          existingCategories: [...new Set(currentIdeas.map((i) => i.category).filter(Boolean))],
          favoritedIdeas,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const known = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "audience_missing", "core_identity_missing", "unauthorized", "no_trends_found", "no_creator_content", "no_fresh_content", "trend_search_failed", "search_not_configured", "search_quota_exceeded", "apify_quota_exceeded"]
        const raw = data.error
        setError(known.includes(raw) ? raw : (raw || "generic"))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setError("connection_error"); return }

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
              const known = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "no_ideas_generated", "all_ideas_duplicate"]
              setError(known.includes(idea.error) ? idea.error : (idea.error || "generic"))
              continue
            }
            if (!idea.text) continue
            // Use FULL text as dedup key (not just first 60 chars)
            const key = idea.text.trim()
            // Skip only if already added in CURRENT session
            if (sessionKeysRef.current.has(key)) continue
            sessionKeysRef.current.add(key)
            // Remove any old version from ideasRef and add the new one at the top
            ideasRef.current = [idea, ...ideasRef.current.filter((i) => i.text.trim() !== key)]
            setIdeas([...ideasRef.current])
            setSessionTick((t) => t + 1)
            newCount++
            setSkeletonCount(Math.max(0, 9 - newCount))
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      console.error("Ideas stream error:", err)
    } finally {
      // Save to localStorage once at the end
      saveToStorage(ideasRef.current)
      localStorage.setItem(SESSION_KEYS_STORAGE, JSON.stringify([...sessionKeysRef.current]))
      setGenerating(false)
      setSkeletonCount(0)
      generatingRef.current = false
    }
  }

  const renderIdea = (idea: IdeaNote, originalIndex: number) => {
    const isFav = favorites.has(idea.text.trim())
    const displayText = stripSourcePrefix(idea.text, idea.source)
    if (viewMode === "grid") {
      return (
        <div key={`${idea.text.slice(0, 20)}-${originalIndex}`} className="aspect-square">
          <StickyNote
            text={displayText}
            source={idea.source}
            url={idea.url}
            profileUrl={idea.profileUrl}
            onClick={() => router.push(`/project?idea=${encodeURIComponent(idea.text)}`)}
            overlay={
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(idea) }}
                className={`absolute top-2 left-2 p-1 rounded-full transition-opacity ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <Star className={`size-3.5 ${isFav ? "fill-yellow-50 text-yellow-50" : "text-yellow-30 hover:text-yellow-10"}`} />
              </button>
            }
          />
        </div>
      )
    }
    return (
      <div
        key={`${idea.text.slice(0, 20)}-${originalIndex}`}
        onClick={() => router.push(`/project?idea=${encodeURIComponent(idea.text)}`)}
        className="flex items-start gap-4 rounded-xl bg-bg-surface-hover hover:bg-bg-surface-primary-default-80 p-4 cursor-pointer transition-colors group"
      >
        <div className="flex-1 min-w-0" dir="rtl">
          <p className="text-small text-text-primary-default line-clamp-2">{displayText}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs-body text-yellow-30">{idea.source}</span>
            {idea.category && <span className="text-xs-body text-text-neutral-default">· {idea.category}</span>}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(idea) }}
          className={`p-1 shrink-0 transition-opacity ${isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <Star className={`size-3.5 ${isFav ? "fill-yellow-50 text-yellow-50" : "text-yellow-30"}`} />
        </button>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="flex items-start gap-2">
            <img src="/images/idea-min.png" alt="" className="w-[48px] h-[48px]" />
            <div>
              <h2 className="text-text-primary-default">רעיונות מהשטח</h2>
              <p className="text-small text-text-neutral-default mt-1">
                אפשר לייצר רעיונות לתכנים מהיוצרים המובילים שבחרתם. אפשר לערוך אותם תמיד ב
                <Link href="/settings?tab=creators" className="text-text-primary-default underline hover:no-underline">
                  הגדרות
                </Link>
                .
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleGenerateMore}
            disabled={generating}
            className="gap-1.5 shrink-0"
          >
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {generating ? "מייצר רעיונות..." : "זרוק לי עוד רעיונות"}
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-6">
          {/* All tag */}
          <span
            onClick={() => { setTypeFilter("all"); setCreatorFilter("all"); setCategoryFilter("all"); setShowFavorites(false) }}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-small transition-colors ${
              !showFavorites && typeFilter === "all" && creatorFilter === "all"
                ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            הכל
          </span>

          {/* Creators dropdown */}
          <div className="relative" data-creator-dropdown>
            <button
              onClick={() => { setShowCreatorDropdown(!showCreatorDropdown) }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-small transition-colors ${
                !showFavorites && (typeFilter === "creators" || creatorFilter !== "all")
                  ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                  : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
              }`}
            >
              {creatorFilter !== "all" ? creatorFilter : "יוצרי תוכן מובילים"}
              <ChevronDown className="size-3" />
            </button>
            {showCreatorDropdown && (
              <div className="absolute top-full mt-1 right-0 z-10 w-56 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-lg py-1 max-h-64 overflow-y-auto">
                <button
                  onClick={() => { setTypeFilter("creators"); setCreatorFilter("all"); setCategoryFilter("all"); setShowCreatorDropdown(false); setShowFavorites(false) }}
                  className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                >
                  כל היוצרים
                  {typeFilter === "creators" && creatorFilter === "all" && <Check className="size-3" />}
                </button>
                {creators.map((creator) => (
                  <button
                    key={creator}
                    onClick={() => { setTypeFilter("creators"); setCreatorFilter(creator); setCategoryFilter("all"); setShowCreatorDropdown(false); setShowFavorites(false) }}
                    className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                  >
                    {creator}
                    {creatorFilter === creator && <Check className="size-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Trends tag */}
          <span
            onClick={() => { setTypeFilter("trends"); setCreatorFilter("all"); setCategoryFilter("all"); setShowFavorites(false) }}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-small transition-colors ${
              !showFavorites && typeFilter === "trends"
                ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            טרנדים ברשת
          </span>

          {/* Category dropdown */}
          <div className="relative" data-category-dropdown>
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-small transition-colors ${
                categoryFilter !== "all"
                  ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                  : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
              }`}
            >
              {categoryFilter === "all" ? "קטגוריות" : categoryFilter}
              <ChevronDown className="size-3" />
            </button>
            {showCategoryDropdown && (
              <div className="absolute top-full mt-1 right-0 z-10 w-48 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-lg py-1">
                <button
                  onClick={() => { setCategoryFilter("all"); setShowCategoryDropdown(false); setShowFavorites(false) }}
                  className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                >
                  הכל
                  {categoryFilter === "all" && <Check className="size-3" />}
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setCategoryFilter(cat); setShowCategoryDropdown(false); setShowFavorites(false) }}
                    className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                  >
                    {cat}
                    {categoryFilter === cat && <Check className="size-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Favorites */}
          <span
            onClick={() => setShowFavorites(!showFavorites)}
            className={`cursor-pointer flex items-center gap-1.5 rounded-full px-3 py-1.5 text-small transition-colors ${
              showFavorites
                ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
            }`}
          >
            <Star className={`size-3 ${showFavorites ? "fill-yellow-50 text-yellow-50" : ""}`} />
            מועדפים
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-[200px]">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-neutral-default pointer-events-none" />
            <Input
              inputSize="small"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש רעיונות..."
              className="ps-8 text-xs"
            />
          </div>

          {/* View switcher */}
          <div className="flex items-center bg-bg-surface dark:bg-white/5 rounded-lg h-[34px] px-1.5 gap-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                viewMode === "grid"
                  ? "bg-white dark:bg-white/10 shadow-sm text-text-primary-default"
                  : "text-text-neutral-default hover:text-text-primary-default"
              }`}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                viewMode === "list"
                  ? "bg-white dark:bg-white/10 shadow-sm text-text-primary-default"
                  : "text-text-neutral-default hover:text-text-primary-default"
              }`}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>

        {error && (() => {
          const infoCodes = ["credits_exhausted", "anthropic_overloaded", "anthropic_not_connected", "audience_missing", "core_identity_missing", "unauthorized", "no_trends_found", "no_creator_content", "no_fresh_content", "no_ideas_generated", "all_ideas_duplicate", "trend_search_failed", "search_not_configured", "search_quota_exceeded", "apify_quota_exceeded"]
          const isInfo = infoCodes.includes(error)
          const config: Record<string, { message: string; action?: { href: string; label: string; external?: boolean } }> = {
            credits_exhausted: {
              message: "לא הצלחנו לייצר את התכנים כי נגמרו לכם הקרדיטים של Anthropic",
              action: { href: "https://console.anthropic.com/settings/billing", label: "לרכישת קרדיטים נוספים →", external: true },
            },
            anthropic_overloaded: { message: "השרתים של Anthropic עמוסים כרגע. נסו שוב בעוד דקה" },
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
            no_fresh_content: {
              message: "כל התוכן שיש לנו כרגע מהיוצרים שלכם ומהטרנדים כבר הוצג לכם. נסו שוב בעוד כמה שעות — ייטען תוכן חדש מהיוצרים, או הוסיפו יוצרים נוספים",
              action: { href: "/settings?tab=business", label: "להוספת יוצרים נוספים →" },
            },
            no_ideas_generated: { message: "הסוכן סיים אבל לא החזיר אף רעיון. זה יכול לקרות כשאין מספיק חומר גלם — נסו שוב בעוד רגע" },
            all_ideas_duplicate: { message: "כל הרעיונות שהתקבלו כבר קיימים במחסן שלכם. נסו שוב — בדרך כלל ריצה חדשה מביאה נושאים חדשים" },
            trend_search_failed: { message: "חיפוש הטרנדים ברשת נכשל. נסו שוב בעוד רגע — אם זה חוזר כנראה יש בעיה בשירות החיפוש שלנו" },
            search_not_configured: { message: "שירות החיפוש לא מוגדר במערכת. צרו קשר עם התמיכה" },
            search_quota_exceeded: { message: "נגמרה מכסת החיפושים של הרעיונות, פנו לשירות שלנו לטיפול בתקלה" },
            apify_quota_exceeded: {
              message: "נגמרה מכסת ה-Apify שלכם (האחראי על משיכת הפוסטים מהיוצרים). אפשר לבדוק את יתרת הקרדיטים ולשדרג ב-Apify או להמתין לחידוש החודשי",
              action: { href: "https://console.apify.com/billing", label: "לבדיקת יתרת Apify →", external: true },
            },
            connection_error: { message: "בעיית חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב" },
            generic: { message: "משהו השתבש ביצירת הרעיונות. נסו שוב בעוד רגע" },
          }
          const c = config[error] ?? { message: error }
          return (
            <div className={`w-full rounded-xl border p-4 text-center mb-6 ${
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

        {loading && (
          <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <IdeaSkeleton key={i} />)}
          </div>
        )}

        {!loading && ideas.length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-2xl bg-bg-surface p-6">
              <Lightbulb className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-p text-text-neutral-default">עדיין אין רעיונות</p>
              <p className="text-small text-text-primary-disabled mt-1">
                לחצו על ״זרוק לי עוד רעיונות״ כדי לייצר רעיונות מהשטח
              </p>
            </div>
          </div>
        )}

        {/* Session ideas (חדש) */}
        {!loading && (sessionIdeas.length > 0 || generating) && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <p className="text-small text-text-neutral-default">
                חדש ({sessionIdeas.length}{generating ? "..." : ""})
              </p>
              {generating && statusMessage && (
                <p className="text-small text-text-primary-default animate-in fade-in duration-300" key={statusMessage}>
                  {statusMessage}
                </p>
              )}
            </div>
            <div
              className={viewMode === "grid"
                ? "grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                : "flex flex-col gap-2"
              }
            >
              {sessionIdeas.map(({ idea, originalIndex }) => renderIdea(idea, originalIndex))}
              {Array.from({ length: skeletonCount }).map((_, i) => <IdeaSkeleton key={`skel-${i}`} />)}
            </div>
          </section>
        )}

        {/* Grouped by date */}
        {!loading && Object.keys(dateGroups).length > 0 && (
          <div className="flex flex-col gap-8">
            {Object.entries(dateGroups).map(([date, items]) => (
              <section key={date}>
                <p className="text-small text-text-neutral-default mb-4">{date}</p>
                <div
                  ref={gridRef}
                  className={viewMode === "grid"
                    ? "grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                    : "flex flex-col gap-2"
                  }
                >
                  {items.map(({ idea, originalIndex }) => renderIdea(idea, originalIndex))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* No results for filter */}
        {!loading && ideas.length > 0 && sessionIdeas.length === 0 && Object.keys(dateGroups).length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="text-p text-text-neutral-default">אין רעיונות בקטגוריה הזו</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
