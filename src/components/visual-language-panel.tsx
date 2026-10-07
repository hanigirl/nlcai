"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HexColorPicker } from "react-colorful"
import { AlertTriangle, Check, Link2, Loader2, Plus, Sparkles, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import {
  ANCHOR_LABELS,
  EXAMPLE_KIND_LABELS,
  MAX_BRAND_COLORS,
  MAX_BRAND_ELEMENTS,
  MAX_BRAND_EXAMPLES,
  isHexColor,
  visualLanguageSignature,
  type VisualLanguage,
} from "@/lib/visual-language/types"

/**
 * Settings → Media → שפה ויזואלית.
 *
 * Three inputs — brand colours, graphic elements (each with a note on what
 * it is / when it's used), and design examples (images or a site link) —
 * then one button that asks Claude to turn them into a visual language.
 * Every AI media generator (story, image post, AI carousel, b-roll) follows
 * the result. If the inputs don't share one language, she gets a warning
 * explaining what contradicts what, and the generators fall back to a
 * language derived from her niche.
 *
 * Every change is saved immediately; the analysis is the only explicit step.
 */

interface ElementItem {
  id: string
  name: string
  url: string
  storagePath: string
  description: string
  /** Her opposite-tone version (light for dark artwork, or the reverse). */
  altPath?: string
}

interface ExampleItem {
  id: string
  name: string
  storagePath: string
  /** Image URL for uploads; the page URL for links. */
  url: string
  isLink: boolean
}

type MediaRow = {
  id: string
  category: string
  file_name: string
  storage_path: string
  metadata: Record<string, unknown> | null
}

export function VisualLanguagePanel() {
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [colors, setColors] = useState<string[]>([])
  const [elements, setElements] = useState<ElementItem[]>([])
  const [examples, setExamples] = useState<ExampleItem[]>([])
  const [visualLanguage, setVisualLanguage] = useState<VisualLanguage | null>(null)

  const [uploadingElements, setUploadingElements] = useState(0)
  const [uploadingExamples, setUploadingExamples] = useState(0)
  const [linkDraft, setLinkDraft] = useState("")
  const [analyzing, setAnalyzing] = useState(false)

  const elementInputRef = useRef<HTMLInputElement>(null)
  const exampleInputRef = useRef<HTMLInputElement>(null)

  const publicUrl = useCallback(
    (path: string) => supabase.storage.from("user-media").getPublicUrl(path).data.publicUrl,
    [supabase],
  )

  useEffect(() => {
    getCurrentUser(supabase).then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const [userRes, mediaRes] = await Promise.all([
        supabase
          .from("users")
          .select("brand_colors, visual_language")
          .eq("id", user.id)
          .single(),
        supabase
          .from("user_media")
          .select("id, category, file_name, storage_path, metadata")
          .eq("user_id", user.id)
          .in("category", ["element", "brand_example"])
          .order("created_at", { ascending: true }),
      ])
      if (userRes.error) console.error("[visual-language][users]", userRes.error)
      if (mediaRes.error) console.error("[visual-language][user_media]", mediaRes.error)

      const row = userRes.data as {
        brand_colors?: string[] | null
        visual_language?: VisualLanguage | null
      } | null
      setColors(row?.brand_colors ?? [])
      setVisualLanguage(row?.visual_language ?? null)

      const rows = (mediaRes.data ?? []) as MediaRow[]
      setElements(
        rows
          .filter((r) => r.category === "element")
          .map((r) => ({
            id: r.id,
            name: r.file_name,
            storagePath: r.storage_path,
            url: publicUrl(r.storage_path),
            description: typeof r.metadata?.description === "string" ? r.metadata.description : "",
            altPath: typeof r.metadata?.alt_storage_path === "string" ? r.metadata.alt_storage_path : undefined,
          })),
      )
      setExamples(
        rows
          .filter((r) => r.category === "brand_example")
          .map((r) => {
            const link = typeof r.metadata?.url === "string" ? r.metadata.url : null
            return {
              id: r.id,
              name: r.file_name,
              storagePath: r.storage_path,
              url: link ?? publicUrl(r.storage_path),
              isLink: !!link,
            }
          }),
      )
      setLoading(false)
    })
  }, [supabase, publicUrl])

  // ── Colours ──
  const saveColors = async (next: string[]) => {
    setColors(next)
    if (!userId) return
    const { error } = await supabase
      .from("users")
      .update({ brand_colors: next } as never)
      .eq("id", userId)
    if (error) {
      console.error("[visual-language][colors]", error)
      toast.error("לא הצלחנו לשמור את הצבעים. נסו שוב.")
    }
  }

  // ── Uploads (elements + examples share the same storage path scheme) ──
  const uploadFile = async (file: File, category: "element" | "brand_example") => {
    if (!userId) return null
    const ext = file.name.split(".").pop() || "png"
    const storagePath = `${userId}/${category}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from("user-media").upload(storagePath, file)
    if (uploadError) {
      console.error("[visual-language][upload]", uploadError)
      return null
    }
    const { data: row, error } = await supabase
      .from("user_media")
      .insert({ user_id: userId, category, file_name: file.name, storage_path: storagePath, metadata: {} } as never)
      .select("id")
      .single()
    if (error || !row) {
      console.error("[visual-language][insert]", error)
      await supabase.storage.from("user-media").remove([storagePath])
      return null
    }
    return { id: (row as { id: string }).id, storagePath, url: publicUrl(storagePath) }
  }

  const handleElementFiles = async (files: FileList | null) => {
    if (!files) return
    const room = MAX_BRAND_ELEMENTS - elements.length
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room)
    if (files.length > room) toast.message(`אפשר עד ${MAX_BRAND_ELEMENTS} אלמנטים`)
    setUploadingElements((n) => n + picked.length)
    for (const file of picked) {
      const res = await uploadFile(file, "element")
      setUploadingElements((n) => n - 1)
      if (res) setElements((prev) => [...prev, { ...res, name: file.name, description: "" }])
      else toast.error(`ההעלאה של ${file.name} נכשלה`)
    }
    if (elementInputRef.current) elementInputRef.current.value = ""
  }

  const handleExampleFiles = async (files: FileList | null) => {
    if (!files) return
    const room = MAX_BRAND_EXAMPLES - examples.length
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room)
    if (files.length > room) toast.message(`אפשר עד ${MAX_BRAND_EXAMPLES} דוגמאות`)
    setUploadingExamples((n) => n + picked.length)
    for (const file of picked) {
      const res = await uploadFile(file, "brand_example")
      setUploadingExamples((n) => n - 1)
      if (res) setExamples((prev) => [...prev, { ...res, name: file.name, isLink: false }])
      else toast.error(`ההעלאה של ${file.name} נכשלה`)
    }
    if (exampleInputRef.current) exampleInputRef.current.value = ""
  }

  const addLink = async () => {
    if (!userId) return
    let url: URL
    try {
      url = new URL(linkDraft.trim().match(/^https?:\/\//) ? linkDraft.trim() : `https://${linkDraft.trim()}`)
    } catch {
      toast.error("הקישור לא נראה תקין")
      return
    }
    if (examples.length >= MAX_BRAND_EXAMPLES) {
      toast.message(`אפשר עד ${MAX_BRAND_EXAMPLES} דוגמאות`)
      return
    }
    const href = url.toString()
    const { data: row, error } = await supabase
      .from("user_media")
      .insert({
        user_id: userId,
        category: "brand_example",
        file_name: url.hostname,
        storage_path: `url:${href}`,
        metadata: { source: "url", url: href },
      } as never)
      .select("id")
      .single()
    if (error || !row) {
      console.error("[visual-language][link]", error)
      toast.error("לא הצלחנו לשמור את הקישור")
      return
    }
    setExamples((prev) => [
      ...prev,
      { id: (row as { id: string }).id, name: url.hostname, storagePath: `url:${href}`, url: href, isLink: true },
    ])
    setLinkDraft("")
  }

  // Deletes exactly the row the user clicked, by id — never a filter.
  const removeMedia = async (id: string, storagePath: string) => {
    const { error } = await supabase.from("user_media").delete().eq("id", id)
    if (error) {
      console.error("[visual-language][delete]", error)
      toast.error("המחיקה נכשלה")
      return false
    }
    if (!storagePath.startsWith("url:")) await supabase.storage.from("user-media").remove([storagePath])
    return true
  }

  // metadata holds BOTH the note and the alternate version — always write
  // the whole object so saving one never wipes the other.
  const saveElementMetadata = async (el: ElementItem) => {
    const { error } = await supabase
      .from("user_media")
      .update({
        metadata: { description: el.description.trim(), ...(el.altPath ? { alt_storage_path: el.altPath } : {}) },
      } as never)
      .eq("id", el.id)
    if (error) {
      console.error("[visual-language][element-metadata]", error)
      toast.error("לא הצלחנו לשמור את השינוי")
      return false
    }
    return true
  }

  const [uploadingAltFor, setUploadingAltFor] = useState<string | null>(null)

  const uploadAlt = async (el: ElementItem, file: File) => {
    if (!userId || !file.type.startsWith("image/")) return
    setUploadingAltFor(el.id)
    try {
      const ext = file.name.split(".").pop() || "png"
      const path = `${userId}/element/alt-${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from("user-media").upload(path, file)
      if (error) {
        console.error("[visual-language][alt-upload]", error)
        toast.error("ההעלאה נכשלה")
        return
      }
      const next = { ...el, altPath: path }
      if (await saveElementMetadata(next)) {
        if (el.altPath) await supabase.storage.from("user-media").remove([el.altPath])
        setElements((prev) => prev.map((x) => (x.id === el.id ? next : x)))
      } else {
        await supabase.storage.from("user-media").remove([path])
      }
    } finally {
      setUploadingAltFor(null)
    }
  }

  const removeAlt = async (el: ElementItem) => {
    if (!el.altPath) return
    const next = { ...el, altPath: undefined }
    if (await saveElementMetadata(next)) {
      await supabase.storage.from("user-media").remove([el.altPath])
      setElements((prev) => prev.map((x) => (x.id === el.id ? next : x)))
    }
  }

  // ── Analysis ──
  const currentSignature = visualLanguageSignature({
    colors,
    elements: elements.map((e) => ({ id: e.id, description: e.description })),
    examples: examples.map((x) => ({ id: x.id })),
  })
  // What the last analysis recognised each example as (carousel, website…).
  const kindLabel = (id: string) => {
    const kind = visualLanguage?.example_kinds?.find((k) => k.id === id)?.kind
    return kind ? EXAMPLE_KIND_LABELS[kind] : null
  }
  // Where the analysis pinned an element (pasted at exact pixels).
  const SLIDE_LABELS = { all: "בכל השקופיות", cover: "בשקופית הפתיחה", content: "בשקופיות התוכן", closing: "בשקופית הסיום", not_cover: "בכל השקופיות חוץ מהפתיחה" } as const
  const FORMAT_LABELS = { carousel: "קרוסלה", story: "סטורי", image_post: "פוסט תמונה", b_roll: "בי-רול" } as const
  const placementLabel = (id: string) => {
    const p = visualLanguage?.elements.find((e) => e.id === id)?.placement
    if (!p) return null
    return `מיקום קבוע: ${ANCHOR_LABELS[p.anchor]}, ${SLIDE_LABELS[p.slides]} (${p.formats.map((f) => FORMAT_LABELS[f]).join(", ")})`
  }
  const hasInputs = colors.length > 0 || elements.length > 0 || examples.length > 0
  const stale = !!visualLanguage && visualLanguage.inputs_signature !== currentSignature
  const busy = uploadingElements > 0 || uploadingExamples > 0

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch("/api/visual-language/analyze", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.visual_language) {
        toast.error(data.message || "הניתוח נכשל. נסו שוב.")
        return
      }
      setVisualLanguage(data.visual_language as VisualLanguage)
    } catch (err) {
      console.error("[visual-language][analyze]", err)
      toast.error("הניתוח נכשל. נסו שוב.")
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-neutral-default">
        <Loader2 className="size-4 animate-spin" />
        טוען...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="text-p-bold text-text-primary-default">שפה ויזואלית</h3>
        <p className="text-small text-text-neutral-default mt-1">
          ספרו לנו איך המותג שלכם נראה. ננתח את מה שתעלו לשפה ויזואלית אחת, וכל הסטוריז, פוסטי התמונה, קרוסלות ה-AI והבי-רול ייוצרו לפיה.
        </p>
      </div>

      {/* ── 1. Brand colours ── */}
      <section className="flex flex-col gap-3" aria-labelledby="vl-colors">
        <div>
          <h4 id="vl-colors" className="text-small-bold text-text-primary-default">1. צבעי מותג</h4>
          <p className="text-small text-text-neutral-default mt-0.5">עד {MAX_BRAND_COLORS} צבעים, לפי סדר החשיבות.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {colors.map((color, i) => (
            <BrandColorField
              // Keyed by value so a saved/removed colour remounts with a fresh draft.
              key={`${i}-${color}`}
              index={i}
              value={color}
              onCommit={(c) => saveColors(colors.map((x, j) => (j === i ? c : x)))}
              onRemove={() => saveColors(colors.filter((_, j) => j !== i))}
            />
          ))}
          {colors.length < MAX_BRAND_COLORS && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => saveColors([...colors, colors.length ? "#888888" : "#1f2937"])}
            >
              <Plus className="size-4" />
              הוספת צבע
            </Button>
          )}
        </div>
      </section>

      {/* ── 2. Graphic elements ── */}
      <section className="flex flex-col gap-3" aria-labelledby="vl-elements">
        <div>
          <h4 id="vl-elements" className="text-small-bold text-text-primary-default">2. אלמנטים גרפיים</h4>
          <p className="text-small text-text-neutral-default mt-0.5">
            לוגו, אייקונים, צורות או מדבקות שחוזרים אצלכם. לכל אלמנט כתבו מה הוא ומתי אתם משתמשים בו.
          </p>
        </div>

        <input
          ref={elementInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleElementFiles(e.target.files)}
        />
        {elements.length < MAX_BRAND_ELEMENTS && (
          <DropZone
            label="PNG, JPG, SVG"
            onClick={() => elementInputRef.current?.click()}
            onFiles={handleElementFiles}
          />
        )}
        {uploadingElements > 0 && <UploadingNote count={uploadingElements} />}

        {elements.map((el) => (
          <div key={el.id} className="flex gap-3 rounded-xl border border-border-neutral-default p-3">
            <div className="size-20 shrink-0 rounded-lg bg-bg-surface overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={el.url} alt={el.name} className="size-full object-contain p-2" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <label htmlFor={`el-${el.id}`} className="text-xs text-text-neutral-default">
                מה זה ומתי משתמשים בו?
              </label>
              <Textarea
                id={`el-${el.id}`}
                rows={2}
                value={el.description}
                placeholder="למשל: הלוגו שלי, בפינה התחתונה של הפריים האחרון בלבד"
                onChange={(e) =>
                  setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, description: e.target.value } : x)))
                }
                onBlur={(e) => saveElementMetadata({ ...el, description: e.target.value })}
                className="text-sm min-h-0"
              />
              {placementLabel(el.id) && (
                <p className="text-xs text-text-neutral-default">{placementLabel(el.id)}</p>
              )}
              {placementLabel(el.id) && (
                <AltVersionSlot
                  element={el}
                  analysed={visualLanguage?.elements.find((e) => e.id === el.id)}
                  altUrl={el.altPath ? publicUrl(el.altPath) : undefined}
                  uploading={uploadingAltFor === el.id}
                  onUpload={(file) => uploadAlt(el, file)}
                  onRemove={() => removeAlt(el)}
                />
              )}
            </div>
            <RemoveButton
              label={`מחיקת ${el.name}`}
              onClick={async () => {
                if (await removeMedia(el.id, el.storagePath)) {
                  if (el.altPath) await supabase.storage.from("user-media").remove([el.altPath])
                  setElements((prev) => prev.filter((x) => x.id !== el.id))
                }
              }}
            />
          </div>
        ))}
      </section>

      {/* ── 3. Examples ── */}
      <section className="flex flex-col gap-3" aria-labelledby="vl-examples">
        <div>
          <h4 id="vl-examples" className="text-small-bold text-text-primary-default">3. דוגמאות לשימוש</h4>
          <p className="text-small text-text-neutral-default mt-0.5">
            עיצובים שמראים את הצבעים והאלמנטים בפעולה: פוסטר, באנר, פוסט, או קישור לאתר או לדף המכירה שלכם.
          </p>
        </div>

        <input
          ref={exampleInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleExampleFiles(e.target.files)}
        />
        {examples.length < MAX_BRAND_EXAMPLES && (
          <>
            <DropZone
              label="PNG, JPG"
              onClick={() => exampleInputRef.current?.click()}
              onFiles={handleExampleFiles}
            />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (linkDraft.trim()) addLink()
              }}
            >
              <Input
                dir="ltr"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                placeholder="https://..."
                aria-label="קישור לאתר או לדף מכירה"
                className="text-sm"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!linkDraft.trim()} className="gap-1.5 shrink-0">
                <Link2 className="size-4" />
                הוספת קישור
              </Button>
            </form>
          </>
        )}
        {uploadingExamples > 0 && <UploadingNote count={uploadingExamples} />}

        {examples.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {examples.map((ex) =>
              ex.isLink ? (
                <div
                  key={ex.id}
                  className="flex items-center gap-2 rounded-lg border border-border-neutral-default px-3 h-10 max-w-full"
                >
                  <Link2 className="size-4 shrink-0 text-text-neutral-default" />
                  <a
                    href={ex.url}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                    className="text-sm text-text-primary-default truncate hover:underline"
                  >
                    {ex.name}
                  </a>
                  {kindLabel(ex.id) && (
                    <span className="shrink-0 rounded-md bg-bg-surface px-1.5 py-0.5 text-xs text-text-neutral-default">
                      {kindLabel(ex.id)}
                    </span>
                  )}
                  <RemoveButton
                    label={`מחיקת ${ex.name}`}
                    onClick={async () => {
                      if (await removeMedia(ex.id, ex.storagePath)) setExamples((prev) => prev.filter((x) => x.id !== ex.id))
                    }}
                  />
                </div>
              ) : (
                <div key={ex.id} className="relative size-24 rounded-lg overflow-hidden bg-bg-surface group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ex.url} alt={ex.name} className="size-full object-cover" />
                  {kindLabel(ex.id) && (
                    <span className="absolute bottom-1 start-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white">
                      {kindLabel(ex.id)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`מחיקת ${ex.name}`}
                    onClick={async () => {
                      if (await removeMedia(ex.id, ex.storagePath)) setExamples((prev) => prev.filter((x) => x.id !== ex.id))
                    }}
                    className="absolute top-1 end-1 size-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="size-3.5 text-white" />
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* ── 4. Analysis ── */}
      <section className="flex flex-col gap-3" aria-label="ניתוח השפה הוויזואלית">

        {visualLanguage?.status === "ok" && (
          <div className="flex flex-col gap-3 rounded-xl bg-bg-surface p-4">
            <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <Check className="size-4" />
              נמצאה שפה ויזואלית אחידה. התמונות החדשות ייוצרו לפיה.
            </div>
            <p className="text-sm text-text-primary-default leading-relaxed">{visualLanguage.summary_he}</p>
            {visualLanguage.palette.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {visualLanguage.palette.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-text-neutral-default" dir="ltr">
                    {/* The swatch shows HER colour, so it's the one place a raw value belongs. */}
                    <span className="size-4 rounded-full border border-border-neutral-default" style={{ backgroundColor: p.hex }} />
                    {p.hex}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {visualLanguage?.status === "inconsistent" && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-80 bg-red-95 p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-red-50">
              <AlertTriangle className="size-4" />
              לא מצאנו המשכיות בעיצוב שהעליתם
            </div>
            {visualLanguage.issues_he.length > 0 && (
              <ul className="list-disc ps-5 text-sm text-text-primary-default flex flex-col gap-1">
                {visualLanguage.issues_he.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-text-primary-default">
              ודאו שהצבעים, האלמנטים והדוגמאות מציגים שפה ויזואלית אחת, ספציפית וברורה, ונתחו שוב. עד אז נעצב לפי הנישה שלכם.
            </p>
          </div>
        )}

        {visualLanguage?.unreadable_links?.length ? (
          <p className="text-xs text-text-neutral-default">
            לא הצלחנו לקרוא את הקישור{visualLanguage.unreadable_links.length > 1 ? "ים" : ""}{" "}
            <span dir="ltr">{visualLanguage.unreadable_links.join(", ")}</span>, אז הוא לא נכלל בניתוח. אפשר להעלות צילום מסך במקום.
          </p>
        ) : null}

        {stale && !analyzing && (
          <p className="text-xs text-text-neutral-default">שיניתם דברים מאז הניתוח האחרון. נתחו שוב כדי לעדכן את השפה.</p>
        )}

        <Button
          size="sm"
          onClick={analyze}
          disabled={!hasInputs || analyzing || busy}
          className="w-fit gap-2"
        >
          {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {analyzing
            ? "מנתח את השפה הוויזואלית..."
            : visualLanguage
              ? "ניתוח מחדש"
              : "ניתוח השפה הוויזואלית"}
        </Button>
        {analyzing && (
          <p className="text-xs text-text-neutral-default" aria-live="polite">
            זה יכול לקחת עד דקה, במיוחד כשיש קישור לאתר.
          </p>
        )}
      </section>
    </div>
  )
}

/* ── small pieces ── */

/**
 * Optional opposite-tone version of a fixed element. Pasted elements can't
 * be recoloured by the image model, so a dark badge on a dark slide would
 * vanish — this is the version used there. Flat artwork gets an automatic
 * one when she doesn't upload; artwork with a photo can't, so we ask.
 */
function AltVersionSlot({
  element,
  analysed,
  altUrl,
  uploading,
  onUpload,
  onRemove,
}: {
  element: ElementItem
  analysed?: { tone?: "dark" | "light"; photographic?: boolean }
  altUrl?: string
  uploading: boolean
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isDark = analysed?.tone !== "light"
  const label = isDark ? "גרסה בהירה לרקעים כהים" : "גרסה כהה לרקעים בהירים"
  const hint = analysed?.photographic
    ? "באלמנט יש תמונה, אז לא נוכל להתאים אותו אוטומטית. מומלץ להעלות גרסה, אחרת על רקע דומה בגוון הוא עלול להיבלע."
    : "לא חובה. אם לא תעלו, ניצור גרסה כזו אוטומטית בשקופיות שבהן האלמנט לא בולט מספיק."
  return (
    <div className="flex items-center gap-2 pt-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ""
        }}
      />
      {altUrl ? (
        <div className={`flex items-center gap-2 rounded-lg px-2 py-1 ${isDark ? "bg-gray-10" : "bg-bg-surface"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={altUrl} alt={`${label} של ${element.name}`} className="h-8 max-w-24 object-contain" />
          <button
            type="button"
            aria-label={`מחיקת ${label}`}
            onClick={onRemove}
            className={`size-6 rounded-full flex items-center justify-center cursor-pointer ${isDark ? "text-gray-90 hover:bg-gray-20" : "text-text-neutral-default hover:bg-gray-95"}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="gap-1.5 shrink-0"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {label}
        </Button>
      )}
      {!altUrl && <p className="text-xs text-text-neutral-default">{hint}</p>}
    </div>
  )
}

function BrandColorField({
  index,
  value,
  onCommit,
  onRemove,
}: {
  index: number
  value: string
  onCommit: (color: string) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const commit = useCallback(
    (c: string) => {
      if (isHexColor(c) && c.toLowerCase() !== value.toLowerCase()) onCommit(c.toLowerCase())
      else setDraft(value)
    },
    [onCommit, value],
  )

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false)
        commit(draft)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open, draft, commit])

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5 rounded-lg border border-border-neutral-default ps-1.5 pe-1 h-10">
      <button
        type="button"
        aria-label={`צבע ${index + 1}: ${draft}, פתיחת בוחר צבע`}
        aria-expanded={open}
        onClick={() => {
          if (open) commit(draft)
          setOpen(!open)
        }}
        className="size-7 rounded-full border border-border-neutral-default shrink-0 cursor-pointer"
        style={{ backgroundColor: isHexColor(draft) ? draft : value }}
      />
      <input
        dir="ltr"
        value={draft}
        aria-label={`קוד צבע ${index + 1}`}
        onChange={(e) => setDraft(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
        onBlur={() => !open && commit(draft)}
        onKeyDown={(e) => e.key === "Enter" && commit(draft)}
        maxLength={7}
        className="w-[76px] bg-transparent text-sm text-text-primary-default outline-none font-mono"
      />
      <RemoveButton label={`מחיקת צבע ${index + 1}`} onClick={onRemove} />
      {open && (
        <div className="absolute top-full mt-2 start-0 z-50 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 p-3 shadow-lg">
          <HexColorPicker color={isHexColor(draft) ? draft : value} onChange={setDraft} />
        </div>
      )}
    </div>
  )
}

function DropZone({
  label,
  onClick,
  onFiles,
}: {
  label: string
  onClick: () => void
  onFiles: (files: FileList) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onFiles(e.dataTransfer.files)
      }}
      className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 dark:hover:bg-gray-20 transition-all cursor-pointer"
    >
      <Upload className="size-5 text-text-neutral-default" />
      <span className="text-xs text-text-neutral-default">{label}</span>
    </button>
  )
}

function UploadingNote({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-text-neutral-default">
      <Loader2 className="size-3.5 animate-spin" />
      מעלה {count} {count === 1 ? "קובץ" : "קבצים"}...
    </div>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="size-7 shrink-0 rounded-full flex items-center justify-center text-text-neutral-default hover:bg-gray-95 dark:hover:bg-gray-20 hover:text-button-destructive-default transition-colors cursor-pointer"
    >
      <X className="size-4" />
    </button>
  )
}
