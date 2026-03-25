"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { FileText, Loader2, ChevronDown, ArrowLeft } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent } from "@/components/ui/card"

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

  useEffect(() => {
    fetch("/api/core-posts")
      .then((res) => res.json())
      .then((data) => {
        if (data.posts) setPosts(data.posts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = formatFilter
    ? posts.filter((p) => p.formats.includes(formatFilter))
    : posts
  const { recent, older } = groupByRecency(filtered)

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header + Filters */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-text-primary-default">פוסטי ליבה</h2>
          <div className="flex items-center gap-3">
          <span className="text-small text-text-neutral-default">סנן לפי</span>
          <div className="relative w-[177px]">
            <select
              className="h-[34px] w-full appearance-none rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 pe-10 ps-3 text-sm text-text-primary-default outline-none leading-[34px] focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">כל המוצרים</option>
            </select>
            <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default pointer-events-none" />
          </div>
          <div className="relative w-[177px]">
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              className="h-[34px] w-full appearance-none rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 pe-10 ps-3 text-sm text-text-primary-default outline-none leading-[34px] focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">כל הפורמטים</option>
              <option value="talking_head">דיבור למצלמה</option>
              <option value="carousel">קרוסלה</option>
              <option value="story">סטורי</option>
              <option value="image_post">תמונה</option>
            </select>
            <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default pointer-events-none" />
          </div>
          </div>
        </div>

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
            <p className="text-p text-text-neutral-default">אין פוסטים בפורמט הזה</p>
          </div>
        )}

        {/* Recent section */}
        {!loading && recent.length > 0 && (
          <section className="mb-10">
            <p className="text-small text-text-neutral-default mb-4">נשמרו לאחרונה</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
                    className="rounded-full bg-bg-surface-primary-default group-hover:bg-bg-surface-primary-default-80 px-3 py-1.5 text-xs text-yellow-30 transition-colors"
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
