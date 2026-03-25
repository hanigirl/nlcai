"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, ArrowLeft, Mic, ChevronDown, Loader2 } from "lucide-react"
import { AppLink } from "@/components/ui/app-link"
import { AppShell } from "@/components/app-shell"
import { Typewriter } from "@/components/typewriter"
import { StickyNote } from "@/components/sticky-note"
import { SelectionCard } from "@/components/selection-card"
import { HookCard } from "@/components/hook-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"

interface IdeaNote {
  text: string
  productName: string
  date: string
}

export default function Home() {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [idea, setIdea] = useState("")
  const [ideas, setIdeas] = useState<IdeaNote[]>([])
  const [generating, setGenerating] = useState(false)
  const [hooks, setHooks] = useState<string[]>([])
  const [hooksLoading, setHooksLoading] = useState(false)
  const [selectedHook, setSelectedHook] = useState<number | null>(null)
  const [productFilter, setProductFilter] = useState("")
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem("generatedIdeas")
      if (saved) {
        const parsed: IdeaNote[] = JSON.parse(saved)
        setIdeas(parsed.map((n) => ({
          ...n,
          productName: n.productName.replace(/\s*\(.*?\)\s*$/, ""),
        })))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (ideas.length > 0) {
      localStorage.setItem("generatedIdeas", JSON.stringify(ideas))
    }
  }, [ideas])

  useEffect(() => {
    // Try localStorage cache first for instant display
    try {
      const cached = localStorage.getItem("homepageHooks_v4")
      if (cached) {
        const parsed: string[] = JSON.parse(cached)
        if (parsed.length > 0) {
          setHooks(parsed)
          return
        }
      }
    } catch {
      // ignore
    }

    // Try loading unused hooks from DB
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return

      const { data: dbHooks } = await supabase
        .from("hooks")
        .select("hook_text")
        .eq("user_id", user.id)
        .eq("is_used", false)
        .order("display_order", { ascending: true })

      if (dbHooks && dbHooks.length > 0) {
        const hookTexts = dbHooks.map((h: { hook_text: string }) => h.hook_text)
        setHooks(hookTexts)
        localStorage.setItem("homepageHooks_v4", JSON.stringify(hookTexts))
        return
      }

      // No hooks in DB — generate fresh
      setHooksLoading(true)
      fetch("/api/homepage-hooks", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.hooks) {
            setHooks(data.hooks)
            localStorage.setItem("homepageHooks_v4", JSON.stringify(data.hooks))
          }
        })
        .catch(() => {})
        .finally(() => setHooksLoading(false))
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

        const { data: prods } = await supabase
          .from("products")
          .select("id, name")
          .eq("user_id", data.user.id) as { data: { id: string; name: string }[] | null }
        if (prods) setProducts(prods)
      }
    })
  }, [])

  const handleSubmit = () => {
    if (!idea.trim()) return
    router.push(`/project?idea=${encodeURIComponent(idea)}`)
  }

  const [ideasError, setIdeasError] = useState("")

  const handleGenerateIdeas = async () => {
    setGenerating(true)
    setIdeasError("")
    try {
      const res = await fetch("/api/ideas", { method: "POST" })
      const data = await res.json()
      if (data.error) {
        setIdeasError(data.error)
      } else if (data.ideas) {
        setIdeas((prev) => [...data.ideas, ...prev])
      }
    } catch (err) {
      setIdeasError("שגיאה ביצירת רעיונות")
      console.error("Ideas error:", err)
    } finally {
      setGenerating(false)
    }
  }

  const filteredIdeas = productFilter
    ? ideas.filter((n) => n.productName.trim() === productFilter.trim())
    : ideas

  return (
    <AppShell isHome>
      <div dir="rtl" className="mx-auto max-w-3xl relative z-10 px-20 pt-[72px] pb-[100px]">
        {/* Greeting */}
        <div className="text-center mb-[72px]">
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
            {hooksLoading ? (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="size-4 animate-spin text-yellow-50" />
                <span className="text-small text-text-neutral-default">מייצר הוקים...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {hooks.slice(0, 4).map((hook, i) => (
                  <HookCard
                    key={i}
                    hookText={hook}
                    onNavigate={() => router.push(`/project?hook=${encodeURIComponent(hook)}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Idea textarea */}
          <div className="flex flex-col gap-4">
            <span className="text-xs-body text-text-neutral-default">
              התחלה מרעיון
            </span>
            <div className="rounded-xl border border-border-neutral-default bg-white p-4 flex flex-col gap-4">
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
                רעיונות נוספים עבורך
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs-body text-text-neutral-default whitespace-nowrap">
                  חיפוש לפי
                </span>
                <div className="relative w-[177px]">
                  <select
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    className="h-[34px] w-full appearance-none rounded-[10px] border border-border-neutral-default bg-white pe-10 ps-3 text-sm text-text-primary-default outline-none leading-[34px] focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <option value="">שם המוצר</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="flex w-full gap-4">
              {filteredIdeas.slice(0, 3).map((note, i) => (
                <div
                  key={`${note.text}-${i}`}
                  className="animate-in fade-in slide-in-from-bottom-3 duration-500 w-[207px] h-[207px]"
                  style={{ animationDelay: `${i * 100}ms`, animationFillMode: "backwards" }}
                >
                  <StickyNote
                    text={note.text}
                    productName={note.productName}
                    date={note.date}
                    onClick={() =>
                      router.push(
                        `/project?idea=${encodeURIComponent(note.text)}`
                      )
                    }
                  />
                </div>
              ))}
            </div>

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
            {ideasError && (
              <p className="text-small text-button-destructive-default">{ideasError}</p>
            )}
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
