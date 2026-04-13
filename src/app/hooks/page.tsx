"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Anchor, Loader2, Sparkles, LayoutGrid, List, Star, Search, ChevronDown, Check } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { HookCard } from "@/components/hook-card"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { useAutoAnimate } from "@formkit/auto-animate/react"

interface HookItem {
  id: string
  hook_text: string
  is_used: boolean
  created_at: string
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

async function streamHooks(
  onHook: (hook: HookItem) => void,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  // Load field ideas from localStorage to pass to hooks API
  let fieldIdeas: string[] = []
  try {
    const saved = localStorage.getItem("generatedIdeas_v23")
    if (saved) fieldIdeas = JSON.parse(saved).map((i: { text: string }) => i.text)
  } catch { /* ignore */ }

  const res = await fetch("/api/homepage-hooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldIdeas }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    onError(data.error || "שגיאה ביצירת הוקים")
    return
  }

  const reader = res.body?.getReader()
  if (!reader) { onError("שגיאה בחיבור"); return }

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
      if (!data || data === "[DONE]") { if (data === "[DONE]") onDone(); continue }
      try {
        const parsed = JSON.parse(data)
        if (parsed.error) { onError(parsed.error); continue }
        if (parsed.hook_text) onHook(parsed as HookItem)
      } catch { /* skip */ }
    }
  }
  onDone()
}

export default function HooksPage() {
  const router = useRouter()
  const [hooks, setHooks] = useState<HookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [skeletonCount, setSkeletonCount] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState("all")
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [sessionGridRef] = useAutoAnimate({ duration: 500, easing: "ease-out" })

  const loadHooks = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: hooksData }, { data: prodsData }] = await Promise.all([
      supabase
        .from("hooks")
        .select("id, hook_text, is_used, created_at")
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
    try {
      const favs = localStorage.getItem("hookFavorites")
      if (favs) setFavorites(new Set(JSON.parse(favs)))
    } catch { /* ignore */ }
  }, [])

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

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("hookFavorites", JSON.stringify([...next]))
      return next
    })
  }

  const handleGenerateMore = async () => {
    setGenerating(true)
    setSkeletonCount(20)
    let newCount = 0

    await streamHooks(
      (hook) => {
        setHooks((prev) => [hook, ...prev])
        newCount++
        setSkeletonCount(Math.max(0, 20 - newCount))
      },
      () => {
        setSkeletonCount(0)
        setGenerating(false)
        localStorage.removeItem("homepageHooks_v5")
      },
      (msg) => {
        if (msg === "audience_missing") {
          toast.error("לא הצלחנו לקרוא את ניתוח קהל היעד. יש לעדכן את הקובץ בהגדרות.")
        } else {
          toast.error(msg || "שגיאה ביצירת הוקים")
        }
        setSkeletonCount(0)
        setGenerating(false)
      },
    )
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const supabase = createClient()
    supabase.from("hooks").delete().eq("id", id) // fire & forget
    // Let the slide-down play, then remove from state (triggers auto-animate re-layout)
    setTimeout(() => {
      setHooks((prev) => prev.filter((h) => h.id !== id))
      setDeletingId(null)
      toast("ההוק נמחק בהצלחה")
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
    toast("ההוק עודכן בהצלחה")
  }

  const matchesProduct = (hook: HookItem, productName: string) =>
    hook.hook_text.toLowerCase().includes(productName.toLowerCase())

  const filtered = hooks.filter((hook) => {
    if (showFavorites) return favorites.has(hook.id)
    if (filter === "general") return !products.some((p) => matchesProduct(hook, p.name))
    if (filter !== "all") return matchesProduct(hook, filter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      if (!hook.hook_text.toLowerCase().includes(q)) return false
    }
    return true
  })

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }).replace(/\//g, ".")
  }

  // Group by date
  const groupedByDate = (() => {
    const groups: Record<string, HookItem[]> = {}
    filtered.forEach((hook) => {
      const date = formatDate(hook.created_at)
      if (!groups[date]) groups[date] = []
      groups[date].push(hook)
    })
    return groups
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
                {filter === "all" ? "מוצרים" : filter === "general" ? "כללי" : filter}
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
                      onClick={() => { setFilter(p.name); setShowProductDropdown(false); setShowFavorites(false) }}
                      className="flex items-center justify-between w-full px-3 py-2 text-small text-text-primary-default hover:bg-gray-95 dark:hover:bg-gray-20 transition-colors"
                    >
                      {p.name}
                      {filter === p.name && <Check className="size-3" />}
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
                לחצי על ״ייצר לי עוד הוקים״ או צרי פוסט מהעמוד הראשי
              </p>
            </div>
          </div>
        )}

        {/* Skeletons while generating — always on top */}
        {skeletonCount > 0 && (
          <div className={`mb-8 ${viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}`}>
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <HookSkeleton key={`gen-skel-${i}`} />
            ))}
          </div>
        )}

        {/* Grouped by date */}
        {!loading && Object.keys(groupedByDate).length > 0 && (
          <div className="flex flex-col gap-8">
            {Object.entries(groupedByDate).map(([date, items]) => (
              <section key={date}>
                <p className="text-small text-text-neutral-default mb-4">{date}</p>
                <div ref={sessionGridRef} className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
                  {items.map((hook) => (
                    <div
                      key={hook.id}
                      className={`transition-all duration-400 ease-out ${deletingId === hook.id ? "opacity-0 translate-y-6 scale-95" : ""}`}
                    >
                      <HookCard
                        hookText={hook.hook_text}
                        onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hook.hook_text)}`)}
                        onEdit={!hook.is_used ? (newText) => handleEdit(hook.id, newText) : undefined}
                        onDelete={() => handleDelete(hook.id)}
                        onToggleFavorite={() => toggleFavorite(hook.id)}
                        isFavorite={favorites.has(hook.id)}
                        used={hook.is_used}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* No results for filter */}
        {!loading && hooks.length > 0 && Object.keys(groupedByDate).length === 0 && !generating && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="text-p text-text-neutral-default">אין הוקים בפילטר הזה</p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
