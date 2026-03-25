"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Loader2, Link2, Unlink, Plus, Trash2, ChevronDown, Upload, X, Sparkles, Check, AlertCircle, Type, Image as ImageIcon } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"

type KeyName = "anthropic_api_key" | "heygen_api_key"
type SettingsTab = "connections" | "products" | "media"

interface KeyConfig {
  key: KeyName
  label: string
  placeholder: string
  helpUrl: string
  helpLabel: string
}

const KEYS: KeyConfig[] = [
  {
    key: "anthropic_api_key",
    label: "Claude API Key",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpLabel: "console.anthropic.com",
  },
  {
    key: "heygen_api_key",
    label: "HeyGen API Key",
    placeholder: "הכנס את ה-API key שלך",
    helpUrl: "https://app.heygen.com/settings?nav=API",
    helpLabel: "app.heygen.com",
  },
]

function maskKey(key: string): string {
  if (key.length <= 4) return "••••"
  return "••••••" + key.slice(-4)
}

interface UploadingFile {
  id: string
  name: string
  progress: number
  status: "uploading" | "done" | "error"
}

export default function SettingsPage() {
  type Product = { id: string; name: string; type: "front" | "premium" | "lead_magnet"; landing_page_url: string; page_summary: string | null }

  const [activeTab, setActiveTab] = useState<SettingsTab>("connections")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<KeyName | null>(null)
  const [reparsing, setReparsing] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [savingProducts, setSavingProducts] = useState(false)
  const [storedKeys, setStoredKeys] = useState<Record<KeyName, string | null>>({
    anthropic_api_key: null,
    heygen_api_key: null,
  })
  const [inputValues, setInputValues] = useState<Record<KeyName, string>>({
    anthropic_api_key: "",
    heygen_api_key: "",
  })

  // Media tab state
  const [coverImages, setCoverImages] = useState<string[]>([])
  const [coverUploading, setCoverUploading] = useState<UploadingFile[]>([])
  const [analyzingCovers, setAnalyzingCovers] = useState(false)
  const [brandStyleSaved, setBrandStyleSaved] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [fontFiles, setFontFiles] = useState<{ name: string; data: string }[]>([])
  const [googleFontSearch, setGoogleFontSearch] = useState("")
  const [fontUploading, setFontUploading] = useState<UploadingFile[]>([])
  const [elementImages, setElementImages] = useState<string[]>([])
  const coverInputRef = useRef<HTMLInputElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const elementInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase
        .from("users")
        .select("anthropic_api_key, heygen_api_key, brand_style")
        .eq("id", user.id)
        .single()
      const row = data as Record<string, unknown> | null
      if (row) {
        setStoredKeys({
          anthropic_api_key: (row.anthropic_api_key as string) ?? null,
          heygen_api_key: (row.heygen_api_key as string) ?? null,
        })
        if (row.brand_style) setBrandStyleSaved(true)
      }

      const { data: prods } = await supabase
        .from("products")
        .select("id, name, type, landing_page_url, page_summary")
        .eq("user_id", user.id)
      if (prods) {
        setProducts(prods.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: (p.name as string) || "",
          type: (p.type as "front" | "premium" | "lead_magnet") || "front",
          landing_page_url: (p.landing_page_url as string) || "",
          page_summary: (p.page_summary as string) || null,
        })))
      }

      setLoading(false)
    })

    // Load cached media data
    try {
      const cached = localStorage.getItem("media_cover_examples")
      if (cached) setCoverImages(JSON.parse(cached))
    } catch { /* ignore */ }
    try {
      const cached = localStorage.getItem("media_font_files")
      if (cached) setFontFiles(JSON.parse(cached))
    } catch { /* ignore */ }
    try {
      const cached = localStorage.getItem("media_element_images")
      if (cached) setElementImages(JSON.parse(cached))
    } catch { /* ignore */ }
  }, [])

  // Persist media data
  useEffect(() => {
    if (coverImages.length > 0) localStorage.setItem("media_cover_examples", JSON.stringify(coverImages))
  }, [coverImages])
  useEffect(() => {
    if (fontFiles.length > 0) localStorage.setItem("media_font_files", JSON.stringify(fontFiles))
  }, [fontFiles])
  useEffect(() => {
    if (elementImages.length > 0) localStorage.setItem("media_element_images", JSON.stringify(elementImages))
  }, [elementImages])

  // --- Connection handlers ---
  const handleConnect = async (keyName: KeyName) => {
    const value = inputValues[keyName].trim()
    if (!value) return
    setSaving(keyName)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from("users").update({ [keyName]: value } as never).eq("id", user.id)
    setStoredKeys((prev) => ({ ...prev, [keyName]: value }))
    setInputValues((prev) => ({ ...prev, [keyName]: "" }))
    setSaving(null)

    if (keyName === "anthropic_api_key") {
      setReparsing(true)
      try {
        await Promise.allSettled([
          fetch("/api/reparse-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "core" }) }),
          fetch("/api/reparse-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "audience" }) }),
        ])
      } finally {
        setReparsing(false)
      }
    }
  }

  const handleDisconnect = async (keyName: KeyName) => {
    setSaving(keyName)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from("users").update({ [keyName]: null } as never).eq("id", user.id)
    setStoredKeys((prev) => ({ ...prev, [keyName]: null }))
    setSaving(null)
  }

  // --- Product handlers ---
  const handleSaveProducts = async () => {
    setSavingProducts(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from("products").delete().eq("user_id", user.id)
    const toInsert = products.filter((p) => p.name.trim())
    if (toInsert.length > 0) {
      const { data: inserted } = await supabase
        .from("products")
        .insert(toInsert.map((p) => ({ user_id: user.id, name: p.name, type: p.type, landing_page_url: p.landing_page_url || null })))
        .select("id")
      if (inserted) {
        toInsert.forEach((p, i) => {
          if (p.landing_page_url) {
            fetch("/api/parse-product-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.landing_page_url, productId: (inserted[i] as { id: string }).id }) }).catch(() => {})
          }
        })
      }
    }
    setSavingProducts(false)
  }

  // --- Media upload handlers ---
  const simulateProgress = useCallback((fileId: string, setFn: React.Dispatch<React.SetStateAction<UploadingFile[]>>) => {
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 30 + 10
      if (progress >= 100) {
        clearInterval(interval)
        setFn((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 100, status: "done" } : f))
        setTimeout(() => setFn((prev) => prev.filter((f) => f.id !== fileId)), 1000)
      } else {
        setFn((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: Math.min(progress, 95) } : f))
      }
    }, 200)
  }, [])

  const handleCoverUpload = (files: FileList | File[]) => {
    const remaining = 10 - coverImages.length
    Array.from(files).slice(0, remaining).forEach((file) => {
      if (!file.type.startsWith("image/")) return
      const fileId = crypto.randomUUID()
      setCoverUploading((prev) => [...prev, { id: fileId, name: file.name, progress: 0, status: "uploading" }])
      simulateProgress(fileId, setCoverUploading)
      const reader = new FileReader()
      reader.onload = () => setCoverImages((prev) => prev.length >= 10 ? prev : [...prev, reader.result as string])
      reader.readAsDataURL(file)
    })
  }

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const fileId = crypto.randomUUID()
      setFontUploading((prev) => [...prev, { id: fileId, name: file.name, progress: 0, status: "uploading" }])
      simulateProgress(fileId, setFontUploading)
      const reader = new FileReader()
      reader.onload = () => setFontFiles((prev) => [...prev, { name: file.name, data: reader.result as string }])
      reader.readAsDataURL(file)
    })
    if (fontInputRef.current) fontInputRef.current.value = ""
  }

  const handleElementUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setElementImages((prev) => [...prev, reader.result as string])
      reader.readAsDataURL(file)
    })
    if (elementInputRef.current) elementInputRef.current.value = ""
  }

  const handleAnalyzeCovers = async () => {
    if (coverImages.length < 3) return
    setAnalyzingCovers(true)
    setAnalyzeError(null)
    setBrandStyleSaved(false)
    try {
      const res = await fetch("/api/analyze-covers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: coverImages }),
      })
      const data = await res.json()
      if (data.error) setAnalyzeError(data.error)
      else setBrandStyleSaved(true)
    } catch {
      setAnalyzeError("שגיאה בניתוח הסגנון")
    } finally {
      setAnalyzingCovers(false)
    }
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "connections", label: "חיבורים" },
    { id: "products", label: "מוצרים" },
    { id: "media", label: "מדיה" },
  ]

  return (
    <AppShell>
      <div dir="rtl" className="mx-auto max-w-[1200px] flex flex-col gap-8">
        <h2 className="text-text-primary-default">הגדרות</h2>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border-neutral-default">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-p transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "text-text-primary-default border-b-2 border-text-primary-default font-semibold"
                  : "text-text-neutral-default hover:text-text-primary-default"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {reparsing && (
          <div className="flex items-center gap-2 rounded-xl border border-border-neutral-default bg-bg-surface-primary-default p-4">
            <Loader2 className="size-4 animate-spin text-text-primary-default" />
            <span className="text-p text-text-primary-default">מנתח קבצים שהועלו...</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-text-neutral-default" />
          </div>
        ) : (
          <>
            {/* ==================== CONNECTIONS TAB ==================== */}
            {activeTab === "connections" && (
              <div className="flex flex-col gap-6 max-w-lg">
                {KEYS.map((cfg) => {
                  const stored = storedKeys[cfg.key]
                  const isSaving = saving === cfg.key
                  return (
                    <div key={cfg.key} className="flex flex-col gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
                      <div className="flex items-center justify-between">
                        <span className="text-p-bold text-text-primary-default">{cfg.label}</span>
                        {stored && <span className="text-xs-body text-text-neutral-default font-mono">{maskKey(stored)}</span>}
                      </div>
                      {stored ? (
                        <Button variant="outline" onClick={() => handleDisconnect(cfg.key)} disabled={isSaving} className="w-fit gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95">
                          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                          נתק
                        </Button>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Input dir="ltr" placeholder={cfg.placeholder} value={inputValues[cfg.key]} onChange={(e) => setInputValues((prev) => ({ ...prev, [cfg.key]: e.target.value }))} className="flex-1" />
                            <Button onClick={() => handleConnect(cfg.key)} disabled={!inputValues[cfg.key].trim() || isSaving} className="gap-2">
                              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                              חבר
                            </Button>
                          </div>
                          <p className="text-xs-body text-text-neutral-default">
                            מצא את ה-API key שלך ב-{" "}
                            <a href={cfg.helpUrl} target="_blank" rel="noopener noreferrer" className="text-text-primary-default font-semibold hover:underline">{cfg.helpLabel}</a>
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ==================== PRODUCTS TAB ==================== */}
            {activeTab === "products" && (
              <div className="flex flex-col gap-4 max-w-lg">
                {products.length === 0 && (
                  <p className="text-small text-text-neutral-default">לא נמצאו מוצרים. הוסיפי מוצרים כדי ליצור תוכן מותאם.</p>
                )}
                <div className="flex flex-col gap-3">
                  {products.map((product, i) => (
                    <div key={product.id || i} className="group flex flex-col gap-2 rounded-2xl bg-bg-surface px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Input placeholder="שם המוצר" value={product.name} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], name: e.target.value }; setProducts(u) }} className="flex-1 border-none bg-transparent shadow-none" />
                        <div className="relative">
                          <select value={product.type} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], type: e.target.value as "front" | "premium" | "lead_magnet" }; setProducts(u) }} className="h-10 rounded-xl border border-border-neutral-default bg-white px-3 text-small text-text-primary-default appearance-none cursor-pointer pe-8" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "left 0.5rem center" }}>
                            <option value="front">פרונט</option>
                            <option value="premium">פרימיום</option>
                            <option value="lead_magnet">מגנט לידים</option>
                          </select>
                        </div>
                        <button type="button" onClick={() => setProducts(products.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity p-1">
                          <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
                        </button>
                      </div>
                      <Input dir="ltr" placeholder="לינק לדף המוצר (אופציונלי)" value={product.landing_page_url} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], landing_page_url: e.target.value }; setProducts(u) }} className="border-none bg-white shadow-none text-sm" />
                      {product.page_summary && <p className="text-xs text-text-neutral-default px-1">{product.page_summary}</p>}
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={() => setProducts([...products, { id: crypto.randomUUID(), name: "", type: "front", landing_page_url: "", page_summary: null }])} className="w-full h-12 rounded-2xl border-border-neutral-default text-text-neutral-default gap-2">
                  <Plus className="size-4" />
                  הוספת מוצר חדש
                </Button>
                <Button onClick={handleSaveProducts} disabled={savingProducts} className="w-fit self-end gap-2">
                  {savingProducts && <Loader2 className="size-4 animate-spin" />}
                  שמור מוצרים
                </Button>
              </div>
            )}

            {/* ==================== MEDIA TAB ==================== */}
            {activeTab === "media" && (
              <div className="flex flex-col gap-6">
                <p className="text-p text-text-neutral-default">
                  כאן מגדירים את השפה הויזואלית של המדיה, כדי שהסוכנים ימירו לכם קאברים וקרוסלות לפי שפת המותג
                </p>

                {/* Card 1: Fonts */}
                <div className="flex gap-6">
                  <div className="w-1/2 flex flex-col gap-4 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
                    <div className="flex items-center gap-2">
                      <Type className="size-5 text-text-neutral-default" />
                      <span className="text-p-bold text-text-primary-default">פונטים</span>
                      <span className="text-xs text-text-neutral-default">(עד 3)</span>
                    </div>
                    <p className="text-small text-text-neutral-default">העלי את הפונטים שאת עובדת איתם, או בחרי מ-Google Fonts.</p>

                    {/* Google Fonts search */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-text-neutral-default">Google Fonts</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="חפשי פונט, למשל: Heebo, Assistant..."
                          value={googleFontSearch}
                          onChange={(e) => setGoogleFontSearch(e.target.value)}
                          className="flex-1 text-sm"
                          dir="ltr"
                        />
                        <Button
                          variant="outline"
                          disabled={!googleFontSearch.trim() || fontFiles.length >= 3}
                          onClick={() => {
                            const name = googleFontSearch.trim()
                            if (!name) return
                            setFontFiles((prev) => prev.length >= 3 ? prev : [...prev, { name: `${name} (Google Fonts)`, data: `google:${name}` }])
                            setGoogleFontSearch("")
                          }}
                          className="gap-1 text-sm shrink-0"
                        >
                          <Plus className="size-3.5" />
                          הוסף
                        </Button>
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border-neutral-default" />
                      <span className="text-xs text-text-neutral-default">או העלאה ידנית</span>
                      <div className="h-px flex-1 bg-border-neutral-default" />
                    </div>

                    {fontFiles.length < 3 && (
                      <>
                        <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple onChange={handleFontUpload} className="hidden" />
                        <button
                          onClick={() => fontInputRef.current?.click()}
                          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 transition-all cursor-pointer"
                        >
                          <Upload className="size-5 text-text-neutral-default" />
                          <span className="text-xs text-text-neutral-default">TTF, OTF, WOFF</span>
                        </button>
                      </>
                    )}

                    {fontUploading.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg-surface p-2">
                        <span className="text-xs text-text-primary-default truncate flex-1">{f.name}</span>
                        {f.status === "done" ? <Check className="size-3.5 text-green-600" /> : <Progress value={f.progress} className="w-20 h-1.5" />}
                      </div>
                    ))}
                  </div>

                  {/* Uploaded fonts list */}
                  <div className="w-1/2 flex flex-col gap-2">
                    {fontFiles.length > 0 ? fontFiles.map((font, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-bg-surface px-3 py-2.5 group">
                        <div className="flex items-center gap-2">
                          <Type className="size-3.5 text-text-neutral-default" />
                          <span className="text-sm text-text-primary-default">{font.name.replace(/\.(ttf|otf|woff2?)$/, "")}</span>
                        </div>
                        <button onClick={() => setFontFiles((prev) => prev.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="size-3.5 text-text-neutral-default hover:text-button-destructive-default" />
                        </button>
                      </div>
                    )) : (
                      <div className="flex items-center justify-center h-full rounded-lg bg-bg-surface p-4">
                        <p className="text-xs text-text-neutral-default">לא הועלו פונטים</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card 2: Elements */}
                <div className="flex gap-6">
                  <div className="w-1/2 flex flex-col gap-4 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="size-5 text-text-neutral-default" />
                      <span className="text-p-bold text-text-primary-default">אלמנטים גרפיים</span>
                    </div>
                    <p className="text-small text-text-neutral-default">לוגו, אייקונים, סטיקרים או מדבקות.</p>

                    <input ref={elementInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" multiple onChange={handleElementUpload} className="hidden" />
                    <button
                      onClick={() => elementInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 transition-all cursor-pointer"
                    >
                      <Upload className="size-5 text-text-neutral-default" />
                      <span className="text-xs text-text-neutral-default">PNG, JPG, SVG</span>
                    </button>
                  </div>

                  {/* Uploaded elements */}
                  <div className="w-1/2">
                    {elementImages.length > 0 ? (
                      <div className="flex gap-3 flex-wrap">
                        {elementImages.map((img, i) => (
                          <div key={i} className="relative size-[80px] rounded-lg overflow-hidden bg-bg-surface group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img} alt={`element ${i + 1}`} className="w-full h-full object-contain p-2" />
                            <button onClick={() => setElementImages((prev) => prev.filter((_, j) => j !== i))} className="absolute top-1 end-1 size-5 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="size-3 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full rounded-lg bg-bg-surface p-4">
                        <p className="text-xs text-text-neutral-default">לא הועלו אלמנטים</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card 3: Examples */}
                <div className="flex gap-6">
                  <div className="w-1/2 flex flex-col gap-5 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-5 text-text-neutral-default" />
                        <span className="text-p-bold text-text-primary-default">דוגמאות לאימון</span>
                      </div>
                      {brandStyleSaved && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <Check className="size-3.5" />
                          סגנון נשמר
                        </span>
                      )}
                    </div>
                    <p className="text-small text-text-neutral-default">
                      העלו צילומי מסך של הקאברים והקרוסלות שלכם כדי לאמן את המודל
                    </p>

                    {/* Covers upload */}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-text-primary-default">קאברים</span>
                      <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { if (e.target.files) handleCoverUpload(e.target.files); if (coverInputRef.current) coverInputRef.current.value = "" }} className="hidden" />
                      <button
                        onClick={() => coverInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); handleCoverUpload(e.dataTransfer.files) }}
                        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 transition-all cursor-pointer"
                      >
                        <Upload className="size-5 text-text-neutral-default" />
                        <span className="text-xs text-text-neutral-default">PNG, JPG</span>
                      </button>
                      {coverUploading.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg-surface p-2">
                          <span className="text-xs text-text-primary-default truncate flex-1">{f.name}</span>
                          {f.status === "done" ? <Check className="size-3.5 text-green-600" /> : <Progress value={f.progress} className="w-20 h-1.5" />}
                        </div>
                      ))}
                    </div>

                    {/* Carousels upload */}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-text-primary-default">קרוסלות</span>
                      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 opacity-50">
                        <Upload className="size-5 text-text-neutral-default" />
                        <span className="text-xs text-text-neutral-default">בקרוב</span>
                      </div>
                    </div>

                    {/* Analyze button */}
                    {coverImages.length >= 3 && (
                      <div className="flex items-center gap-3">
                        <Button onClick={handleAnalyzeCovers} disabled={analyzingCovers || !storedKeys.anthropic_api_key} className="gap-2">
                          {analyzingCovers ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                          {analyzingCovers ? "מנתח סגנון..." : "נתח סגנון ויזואלי"}
                        </Button>
                        {analyzeError && (
                          <span className="flex items-center gap-1 text-xs text-button-destructive-default">
                            <AlertCircle className="size-3.5" />
                            {analyzeError}
                          </span>
                        )}
                      </div>
                    )}
                    {coverImages.length > 0 && coverImages.length < 3 && (
                      <p className="text-xs text-text-primary-disabled flex items-center gap-1">
                        <AlertCircle className="size-3.5" />
                        העלי לפחות 3 דוגמאות
                      </p>
                    )}
                  </div>

                  {/* Uploaded examples */}
                  <div className="w-1/2 flex flex-col gap-4">
                    {coverImages.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-text-neutral-default">קאברים ({coverImages.length})</span>
                        <div className="flex gap-2 flex-wrap">
                          {coverImages.map((img, i) => (
                            <div key={i} className="relative w-[60px] aspect-[9/16] rounded-md overflow-hidden group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img} alt={`cover ${i + 1}`} className="w-full h-full object-cover" />
                              <button onClick={() => setCoverImages((prev) => prev.filter((_, j) => j !== i))} className="absolute top-0.5 end-0.5 size-4 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="size-2.5 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {coverImages.length === 0 && (
                      <div className="flex items-center justify-center h-full rounded-lg bg-bg-surface p-4">
                        <p className="text-xs text-text-neutral-default">לא הועלו דוגמאות</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
