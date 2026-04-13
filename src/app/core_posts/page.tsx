"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { FileText, Loader2, ArrowLeft, LayoutGrid, List, Search } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const FORMAT_LABELS: Record<string, string> = {
  story: "סטורי",
  talking_head: "דיבור למצלמה",
  carousel: "קרוסלה",
  image_post: "תמונה",
}

interface SavedPost {
  id: string
  title: string | null
  body: string
  hook_text: string | null
  formats: string[]
  created_at: string
}

function groupByRecency(posts: SavedPost[]): { recent: SavedPost[]; older: SavedPost[] } {
  const now = Date.now()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  const recent: SavedPost[] = []
  const older: SavedPost[] = []
  for (const p of posts) {
    if (now - new Date(p.created_at).getTime() < sevenDays) {
      recent.push(p)
    } else {
      older.push(p)
    }
  }
  return { recent, older }
}

export default function CorePostsPage() {
  const router = useRouter()
  const [posts, setPosts] = useState<SavedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [formatFilter, setFormatFilter] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  useEffect(() => {
    fetch("/api/core-posts")
      .then((res) => res.json())
      .then((data) => {
        if (data.posts) setPosts(data.posts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const q = searchQuery.trim().toLowerCase()
  const filtered = posts.filter((p) => {
    if (formatFilter && !p.formats.includes(formatFilter)) return false
    if (q) {
      const haystack = `${p.title || ""} ${p.body} ${p.hook_text || ""}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
  const { recent, older } = groupByRecency(filtered)

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <img src="/images/letter-min.png" alt="" className="w-[48px] h-[48px]" />
            <h2 className="text-text-primary-default">פוסטי ליבה</h2>
          </div>
        </div>

        {/* Filter bar + view switcher */}
        {!loading && posts.length > 0 && (
          <div className="flex items-center gap-2 mb-6">
            {[
              { id: "", label: "הכל" },
              { id: "talking_head", label: "דיבור למצלמה" },
              { id: "carousel", label: "קרוסלה" },
              { id: "story", label: "סטורי" },
              { id: "image_post", label: "תמונה" },
            ].map((tab) => (
              <span
                key={tab.id}
                onClick={() => setFormatFilter(tab.id)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-small transition-colors ${
                  formatFilter === tab.id
                    ? "border border-gray-80 bg-white dark:bg-gray-10 text-text-primary-default"
                    : "bg-white dark:bg-gray-10 text-gray-50 hover:bg-gray-95 dark:hover:bg-gray-20"
                }`}
              >
                {tab.label}
              </span>
            ))}

            <div className="flex-1" />

            {/* Search */}
            <div className="relative w-[200px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-neutral-default pointer-events-none" />
              <Input
                inputSize="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש פוסטים..."
                className="ps-8 text-xs"
              />
            </div>

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
          <div className="flex items-center justify-center gap-2 py-16">
            <Loader2 className="size-5 animate-spin text-yellow-50" />
            <span className="text-small text-text-neutral-default">טוען פוסטים...</span>
          </div>
        )}

        {!loading && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-2xl bg-bg-surface p-6">
              <FileText className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-p text-text-neutral-default">עדיין אין פוסטי ליבה</p>
              <p className="text-small text-text-primary-disabled mt-1">
                צור פוסט ליבה חדש מהעמוד הראשי
              </p>
            </div>
          </div>
        )}

        {!loading && posts.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <FileText className="size-10 text-text-neutral-default" />
            <p className="text-p text-text-neutral-default">{q ? "לא נמצאו פוסטים" : "אין פוסטים בפורמט הזה"}</p>
          </div>
        )}

        {/* Recent section */}
        {!loading && recent.length > 0 && (
          <section className="mb-10">
            <p className="text-small text-text-neutral-default mb-4">נשמרו לאחרונה</p>
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" : "flex flex-col gap-2"}>
              {recent.map((post) => (
                <CorePostCard
                  key={post.id}
                  post={post}
                  onClick={() => router.push(`/project?post_id=${post.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Older section */}
        {!loading && older.length > 0 && (
          <section>
            <p className="text-small text-text-neutral-default mb-4">מוקדם יותר</p>
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" : "flex flex-col gap-2"}>
              {older.map((post) => (
                <CorePostCard
                  key={post.id}
                  post={post}
                  onClick={() => router.push(`/project?post_id=${post.id}`)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}

/* ------------------------------------------------------------------ */
/*  Core Post Card — default + hover states                            */
/* ------------------------------------------------------------------ */

function CorePostCard({
  post,
  onClick,
}: {
  post: SavedPost
  onClick: () => void
}) {
  const lines = post.body.split("\n").filter(Boolean)
  const bodyPreview = lines.join("\n")
  const dateStr = new Date(post.created_at).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })

  return (
    <Card
      dir="rtl"
      className="group gap-4 rounded-[16px] border-border-neutral-default bg-white dark:bg-gray-10 p-4 py-4 text-right transition-all hover:bg-bg-surface-primary-default hover:border-yellow-50 hover:ring-2 hover:ring-yellow-50/30 shadow-none"
    >
      <CardContent className="flex flex-col gap-2 p-0">
        {/* Date */}
        <span className="text-xs text-yellow-30 self-start">
          {dateStr}
        </span>

        {/* Title */}
        <p className="text-sm font-semibold text-text-primary-default line-clamp-1">
          {post.hook_text ?? post.title ?? lines[0] ?? "פוסט ללא כותרת"}
        </p>

        {/* Body */}
        {bodyPreview && (
          <p className="text-sm text-text-primary-default line-clamp-3 leading-relaxed">
            {bodyPreview}
          </p>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 mt-1">
          {/* Format tags */}
          {post.formats.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.formats.map((fid) => {
                const label = FORMAT_LABELS[fid]
                if (!label) return null
                return (
                  <span
                    key={fid}
                    className="rounded-full bg-white dark:bg-gray-20 hover:bg-gray-95 dark:hover:bg-gray-30 px-3 py-1.5 text-xs text-text-neutral-default transition-colors"
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Navigate arrow */}
          <button
            onClick={onClick}
            className="flex items-center justify-center size-8 shrink-0 rounded-lg bg-bg-surface group-hover:bg-bg-surface-primary-default-80 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4 text-text-primary-default" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
