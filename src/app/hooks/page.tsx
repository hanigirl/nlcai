"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Anchor, Loader2, Sparkles } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { HookCard } from "@/components/hook-card"
import { createClient } from "@/lib/supabase/client"

interface HookItem {
  id: string
  hook_text: string
  is_used: boolean
  created_at: string
}

export default function HooksPage() {
  const router = useRouter()
  const [hooks, setHooks] = useState<HookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const loadHooks = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from("hooks")
      .select("id, hook_text, is_used, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (data) {
      setHooks(data as HookItem[])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadHooks()
  }, [])

  const handleGenerateMore = async () => {
    setGenerating(true)
    try {
      await fetch("/api/homepage-hooks", { method: "POST" })
      await loadHooks()
      localStorage.removeItem("homepageHooks_v4")
    } catch {
      // ignore
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (id: string) => {
    const supabase = createClient()
    await supabase.from("hooks").delete().eq("id", id)
    setHooks((prev) => prev.filter((h) => h.id !== id))
  }

  const unusedHooks = hooks.filter((h) => !h.is_used)
  const usedHooks = hooks.filter((h) => h.is_used)

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-text-primary-default">מחסן הוקים</h2>
          <Button
            onClick={handleGenerateMore}
            disabled={generating}
            className="gap-2"
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {generating ? "מייצר הוקים..." : "ייצר לי עוד הוקים"}
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16">
            <Loader2 className="size-5 animate-spin text-yellow-50" />
            <span className="text-small text-text-neutral-default">טוען הוקים...</span>
          </div>
        )}

        {!loading && hooks.length === 0 && (
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

        {/* Unused hooks */}
        {!loading && unusedHooks.length > 0 && (
          <section className="mb-10">
            <p className="text-small text-text-neutral-default mb-4">
              חדשים ({unusedHooks.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {unusedHooks.map((hook) => (
                <HookCard
                  key={hook.id}
                  hookText={hook.hook_text}
                  onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hook.hook_text)}`)}
                  onDelete={() => handleDelete(hook.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Used hooks */}
        {!loading && usedHooks.length > 0 && (
          <section>
            <p className="text-small text-text-neutral-default mb-4">
              בשימוש ({usedHooks.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {usedHooks.map((hook) => (
                <HookCard
                  key={hook.id}
                  hookText={hook.hook_text}
                  onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hook.hook_text)}`)}
                  onDelete={() => handleDelete(hook.id)}
                  used
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}
