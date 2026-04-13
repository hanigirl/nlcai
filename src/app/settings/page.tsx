"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Link2, Unlink, Plus, Trash2, Upload, X, Sparkles, Check, Type, Image as ImageIcon, Search, Download } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"

const GOOGLE_FONTS = [
  "Rubik", "Heebo", "Assistant", "Open Sans", "Noto Sans Hebrew", "Secular One",
  "Alef", "Varela Round", "Frank Ruhl Libre", "Suez One", "David Libre",
  "Amatic SC", "Karantina", "Fredoka", "Bona Nova", "Bellefair",
  "Inter", "Roboto", "Montserrat", "Poppins", "Lato", "Raleway",
  "Oswald", "Playfair Display", "Merriweather", "Nunito", "Work Sans",
  "DM Sans", "Space Grotesk", "Outfit", "Manrope", "Sora", "Lexend",
  "Plus Jakarta Sans", "Figtree", "Geist", "Satoshi",
]

type KeyName = "anthropic_api_key" | "heygen_api_key"
type SettingsTab = "connections" | "business" | "products" | "media"

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

  const searchParams = useSearchParams()
  const initialTab = (searchParams.get("tab") as SettingsTab) || "connections"
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [activeSubSection, setActiveSubSection] = useState<string>("")
  type MediaSection = "fonts" | "elements" | "covers" | "carousels"
  const [activeMediaSection, setActiveMediaSection] = useState<MediaSection>("fonts")
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

  // Business tab state
  const [businessName, setBusinessName] = useState("")
  const [businessNiche, setBusinessNiche] = useState("")
  const [businessExpertise, setBusinessExpertise] = useState("")
  const [savingBusiness, setSavingBusiness] = useState(false)
  const [businessSaved, setBusinessSaved] = useState(false)
  const [styleFileName, setStyleFileName] = useState("")
  const [styleFileToUpload, setStyleFileToUpload] = useState<File | null>(null)
  const [audienceFileName, setAudienceFileName] = useState("")
  const [audienceFileToUpload, setAudienceFileToUpload] = useState<File | null>(null)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [styleOriginalFile, setStyleOriginalFile] = useState<{ name: string; url: string } | null>(null)
  const [audienceOriginalFile, setAudienceOriginalFile] = useState<{ name: string; url: string } | null>(null)
  const styleFileRef = useRef<HTMLInputElement>(null)
  const audienceFileRef = useRef<HTMLInputElement>(null)

  // Media tab state
  interface MediaItem { id: string; name: string; url: string }
  const [coverItems, setCoverItems] = useState<MediaItem[]>([])
  const [coverUploading, setCoverUploading] = useState<UploadingFile[]>([])
  const [analyzingStyle, setAnalyzingStyle] = useState(false)
  const [styleAnalyzed, setStyleAnalyzed] = useState(false)
  const [fontItems, setFontItems] = useState<MediaItem[]>([])
  const [googleFontSearch, setGoogleFontSearch] = useState("")
  const [showFontDropdown, setShowFontDropdown] = useState(false)
  const [fontUploading, setFontUploading] = useState<UploadingFile[]>([])
  const [elementItems, setElementItems] = useState<MediaItem[]>([])
  const [elementUploading, setElementUploading] = useState<UploadingFile[]>([])
  const coverInputRef = useRef<HTMLInputElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const elementInputRef = useRef<HTMLInputElement>(null)

  // Close font dropdown on outside click
  useEffect(() => {
    const handler = () => setShowFontDropdown(false)
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [])

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
        if (row.brand_style) setStyleAnalyzed(true)
      }

      // Load core identity for business tab
      const { data: coreId } = await supabase
        .from("core_identities")
        .select("product_name, niche, who_i_am")
        .eq("user_id", user.id)
        .single()
      if (coreId) {
        const ci = coreId as Record<string, string | null>
        setBusinessName(ci.product_name ?? "")
        setBusinessNiche(ci.niche ?? "")
        setBusinessExpertise(ci.who_i_am ?? "")
      }

      // Load original uploaded files
      const { data: identityFiles } = await supabase
        .from("user_media")
        .select("category, file_name, storage_path")
        .eq("user_id", user.id)
        .in("category", ["style_file", "audience_file"])
      if (identityFiles) {
        for (const f of identityFiles as { category: string; file_name: string; storage_path: string }[]) {
          const { data: urlData } = supabase.storage.from("user-media").getPublicUrl(f.storage_path)
          if (f.category === "style_file") {
            setStyleOriginalFile({ name: f.file_name, url: urlData.publicUrl })
          } else {
            setAudienceOriginalFile({ name: f.file_name, url: urlData.publicUrl })
          }
        }
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

      // Load user media from Supabase
      const { data: mediaRows } = await supabase
        .from("user_media")
        .select("id, category, file_name, storage_path, metadata")
        .eq("user_id", user.id)
      if (mediaRows) {
        const toItem = (row: { id: string; file_name: string; storage_path: string; metadata: Record<string, unknown> }): MediaItem => {
          const isGoogle = (row.metadata as { source?: string })?.source === "google"
          return { id: row.id, name: row.file_name, url: isGoogle ? "" : supabase.storage.from("user-media").getPublicUrl(row.storage_path).data.publicUrl }
        }
        setFontItems(mediaRows.filter((r) => r.category === "font").map((r) => toItem(r as never)))
        setElementItems(mediaRows.filter((r) => r.category === "element").map((r) => toItem(r as never)))
        setCoverItems(mediaRows.filter((r) => r.category === "cover").map((r) => toItem(r as never)))
      }

      setLoading(false)
    })
  }, [])

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

  // --- Media upload helpers ---
  const uploadMediaFile = useCallback(async (file: File, category: "font" | "element" | "cover", metadata: Record<string, unknown> = {}) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const ext = file.name.split(".").pop() || "bin"
    const storagePath = `${user.id}/${category}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from("user-media").upload(storagePath, file)
    if (uploadError) return null
    const { data: row } = await supabase.from("user_media").insert({
      user_id: user.id, category, file_name: file.name, storage_path: storagePath, metadata,
    }).select("id").single()
    if (!row) return null
    const url = supabase.storage.from("user-media").getPublicUrl(storagePath).data.publicUrl
    return { id: row.id, name: file.name, url } as MediaItem
  }, [])

  const deleteMediaItem = useCallback(async (item: MediaItem, storagePath?: string) => {
    const supabase = createClient()
    await supabase.from("user_media").delete().eq("id", item.id)
    if (storagePath) await supabase.storage.from("user-media").remove([storagePath])
  }, [])

  const handleCoverUpload = async (files: FileList | File[]) => {
    const remaining = 10 - coverItems.length
    const newItems: MediaItem[] = []
    for (const file of Array.from(files).slice(0, remaining)) {
      if (!file.type.startsWith("image/")) continue
      const fileId = crypto.randomUUID()
      setCoverUploading((prev) => [...prev, { id: fileId, name: file.name, progress: 0, status: "uploading" }])
      setCoverUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 50 } : f))
      const item = await uploadMediaFile(file, "cover")
      setCoverUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 100, status: "done" } : f))
      setTimeout(() => setCoverUploading((prev) => prev.filter((f) => f.id !== fileId)), 1000)
      if (item) {
        newItems.push(item)
        setCoverItems((prev) => [...prev, item])
      }
    }
    // Auto-analyze brand style when 3+ covers exist
    const totalCovers = coverItems.length + newItems.length
    if (totalCovers >= 3 && newItems.length > 0) {
      const allUrls = [...coverItems, ...newItems].map((c) => c.url)
      setAnalyzingStyle(true)
      setStyleAnalyzed(false)
      try {
        const res = await fetch("/api/analyze-covers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: allUrls }),
        })
        const data = await res.json()
        if (data.brand_style) {
          setStyleAnalyzed(true)
          setTimeout(() => setStyleAnalyzed(false), 10000)
        }
      } catch { /* ignore */ }
      finally { setAnalyzingStyle(false) }
    }
  }

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (fontItems.length >= 5) break
      const fileId = crypto.randomUUID()
      setFontUploading((prev) => [...prev, { id: fileId, name: file.name, progress: 0, status: "uploading" }])
      setFontUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 50 } : f))
      const item = await uploadMediaFile(file, "font")
      setFontUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 100, status: "done" } : f))
      setTimeout(() => setFontUploading((prev) => prev.filter((f) => f.id !== fileId)), 1000)
      if (item) setFontItems((prev) => [...prev, item])
    }
    if (fontInputRef.current) fontInputRef.current.value = ""
  }

  const handleElementUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const fileId = crypto.randomUUID()
      setElementUploading((prev) => [...prev, { id: fileId, name: file.name, progress: 0, status: "uploading" }])
      setElementUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 50 } : f))
      const item = await uploadMediaFile(file, "element")
      setElementUploading((prev) => prev.map((f) => f.id === fileId ? { ...f, progress: 100, status: "done" } : f))
      setTimeout(() => setElementUploading((prev) => prev.filter((f) => f.id !== fileId)), 1000)
      if (item) setElementItems((prev) => [...prev, item])
    }
    if (elementInputRef.current) elementInputRef.current.value = ""
  }

  const handleAddGoogleFont = async (fontName: string) => {
    if (fontItems.length >= 5) return
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: row } = await supabase.from("user_media").insert({
      user_id: user.id, category: "font" as const, file_name: `${fontName} (Google Fonts)`,
      storage_path: `google:${fontName}`, metadata: { source: "google" },
    }).select("id").single()
    if (row) setFontItems((prev) => [...prev, { id: row.id, name: `${fontName} (Google Fonts)`, url: "" }])
  }

  const handleSaveBusiness = async () => {
    setSavingBusiness(true)
    setBusinessSaved(false)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase
        .from("core_identities")
        .update({
          product_name: businessName,
          niche: businessNiche,
          who_i_am: businessExpertise,
        })
        .eq("user_id", user.id)

      setBusinessSaved(true)
      setTimeout(() => setBusinessSaved(false), 2000)
    } finally {
      setSavingBusiness(false)
    }
  }

  const handleUploadFiles = async () => {
    setUploadingFiles(true)
    try {
      if (styleFileToUpload) {
        const formData = new FormData()
        formData.append("file", styleFileToUpload)
        formData.append("type", "core")
        formData.append("manualFields", JSON.stringify({
          productName: businessName,
          niche: businessNiche,
          whoIAm: businessExpertise,
        }))
        await fetch("/api/parse-identity", { method: "POST", body: formData })
        setStyleFileToUpload(null)
      }

      if (audienceFileToUpload) {
        const formData = new FormData()
        formData.append("file", audienceFileToUpload)
        formData.append("type", "audience")
        await fetch("/api/parse-identity", { method: "POST", body: formData })
        setAudienceFileToUpload(null)
      }
    } finally {
      setUploadingFiles(false)
    }
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "connections", label: "חיבורים" },
    { id: "business", label: "מידע על העסק" },
    { id: "products", label: "מוצרים" },
    { id: "media", label: "מדיה" },
  ]

  // Sub-sections per main tab
  const SUB_SECTIONS: Record<SettingsTab, { id: string; label: string; icon: typeof Type }[]> = {
    connections: [
      { id: "claude", label: "Claude", icon: Link2 },
      { id: "heygen", label: "HeyGen", icon: Link2 },
    ],
    business: [
      { id: "about", label: "על העסק", icon: Type },
      { id: "you", label: "עליך", icon: Type },
      { id: "files", label: "קבצים להעלאה", icon: Upload },
    ],
    products: [
      { id: "list", label: "המוצרים שלך", icon: Type },
    ],
    media: [
      { id: "fonts", label: "פונטים", icon: Type },
      { id: "elements", label: "אלמנטים גרפיים", icon: ImageIcon },
      { id: "covers", label: "קאברים", icon: Sparkles },
      { id: "carousels", label: "קרוסלות", icon: ImageIcon },
    ],
  }

  // Reset sub-section when tab changes
  useEffect(() => {
    const subs = SUB_SECTIONS[activeTab]
    if (subs && subs.length > 0) {
      setActiveSubSection(subs[0].id)
      if (activeTab === "media") setActiveMediaSection(subs[0].id as MediaSection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  function SubNav({ sections, active, onChange }: { sections: { id: string; label: string; icon: typeof Type }[]; active: string; onChange: (id: string) => void }) {
    return (
      <nav className="w-[200px] shrink-0 flex flex-col gap-1">
        {sections.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer text-start ${
              active === item.id
                ? "bg-bg-surface-primary-default text-yellow-20 font-medium"
                : "text-text-neutral-default hover:bg-bg-surface hover:text-text-primary-default"
            }`}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>
    )
  }

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
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.connections} active={activeSubSection} onChange={setActiveSubSection} />
                <div className="flex-1 min-w-0 max-w-lg">
                  {KEYS.filter((cfg) => (activeSubSection === "claude" ? cfg.key === "anthropic_api_key" : cfg.key === "heygen_api_key")).map((cfg) => {
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
              </div>
            )}

            {/* ==================== BUSINESS TAB ==================== */}
            {activeTab === "business" && (
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.business} active={activeSubSection} onChange={setActiveSubSection} />
                <div className="flex-1 min-w-0 max-w-lg flex flex-col gap-5">
                {activeSubSection === "about" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className="text-small-bold text-text-primary-default">שם העסק</label>
                      <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="שם העסק" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-small-bold text-text-primary-default">נישה</label>
                      <Input value={businessNiche} onChange={(e) => setBusinessNiche(e.target.value)} placeholder="למשל: עיצוב UX, שיווק דיגיטלי, כושר..." />
                    </div>
                  </>
                )}

                {activeSubSection === "you" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-small-bold text-text-primary-default">מי אני — ניסיון ומומחיות</label>
                    <Textarea
                      value={businessExpertise}
                      onChange={(e) => setBusinessExpertise(e.target.value)}
                      placeholder="ספרי על הניסיון והמומחיות שלך"
                      className="min-h-[200px] rounded-xl"
                    />
                  </div>
                )}

                {activeSubSection === "files" && (
                  <>
                {/* Style file */}
                <div className="flex flex-col gap-2">
                  <label className="text-small-bold text-text-primary-default">סגנון כתיבה</label>
                  {styleOriginalFile && !styleFileToUpload && (
                    <a
                      href={styleOriginalFile.url}
                      download={styleOriginalFile.name}
                      className="flex items-center gap-2 w-fit rounded-lg bg-bg-surface px-3 py-2 text-small text-text-primary-default hover:bg-bg-surface-hover transition-colors"
                    >
                      <Download className="size-3.5 text-text-neutral-default" />
                      {styleOriginalFile.name}
                    </a>
                  )}
                  <div
                    className="relative cursor-pointer"
                    onClick={() => styleFileRef.current?.click()}
                  >
                    <Input
                      placeholder={styleOriginalFile ? "העלה קובץ חדש לעדכון" : "העלה קובץ סגנון כתיבה"}
                      value={styleFileName}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={styleFileRef}
                      type="file"
                      className="hidden"
                      accept=".doc,.docx,.txt,.rtf,.pdf,.odt"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) {
                          setStyleFileName(f.name)
                          setStyleFileToUpload(f)
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Audience file */}
                <div className="flex flex-col gap-2">
                  <label className="text-small-bold text-text-primary-default">ניתוח קהל יעד</label>
                  {audienceOriginalFile && !audienceFileToUpload && (
                    <a
                      href={audienceOriginalFile.url}
                      download={audienceOriginalFile.name}
                      className="flex items-center gap-2 w-fit rounded-lg bg-bg-surface px-3 py-2 text-small text-text-primary-default hover:bg-bg-surface-hover transition-colors"
                    >
                      <Download className="size-3.5 text-text-neutral-default" />
                      {audienceOriginalFile.name}
                    </a>
                  )}
                  <div
                    className="relative cursor-pointer"
                    onClick={() => audienceFileRef.current?.click()}
                  >
                    <Input
                      placeholder={audienceOriginalFile ? "העלה קובץ חדש לעדכון" : "העלה קובץ ניתוח קהל יעד"}
                      value={audienceFileName}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={audienceFileRef}
                      type="file"
                      className="hidden"
                      accept=".doc,.docx,.txt,.rtf,.pdf,.odt"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) {
                          setAudienceFileName(f.name)
                          setAudienceFileToUpload(f)
                        }
                      }}
                    />
                  </div>
                </div>

                  </>
                )}

                {/* Single save button at bottom */}
                <Button onClick={async () => {
                  await handleSaveBusiness()
                  if (styleFileToUpload || audienceFileToUpload) {
                    await handleUploadFiles()
                  }
                }} disabled={savingBusiness || uploadingFiles} className="w-fit gap-2">
                  {(savingBusiness || uploadingFiles) ? <Loader2 className="size-4 animate-spin" /> : businessSaved ? <Check className="size-4" /> : null}
                  {uploadingFiles ? "מנתח קבצים..." : savingBusiness ? "שומר..." : businessSaved ? "נשמר!" : "שמור"}
                </Button>
                </div>
              </div>
            )}

            {/* ==================== PRODUCTS TAB ==================== */}
            {activeTab === "products" && (
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.products} active={activeSubSection} onChange={setActiveSubSection} />
                <div className="flex-1 min-w-0 max-w-lg flex flex-col gap-4">
                {products.length === 0 && (
                  <p className="text-small text-text-neutral-default">לא נמצאו מוצרים. הוסיפי מוצרים כדי ליצור תוכן מותאם.</p>
                )}
                <div className="flex flex-col gap-3">
                  {products.map((product, i) => (
                    <div key={product.id || i} className="group flex flex-col gap-2 rounded-2xl border border-border-neutral-default bg-bg-surface px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Input placeholder="שם המוצר" value={product.name} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], name: e.target.value }; setProducts(u) }} className="flex-1 border-none bg-transparent shadow-none" />
                        <div className="relative">
                          <select value={product.type} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], type: e.target.value as "front" | "premium" | "lead_magnet" }; setProducts(u) }} className="h-10 rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 px-3 text-small text-text-primary-default appearance-none cursor-pointer pe-8" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "left 0.5rem center" }}>
                            <option value="front">פרונט</option>
                            <option value="premium">פרימיום</option>
                            <option value="lead_magnet">מגנט לידים</option>
                          </select>
                        </div>
                        <button type="button" onClick={() => setProducts(products.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 transition-opacity p-1">
                          <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
                        </button>
                      </div>
                      <Input dir="ltr" placeholder="לינק לדף המוצר (אופציונלי)" value={product.landing_page_url} onChange={(e) => { const u = [...products]; u[i] = { ...u[i], landing_page_url: e.target.value }; setProducts(u) }} className="border-none bg-white dark:bg-gray-10 shadow-none text-sm" />
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
              </div>
            )}

            {/* ==================== MEDIA TAB ==================== */}
            {activeTab === "media" && (
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.media} active={activeMediaSection} onChange={(id) => { setActiveMediaSection(id as MediaSection); setActiveSubSection(id) }} />

                {/* Content area — 50% of page */}
                <div className="w-1/2 min-w-0">
                  {/* ── Fonts ── */}
                  {activeMediaSection === "fonts" && (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-p-bold text-text-primary-default">פונטים</h3>
                        <p className="text-small text-text-neutral-default mt-1">העלי את הפונטים שאת עובדת איתם, או בחרי מ-Google Fonts. עד 5 פונטים.</p>
                      </div>

                      {fontItems.length >= 5 ? (
                        <p className="text-sm text-text-neutral-default">הגעת למקסימום 5 פונטים להעלאה</p>
                      ) : (
                        <>
                          {/* Google Fonts searchable dropdown */}
                          <div className="flex flex-col gap-1.5 relative" onClick={(e) => e.stopPropagation()}>
                            <label className="text-xs text-text-neutral-default">Google Fonts</label>
                            <div className="relative">
                              <Input
                                placeholder="חיפוש פונט..."
                                value={googleFontSearch}
                                onChange={(e) => { setGoogleFontSearch(e.target.value); setShowFontDropdown(true) }}
                                onFocus={() => setShowFontDropdown(true)}
                                className="text-sm text-start ps-9"
                              />
                              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default pointer-events-none" />
                            </div>
                            {showFontDropdown && googleFontSearch.length > 0 && (
                              <div className="absolute top-full mt-1 left-0 right-0 z-10 max-h-[200px] overflow-y-auto rounded-xl border border-border-neutral-default bg-white dark:bg-gray-10 shadow-lg">
                                {GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(googleFontSearch.toLowerCase())).slice(0, 8).map((font) => (
                                  <button
                                    key={font}
                                    onClick={() => {
                                      handleAddGoogleFont(font)
                                      setGoogleFontSearch("")
                                      setShowFontDropdown(false)
                                    }}
                                    disabled={fontItems.length >= 5}
                                    className="w-full text-start px-3 py-2.5 text-sm text-text-primary-default hover:bg-bg-surface transition-colors cursor-pointer disabled:opacity-40"
                                    style={{ fontFamily: font }}
                                  >
                                    {font}
                                  </button>
                                ))}
                                {GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(googleFontSearch.toLowerCase())).length === 0 && (
                                  <div className="px-3 py-2.5 text-xs text-text-neutral-default">לא נמצאו תוצאות</div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Divider */}
                          <div className="flex items-center gap-3">
                            <div className="h-px flex-1 bg-border-neutral-default" />
                            <span className="text-xs text-text-neutral-default">או העלאה ידנית</span>
                            <div className="h-px flex-1 bg-border-neutral-default" />
                          </div>

                          <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple onChange={handleFontUpload} className="hidden" />
                          <button
                            onClick={() => fontInputRef.current?.click()}
                            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 dark:hover:bg-gray-20 transition-all cursor-pointer"
                          >
                            <Upload className="size-5 text-text-neutral-default" />
                            <span className="text-xs text-text-neutral-default">TTF, OTF, WOFF</span>
                          </button>
                        </>
                      )}

                      {fontUploading.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg-surface p-2">
                          <span className="text-xs text-text-primary-default truncate flex-1">{f.name}</span>
                          {f.status === "done" ? <Check className="size-3.5 text-green-600 dark:text-green-400" /> : <Progress value={f.progress} className="w-20 h-1.5" />}
                        </div>
                      ))}

                      {/* Uploaded fonts */}
                      {fontItems.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {fontItems.map((font) => (
                            <div key={font.id} className="flex items-center justify-between rounded-lg bg-bg-surface px-3 py-2.5 group">
                              <div className="flex items-center gap-2">
                                <Type className="size-3.5 text-text-neutral-default" />
                                <span className="text-sm text-text-primary-default">{font.name.replace(/\.(ttf|otf|woff2?)$/, "")}</span>
                              </div>
                              <button onClick={async () => { await deleteMediaItem(font); setFontItems((prev) => prev.filter((f) => f.id !== font.id)) }} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="size-3.5 text-text-neutral-default hover:text-button-destructive-default" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Graphic Elements ── */}
                  {activeMediaSection === "elements" && (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-p-bold text-text-primary-default">אלמנטים גרפיים</h3>
                        <p className="text-small text-text-neutral-default mt-1">לוגו, אייקונים, סטיקרים או מדבקות.</p>
                      </div>

                      <input ref={elementInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" multiple onChange={handleElementUpload} className="hidden" />
                      <button
                        onClick={() => elementInputRef.current?.click()}
                        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 dark:hover:bg-gray-20 transition-all cursor-pointer"
                      >
                        <Upload className="size-5 text-text-neutral-default" />
                        <span className="text-xs text-text-neutral-default">PNG, JPG, SVG</span>
                      </button>

                      {elementUploading.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg-surface p-2">
                          <span className="text-xs text-text-primary-default truncate flex-1">{f.name}</span>
                          {f.status === "done" ? <Check className="size-3.5 text-green-600 dark:text-green-400" /> : <Progress value={f.progress} className="w-20 h-1.5" />}
                        </div>
                      ))}

                      {elementItems.length > 0 && (
                        <div className="flex gap-3 flex-wrap">
                          {elementItems.map((item) => (
                            <div key={item.id} className="relative size-[80px] rounded-lg overflow-hidden bg-bg-surface group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={item.url} alt={item.name} className="w-full h-full object-contain p-2" />
                              <button onClick={async () => { await deleteMediaItem(item); setElementItems((prev) => prev.filter((e) => e.id !== item.id)) }} className="absolute top-1 end-1 size-5 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="size-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Covers ── */}
                  {activeMediaSection === "covers" && (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-p-bold text-text-primary-default">דוגמאות לקאברים</h3>
                        <p className="text-small text-text-neutral-default mt-1">
                          העלו צילומי מסך של הקאברים שלכם — הסוכנים ישתמשו בהם כרפרנס
                        </p>
                      </div>

                      <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { if (e.target.files) handleCoverUpload(e.target.files); if (coverInputRef.current) coverInputRef.current.value = "" }} className="hidden" />
                      <button
                        onClick={() => coverInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); handleCoverUpload(e.dataTransfer.files) }}
                        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 hover:bg-gray-95 dark:hover:bg-gray-20 transition-all cursor-pointer"
                      >
                        <Upload className="size-5 text-text-neutral-default" />
                        <span className="text-xs text-text-neutral-default">PNG, JPG (עד 10)</span>
                      </button>

                      {coverUploading.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg-surface p-2">
                          <span className="text-xs text-text-primary-default truncate flex-1">{f.name}</span>
                          {f.status === "done" ? <Check className="size-3.5 text-green-600 dark:text-green-400" /> : <Progress value={f.progress} className="w-20 h-1.5" />}
                        </div>
                      ))}

                      {coverItems.length > 0 && (
                        <div className="flex gap-3 flex-wrap">
                          {coverItems.map((item) => (
                            <div key={item.id} className="relative size-[80px] rounded-lg overflow-hidden bg-bg-surface group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                              <button onClick={async () => { await deleteMediaItem(item); setCoverItems((prev) => prev.filter((c) => c.id !== item.id)) }} className="absolute top-1 end-1 size-5 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="size-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {analyzingStyle && (
                        <div className="flex items-center gap-2 text-sm text-text-neutral-default">
                          <Loader2 className="size-4 animate-spin" />
                          מנתח שפה ויזואלית...
                        </div>
                      )}
                      {styleAnalyzed && !analyzingStyle && (
                        <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                          <Check className="size-4" />
                          שפה ויזואלית נשמרה
                        </div>
                      )}

                      {coverItems.length >= 3 && !analyzingStyle && (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            const allUrls = coverItems.map((c) => c.url)
                            setAnalyzingStyle(true)
                            setStyleAnalyzed(false)
                            try {
                              const res = await fetch("/api/analyze-covers", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ images: allUrls }),
                              })
                              const data = await res.json()
                              if (data.brand_style) {
                                setStyleAnalyzed(true)
                                setTimeout(() => setStyleAnalyzed(false), 10000)
                              }
                            } catch { /* ignore */ }
                            finally { setAnalyzingStyle(false) }
                          }}
                          className="w-fit gap-2"
                        >
                          <Sparkles className="size-4" />
                          נתח שפה ויזואלית מחדש
                        </Button>
                      )}

                    </div>
                  )}

                  {/* ── Carousels (coming soon) ── */}
                  {activeMediaSection === "carousels" && (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-p-bold text-text-primary-default">דוגמאות לקרוסלות</h3>
                        <p className="text-small text-text-neutral-default mt-1">בקרוב</p>
                      </div>
                      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-neutral-default p-5 opacity-40">
                        <Upload className="size-5 text-text-neutral-default" />
                        <span className="text-xs text-text-neutral-default">PNG, JPG</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
