"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Anchor, Loader2, Sparkles, LayoutGrid, List, Star, Search, ChevronDown, Check } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmModal } from "@/components/confirm-modal"
import { HookCard } from "@/components/hook-card"
import { GeneratingStatus } from "@/components/generating-status"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { useHookGeneration } from "@/components/hook-generation-provider"

interface HookItem {
  id: string
  hook_text: string
  is_used: boolean
  is_favorite: boolean
  created_at: string
  product_ids?: string[]
}

function HookSkeleton() {
  return (
    <div className="rounded-[16px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4 flex flex-col gap-3">
      <Skeleton className="h-4 w-full rounded-md" />
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <div className="flex justify-end">
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  )
}

export default function HooksPage() {
  const router = useRouter()
  const {
    isGenerating: generating,
    progress,
    total,
    sessionHookIds,
    startGeneration,
    subscribeHook,
    subscribeDone,
  } = useHookGeneration()
  const skeletonCount = generating ? Math.max(0, total - progress) : 0

  const [hooks, setHooks] = useState<HookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState("all")
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  const loadHooks = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: hooksData }, { data: prodsData }] = await Promise.all([
      supabase
        .from("hooks")
        .select("id, hook_text, is_used, is_favorite, created_at, product_ids")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name")
        .eq("user_id", user.id),
    ])

    if (hooksData) setHooks(hooksData as HookItem[])
    if (prodsData) setProducts(prodsData as { id: string; name: string }[])
    setLoading(false)
  }

  useEffect(() => {
    loadHooks()
  }, [])

  // Stream incoming hooks into the local list + session IDs while this page is
  // mounted. The provider owns the fetch and keeps running even if we unmount
  // (user navigated away) — in that case these subscriptions are torn down and
  // the provider just updates its own state + the persistent toast.
  useEffect(() => {
    const unsub = subscribeHook((hook) => {
      setHooks((prev) => prev.some((h) => h.id === hook.id) ? prev : [hook as HookItem, ...prev])
    })
    return unsub
  }, [subscribeHook])

  useEffect(() => {
    const unsub = subscribeDone(() => {
      // Re-sync from DB so product_ids + any missed hooks are picked up.
      loadHooks()
    })
    return unsub
  }, [subscribeDone])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showProductDropdown) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-product-dropdown]")) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [showProductDropdown])

  const toggleFavorite = async (id: string) => {
    const current = hooks.find((h) => h.id === id)
    if (!current) return
    const next = !current.is_favorite
    setHooks((prev) => prev.map((h) => h.id === id ? { ...h, is_favorite: next } : h))
    const supabase = createClient()
    const { error } = await supabase
      .from("hooks")
      .update({ is_favorite: next } as never)
      .eq("id", id)
    if (error) {
      setHooks((prev) => prev.map((h) => h.id === id ? { ...h, is_favorite: !next } : h))
      toast.error("שגיאה בשמירת המועדף")
    }
  }

  const handleGenerateMore = () => {
    // Provider owns the fetch + state + toast. Incoming hooks arrive via
    // subscribeHook (above) while this page is mounted; if user navigates,
    // the provider keeps going and the toast persists at the bottom.
    startGeneration()
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const supabase = createClient()
    supabase.from("hooks").delete().eq("id", id) // fire & forget
    // Let the slide-down play, then remove from state (triggers auto-animate re-layout)
    setTimeout(() => {
      setHooks((prev) => prev.filter((h) => h.id !== id))
      setDeletingId(null)
      toast.success("ההוק נמחק בהצלחה")
    }, 450)
  }

  const handleEdit = async (id: string, newText: string) => {
    const supabase = createClient()
    const hook = hooks.find((h) => h.id === id)
    const oldText = hook?.hook_text
    await supabase.from("hooks").update({ hook_text: newText }).eq("id", id)
    if (oldText) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from("core_posts")
          .update({ hook_text: newText } as never)
          .eq("user_id", user.id)
          .eq("hook_text", oldText)
      }
    }
    setHooks((prev) => prev.map((h) => h.id === id ? { ...h, hook_text: newText } : h))
    toast.success("ההוק עודכן בהצלחה")
  }

  // filter values:
  //  "all"       — show everything (subject to search/favorites)
  //  "general"   — hooks that weren't tagged to any product (general brand voice)
  //  <productId> — hooks whose product_ids array contains this uuid
  const filtered = hooks.filter((hook) => {
    if (showFavorites) return hook.is_favorite
    const tags = hook.product_ids ?? []
    if (filter === "general") {
      if (tags.length > 0) return false
    } else if (filter !== "all") {
      if (!tags.includes(filter)) return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (!hook.hook_text.toLowerCase().includes(q)) return false
    }
    return true
  })

  const filterLabel = filter === "all"
    ? "מוצרים"
    : filter === "general"
      ? "כללי"
      : products.find((p) => p.id === filter)?.name ?? "מוצרים"

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }).replace(/\//g, ".")
  }

  const todayDateLabel = formatDate(new Date().toISOString())

  // Group by date — hooks within each group sorted newest first,
  // groups themselves keyed by an ISO day so we can sort chronologically.
  const groupedByDate = (() => {
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    const groups = new Map<string, HookItem[]>()
    // Ensure today's section appears (with skeletons) even if no hooks exist yet
    if (skeletonCount > 0) {
      const t = new Date()
      const todayKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
      groups.set(todayKey, [])
    }
    for (const hook of sorted) {
      const d = new Date(hook.created_at)
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      const existing = groups.get(dayKey)
      if (existing) existing.push(hook)
      else groups.set(dayKey, [hook])
    }
    // Map iteration preserves insertion order; since `sorted` is desc by time,
    // groups are already inserted newest day first.
    const result: Record<string, HookItem[]> = {}
    for (const [dayKey, items] of groups) {
      const label = items.length > 0 ? formatDate(items[0].created_at) : todayDateLabel
      result[label] = items
      void dayKey
    }
    return result
  })()

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <img src="/images/hook-min.png" alt="" className="w-[48px] h-[48px]" />
            <h2 className="text-text-primary-default">מחסן הוקים</h2>
          </div>
          <Button
            size="sm"
            onClick={handleGenerateMore}
            disabled={generating}
            className="gap-1.5"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generating ? "מייצר הוקים..." : "ייצר לי עוד הוקים"}
          </Button>
        </div>

        {/* Filter bar + view switcher */}
        {!loading && hooks.length > 0 && (
          <div className="flex items-center gap-2 mb-6">
            {/* Product dropdown */}
            <div className="relative" data-product-dropdown>
              <button
                onClick={() => setShowProductDropdown(!showProductDropdown)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-small transition-colors ${
                  !showFavorites && filter !== "all"
                    ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                    : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
                }`}
              >
                {filterLabel}
                <ChevronDown className="size-3" />
              </button>
              {showProductDropdown && (
                <div className="absolute top-full mt-1 right-0 z-10 w-48 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-lg py-1">
                  <button
                    onClick={() => { setFilter("all"); setShowProductDropdown(false); setShowFavorites(false) }}
                    className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                  >
                    הכל
                    {filter === "all" && <Check className="size-3" />}
                  </button>
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setFilter(p.id); setShowProductDropdown(false); setShowFavorites(false) }}
                      className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                    >
                      {p.name}
                      {filter === p.id && <Check className="size-3" />}
                    </button>
                  ))}
                  <button
                    onClick={() => { setFilter("general"); setShowProductDropdown(false); setShowFavorites(false) }}
                    className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                  >
                    כללי
                    {filter === "general" && <Check className="size-3" />}
                  </button>
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
                placeholder="חיפוש הוקים..."
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
        )}

        {loading && (
          <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
            {Array.from({ length: 6 }).map((_, i) => (
              <HookSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && hooks.length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-2xl bg-bg-surface p-6">
              <Anchor className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-p text-text-neutral-default">עדיין אין הוקים</p>
              <p className="text-small text-text-primary-disabled mt-1">
                לחצו על ״ייצר לי עוד הוקים״ או צרו פוסט מהעמוד הראשי
              </p>
            </div>
          </div>
        )}

        {/* Grouped by date */}
        {!loading && Object.keys(groupedByDate).length > 0 && (
          <div className="flex flex-col gap-8">
            {Object.entries(groupedByDate).map(([date, items]) => {
              const isToday = date === todayDateLabel
              const sessionItems = isToday
                ? sessionHookIds.map((id) => items.find((h) => h.id === id)).filter(Boolean) as HookItem[]
                : []
              const sessionIdSet = new Set(sessionHookIds)
              const restItems = isToday ? items.filter((h) => !sessionIdSet.has(h.id)) : items
              const renderHookCard = (hook: HookItem, opts?: { staggerIndex?: number }) => (
                <div
                  key={hook.id}
                  style={opts?.staggerIndex !== undefined ? { animationDelay: `${Math.min(opts.staggerIndex * 25, 500)}ms` } : undefined}
                  className={`transition-all duration-400 ease-out animate-hook-bump ${deletingId === hook.id ? "opacity-0 translate-y-6 scale-95" : ""}`}
                >
                  <HookCard
                    hookText={hook.hook_text}
                    onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hook.hook_text)}&hook_id=${hook.id}`)}
                    onEdit={!hook.is_used ? (newText) => handleEdit(hook.id, newText) : undefined}
                    onDelete={() => setPendingDeleteId(hook.id)}
                    onToggleFavorite={() => toggleFavorite(hook.id)}
                    isFavorite={hook.is_favorite}
                    used={hook.is_used}
                  />
                </div>
              )
              return (
                <section key={date}>
                  <div className="flex flex-col gap-2 mb-4">
                    <p className="text-small text-text-neutral-default">{date}</p>
                    {isToday && generating && <GeneratingStatus />}
                  </div>
                  <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
                    {/* Per-slot rendering: each slot is either a hook (once arrived) or a skeleton.
                        The slot index is stable, so the skeleton at slot N becomes the hook at slot N
                        without other slots shifting positions. */}
                    {(isToday && (sessionItems.length > 0 || skeletonCount > 0)) && (
                      Array.from({ length: sessionItems.length + skeletonCount }).map((_, i) => {
                        const hook = sessionItems[i]
                        if (hook) return renderHookCard(hook)
                        return <HookSkeleton key={`gen-skel-${i}`} />
                      })
                    )}
                    {/* Other today hooks (or all hooks for non-today dates) */}
                    {restItems.map((hook, idx) => renderHookCard(hook, { staggerIndex: idx }))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {/* No results for filter */}
        {!loading && hooks.length > 0 && Object.keys(groupedByDate).length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="text-p text-text-neutral-default">אין הוקים בפילטר הזה</p>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmModal
        open={!!pendingDeleteId}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
        title="בטוח למחוק את ההוק?"
        description="הפעולה הזו תמחק את ההוק מהמחסן"
        confirmLabel="כן, תמחק"
        cancelLabel="לא, חזור למחסן"
        onConfirm={() => { if (pendingDeleteId) handleDelete(pendingDeleteId) }}
      />
    </AppShell>
  )
}
