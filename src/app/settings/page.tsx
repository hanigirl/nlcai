"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Link2, Unlink, Plus, Trash2, Upload, X, Sparkles, Check, Type, Image as ImageIcon, Search, Download } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { ComingSoon } from "@/components/coming-soon"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { parseCreatorInput } from "@/lib/creator-url"
import { CreatorsList } from "@/components/creators-list"
import { ProductsList, type ProductEntry } from "@/components/products-list"
import { toast } from "sonner"

const GOOGLE_FONTS = [
  "Rubik", "Heebo", "Assistant", "Open Sans", "Noto Sans Hebrew", "Secular One",
  "Alef", "Varela Round", "Frank Ruhl Libre", "Suez One", "David Libre",
  "Amatic SC", "Karantina", "Fredoka", "Bona Nova", "Bellefair",
  "Inter", "Roboto", "Montserrat", "Poppins", "Lato", "Raleway",
  "Oswald", "Playfair Display", "Merriweather", "Nunito", "Work Sans",
  "DM Sans", "Space Grotesk", "Outfit", "Manrope", "Sora", "Lexend",
  "Plus Jakarta Sans", "Figtree", "Geist", "Satoshi",
]

type KeyName = "anthropic_api_key" | "heygen_api_key" | "apify_api_key"
type SettingsTab = "connections" | "business" | "products" | "creators" | "media"

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
    placeholder: "הכניסו את ה-API key שלכם",
    helpUrl: "https://app.heygen.com/settings?nav=API",
    helpLabel: "app.heygen.com",
  },
  {
    key: "apify_api_key",
    label: "Apify API Key",
    placeholder: "apify_api_...",
    helpUrl: "https://console.apify.com/settings/integrations",
    helpLabel: "console.apify.com",
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
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  // Local alias for the shared ProductEntry — same shape, tagged so it's clear
  // we're using the unified component in both onboarding and settings.
  type Product = ProductEntry

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
    apify_api_key: null,
  })
  const [inputValues, setInputValues] = useState<Record<KeyName, string>>({
    anthropic_api_key: "",
    heygen_api_key: "",
    apify_api_key: "",
  })

  // Business tab state
  const [businessName, setBusinessName] = useState("")
  const [businessNiche, setBusinessNiche] = useState("")
  const [businessExpertise, setBusinessExpertise] = useState("")
  const [savingBusiness, setSavingBusiness] = useState(false)
  const [businessSaved, setBusinessSaved] = useState(false)
  const [styleFileToUpload, setStyleFileToUpload] = useState<File | null>(null)
  const [audienceFileToUpload, setAudienceFileToUpload] = useState<File | null>(null)
  const [uploadingStyle, setUploadingStyle] = useState(false)
  const [uploadingAudience, setUploadingAudience] = useState(false)
  const [styleOriginalFile, setStyleOriginalFile] = useState<{ name: string; url: string } | null>(null)
  const [audienceOriginalFile, setAudienceOriginalFile] = useState<{ name: string; url: string } | null>(null)
  const styleFileRef = useRef<HTMLInputElement>(null)
  const audienceFileRef = useRef<HTMLInputElement>(null)

  // Top creators (user-specified inspiration sources for the ideas pipeline)
  const [topCreators, setTopCreators] = useState<{ id?: string; url: string }[]>([{ url: "" }])
  const [savingCreators, setSavingCreators] = useState(false)
  const [creatorsSaved, setCreatorsSaved] = useState(false)

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
        .select("anthropic_api_key, heygen_api_key, apify_api_key, brand_style")
        .eq("id", user.id)
        .single()
      const row = data as Record<string, unknown> | null
      if (row) {
        setStoredKeys({
          anthropic_api_key: (row.anthropic_api_key as string) ?? null,
          heygen_api_key: (row.heygen_api_key as string) ?? null,
          apify_api_key: (row.apify_api_key as string) ?? null,
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

      // Load user's top creators
      const { data: creatorRows } = await supabase
        .from("user_top_creators")
        .select("id, url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
      if (creatorRows && creatorRows.length > 0) {
        setTopCreators((creatorRows as { id: string; url: string }[]).map((c) => ({ id: c.id, url: c.url })))
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
          landingPageUrl: (p.landing_page_url as string) || "",
          pageSummary: (p.page_summary as string) || null,
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
        .insert(toInsert.map((p) => ({ user_id: user.id, name: p.name, type: p.type, landing_page_url: p.landingPageUrl || null })) as never)
        .select("id")
      if (inserted) {
        toInsert.forEach((p, i) => {
          if (p.landingPageUrl) {
            fetch("/api/parse-product-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.landingPageUrl, productId: (inserted[i] as { id: string }).id }) }).catch(() => {})
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

  const handleSaveCreators = async () => {
    setSavingCreators(true)
    setCreatorsSaved(false)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const parsed = topCreators
        .map((c) => parseCreatorInput(c.url))
        .filter((p): p is NonNullable<typeof p> => p !== null)

      // Replace the full list — authoritative save
      await supabase.from("user_top_creators").delete().eq("user_id", user.id)
      if (parsed.length > 0) {
        const payload = parsed.map((p) => ({
          user_id: user.id,
          url: p.url,
          handle: p.handle,
          platform: p.platform,
        }))
        const { error } = await supabase.from("user_top_creators").insert(payload as never)
        if (error) {
          toast.error(`שגיאה בשמירה: ${error.message}`)
          return
        }
      }

      setCreatorsSaved(true)
      setTimeout(() => setCreatorsSaved(false), 2000)
    } finally {
      setSavingCreators(false)
    }
  }

  const refreshIdentityFile = async (category: "style_file" | "audience_file") => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from("user_media")
      .select("file_name, storage_path")
      .eq("user_id", user.id)
      .eq("category", category)
      .maybeSingle()
    const row = data as { file_name: string; storage_path: string } | null
    if (!row) return
    const { data: urlData } = supabase.storage.from("user-media").getPublicUrl(row.storage_path)
    if (category === "style_file") {
      setStyleOriginalFile({ name: row.file_name, url: urlData.publicUrl })
    } else {
      setAudienceOriginalFile({ name: row.file_name, url: urlData.publicUrl })
    }
  }

  const handleUploadStyle = async () => {
    if (!styleFileToUpload) return
    const file = styleFileToUpload
    setUploadingStyle(true)
    toast.success("הקובץ עלה בהצלחה")
    setTimeout(() => toast("מנתח קבצים"), 700)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", "core")
      formData.append("manualFields", JSON.stringify({
        productName: businessName,
        niche: businessNiche,
        whoIAm: businessExpertise,
      }))
      await fetch("/api/parse-identity", { method: "POST", body: formData })
      setStyleOriginalFile((prev) => ({ name: file.name, url: prev?.url ?? "" }))
      setStyleFileToUpload(null)
      await refreshIdentityFile("style_file")
    } finally {
      setUploadingStyle(false)
    }
  }

  const handleUploadAudience = async () => {
    if (!audienceFileToUpload) return
    const file = audienceFileToUpload
    setUploadingAudience(true)
    toast.success("הקובץ עלה בהצלחה")
    setTimeout(() => toast("מנתח קבצים"), 700)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", "audience")
      await fetch("/api/parse-identity", { method: "POST", body: formData })
      setAudienceOriginalFile((prev) => ({ name: file.name, url: prev?.url ?? "" }))
      setAudienceFileToUpload(null)
      await refreshIdentityFile("audience_file")
    } finally {
      setUploadingAudience(false)
    }
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "connections", label: "חיבורים" },
    { id: "business", label: "מידע על העסק" },
    { id: "products", label: "מוצרים" },
    { id: "creators", label: "יוצרים מובילים" },
    { id: "media", label: "מדיה" },
  ]

  // Sub-sections per main tab
  const SUB_SECTIONS: Record<SettingsTab, { id: string; label: string; icon: typeof Type }[]> = {
    connections: [
      { id: "claude", label: "Claude", icon: Link2 },
      { id: "heygen", label: "HeyGen", icon: Link2 },
      { id: "apify", label: "Apify", icon: Link2 },
    ],
    business: [
      { id: "about", label: "על העסק", icon: Type },
      { id: "you", label: "עליך", icon: Type },
      { id: "files", label: "קבצים להעלאה", icon: Upload },
    ],
    products: [
      { id: "list", label: "המוצרים שלכם", icon: Type },
    ],
    creators: [
      { id: "list", label: "היוצרים שלכם", icon: Type },
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
                  {KEYS.filter((cfg) => {
                    if (activeSubSection === "claude") return cfg.key === "anthropic_api_key"
                    if (activeSubSection === "heygen") return cfg.key === "heygen_api_key"
                    if (activeSubSection === "apify") return cfg.key === "apify_api_key"
                    return false
                  }).map((cfg) => {
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
                              מצאו את ה-API key שלכם ב-{" "}
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
                      placeholder="ספרו על הניסיון והמומחיות שלכם"
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
                    onClick={() => {
                      if (styleFileRef.current) {
                        styleFileRef.current.value = ""
                        styleFileRef.current.click()
                      }
                    }}
                  >
                    <Input
                      placeholder="העלה קובץ סגנון כתיבה"
                      value={styleFileToUpload?.name ?? styleOriginalFile?.name ?? ""}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={styleFileRef}
                      type="file"
                      className="hidden"
                      accept=".docx"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) setStyleFileToUpload(f)
                      }}
                    />
                  </div>
                  <p className="text-xs-body text-text-neutral-default text-start">
                    במידה ואין לכם קובץ כזה{" "}
                    <a
                      href="https://gemini.google.com/gem/dc85c1254c9e?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-primary-default font-semibold hover:underline"
                    >
                      יוצרים אותו כאן
                    </a>
                  </p>
                  <Button
                    onClick={handleUploadStyle}
                    disabled={!styleFileToUpload || uploadingStyle}
                    className="w-fit gap-2"
                  >
                    {uploadingStyle && <Loader2 className="size-4 animate-spin" />}
                    שמור ונתח
                  </Button>
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
                    onClick={() => {
                      if (audienceFileRef.current) {
                        audienceFileRef.current.value = ""
                        audienceFileRef.current.click()
                      }
                    }}
                  >
                    <Input
                      placeholder="העלה קובץ ניתוח קהל יעד"
                      value={audienceFileToUpload?.name ?? audienceOriginalFile?.name ?? ""}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={audienceFileRef}
                      type="file"
                      className="hidden"
                      accept=".docx"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) setAudienceFileToUpload(f)
                      }}
                    />
                  </div>
                  <p className="text-xs-body text-text-neutral-default text-start">
                    אם אין לכם ניתוח קהל יעד{" "}
                    <a
                      href="https://gemini.google.com/gem/e4e3d302fdd7?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-primary-default font-semibold hover:underline"
                    >
                      יוצרים את זה כאן
                    </a>
                  </p>
                  <Button
                    onClick={handleUploadAudience}
                    disabled={!audienceFileToUpload || uploadingAudience}
                    className="w-fit gap-2"
                  >
                    {uploadingAudience && <Loader2 className="size-4 animate-spin" />}
                    שמור ונתח
                  </Button>
                </div>

                  </>
                )}

                {/* Save button for about/you sub-sections */}
                {activeSubSection !== "files" && (
                  <Button onClick={handleSaveBusiness} disabled={savingBusiness} className="w-fit gap-2">
                    {savingBusiness ? <Loader2 className="size-4 animate-spin" /> : businessSaved ? <Check className="size-4" /> : null}
                    {savingBusiness ? "שומר..." : businessSaved ? "נשמר!" : "שמור"}
                  </Button>
                )}
                </div>
              </div>
            )}

            {/* ==================== PRODUCTS TAB ==================== */}
            {activeTab === "products" && (
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.products} active={activeSubSection} onChange={setActiveSubSection} />
                <div className="flex-1 min-w-0 max-w-lg flex flex-col gap-4">
                {!loading && products.length === 0 && (
                  <p className="text-small text-text-neutral-default">לא נמצאו מוצרים. הוסיפו מוצרים כדי ליצור תוכן מותאם.</p>
                )}
                <ProductsList products={products} onChange={setProducts} />
                <Button onClick={handleSaveProducts} disabled={savingProducts} className="w-fit self-end gap-2">
                  {savingProducts && <Loader2 className="size-4 animate-spin" />}
                  שמור מוצרים
                </Button>
                </div>
              </div>
            )}

            {/* ==================== CREATORS TAB ==================== */}
            {activeTab === "creators" && (
              <div className="flex gap-8">
                <SubNav sections={SUB_SECTIONS.creators} active={activeSubSection} onChange={setActiveSubSection} />
                <div className="flex-1 min-w-0 max-w-lg flex flex-col gap-4">
                  <div>
                    <h3 className="text-p-bold text-text-primary-default">היוצרים שמעניינים אתכם</h3>
                    <p className="text-small text-text-neutral-default mt-1">
                      אנחנו נייצר לכם רעיונות לתכנים בהשראת היוצרים המובילים בנישה שלכם שתשימו פה (מומלץ)
                    </p>
                  </div>
                  <CreatorsList
                    creators={topCreators}
                    onChange={setTopCreators}
                    addButtonLabel="הוספת יוצר"
                  />
                  <Button onClick={handleSaveCreators} disabled={savingCreators} className="w-fit gap-2">
                    {savingCreators ? <Loader2 className="size-4 animate-spin" /> : creatorsSaved ? <Check className="size-4" /> : null}
                    {savingCreators ? "שומר..." : creatorsSaved ? "נשמר!" : "שמור"}
                  </Button>
                </div>
              </div>
            )}

            {/* ==================== MEDIA TAB ==================== */}
            {activeTab === "media" && (
              <div className="flex gap-8">
                <div className="pointer-events-none opacity-50">
                  <SubNav sections={SUB_SECTIONS.media} active={activeMediaSection} onChange={(id) => { setActiveMediaSection(id as MediaSection); setActiveSubSection(id) }} />
                </div>

                {/* Content area — 50% of page, disabled with Coming Soon overlay */}
                <div className="w-1/2 min-w-0 relative">
                  <div className="absolute inset-0 z-10 flex items-start justify-center pt-12 bg-bg-surface/60 backdrop-blur-[2px] rounded-xl">
                    <ComingSoon />
                  </div>
                  <div className="pointer-events-none opacity-40 select-none" aria-hidden="true">
                  {/* ── Fonts ── */}
                  {activeMediaSection === "fonts" && (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-p-bold text-text-primary-default">פונטים</h3>
                        <p className="text-small text-text-neutral-default mt-1">העלו את הפונטים שאתם עובדים איתם, או בחרו מ-Google Fonts. עד 5 פונטים.</p>
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
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
