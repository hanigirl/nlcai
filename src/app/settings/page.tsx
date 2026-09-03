"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Link2, Unlink, Plus, Trash2, Upload, X, Sparkles, Check, Type, Image as ImageIcon, Search, Download, AlertCircle, AlertTriangle } from "lucide-react"
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
import { BusinessSourcesPanel } from "@/components/business-sources-panel"
import { InstagramConnect } from "@/components/instagram-connect"
import { toast } from "sonner"
import { validateIdentityFile } from "@/lib/validate-identity-file"
import { isLegacyGeminiKey } from "@/lib/api-keys"
import {
  EMPTY_CORE_IDENTITY,
  type CoreIdentityValues,
} from "@/components/core-identity-form"
import {
  EMPTY_AUDIENCE_IDENTITY,
  type AudienceIdentityValues,
} from "@/components/audience-identity-form"
import {
  CoreIdentityGapDialog,
  AudienceIdentityGapDialog,
} from "@/components/identity-gap-dialog"
import { ConfirmModal } from "@/components/confirm-modal"
import { getCurrentUser } from "@/lib/supabase/current-user"

const GOOGLE_FONTS = [
  "Rubik", "Heebo", "Assistant", "Open Sans", "Noto Sans Hebrew", "Secular One",
  "Alef", "Varela Round", "Frank Ruhl Libre", "Suez One", "David Libre",
  "Amatic SC", "Karantina", "Fredoka", "Bona Nova", "Bellefair",
  "Inter", "Roboto", "Montserrat", "Poppins", "Lato", "Raleway",
  "Oswald", "Playfair Display", "Merriweather", "Nunito", "Work Sans",
  "DM Sans", "Space Grotesk", "Outfit", "Manrope", "Sora", "Lexend",
  "Plus Jakarta Sans", "Figtree", "Geist", "Satoshi",
]

type KeyName = "anthropic_api_key" | "heygen_api_key" | "apify_api_key" | "openai_api_key" | "gemini_api_key"
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
  {
    key: "openai_api_key",
    label: "OpenAI API Key",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpLabel: "platform.openai.com",
  },
  {
    key: "gemini_api_key",
    label: "Gemini API Key",
    // AI Studio issues "AQ." auth keys today; "AIza" is the legacy format
    // still in circulation until Google retires it. Show both so neither
    // looks wrong.
    placeholder: "AQ.... / AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    helpLabel: "aistudio.google.com",
  },
]

function maskKey(key: string): string {
  if (key.length <= 4) return "••••"
  return "••••••" + key.slice(-4)
}

// Stitch parse-identity's response into a CoreIdentityValues for popup prefill.
function buildCoreIdentityFromResponse(
  manual: { productName: string; niche: string; whoIAm: string },
  parsed: Record<string, unknown> | undefined,
  saved: Record<string, unknown> | undefined,
): CoreIdentityValues {
  const pickStr = (...vals: unknown[]): string => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v
    return ""
  }
  return {
    productName: pickStr(manual.productName, parsed?.productName, saved?.product_name),
    niche: pickStr(manual.niche, parsed?.niche, saved?.niche),
    whoIAm: pickStr(manual.whoIAm, parsed?.whoIAm, saved?.who_i_am),
    whoIServe: pickStr(parsed?.whoIServe, saved?.who_i_serve),
    howISound: pickStr(parsed?.howISound, saved?.how_i_sound),
    slangExamples: pickStr(parsed?.slangExamples, saved?.slang_examples),
    whatINeverDo: pickStr(parsed?.whatINeverDo, saved?.what_i_never_do),
  }
}

function coreMissingKeysFromFresh(
  manual: { productName: string; niche: string; whoIAm: string },
  parsed: Record<string, unknown> | undefined,
): Array<keyof CoreIdentityValues> {
  const fresh: Record<keyof CoreIdentityValues, string> = {
    productName: (manual.productName.trim() || (parsed?.productName as string) || "").toString(),
    niche: (manual.niche.trim() || (parsed?.niche as string) || "").toString(),
    whoIAm: (manual.whoIAm.trim() || (parsed?.whoIAm as string) || "").toString(),
    whoIServe: ((parsed?.whoIServe as string) || "").toString(),
    howISound: ((parsed?.howISound as string) || "").toString(),
    slangExamples: ((parsed?.slangExamples as string) || "").toString(),
    whatINeverDo: ((parsed?.whatINeverDo as string) || "").toString(),
  }
  return (Object.keys(fresh) as Array<keyof CoreIdentityValues>).filter(
    (k) => !fresh[k].trim(),
  )
}

function buildAudienceIdentityFromResponse(
  parsed: Record<string, unknown> | undefined,
  saved: Record<string, unknown> | undefined,
): AudienceIdentityValues {
  const pickStr = (...vals: unknown[]): string => {
    for (const v of vals) if (typeof v === "string" && v.trim()) return v
    return ""
  }
  return {
    employment: pickStr(parsed?.employment, saved?.employment),
    behavioral: pickStr(parsed?.behavioral, saved?.behavioral),
    awarenessLevel: pickStr(parsed?.awarenessLevel, saved?.awareness_level),
    dailyPains: pickStr(parsed?.dailyPains, saved?.daily_pains),
    emotionalPains: pickStr(parsed?.emotionalPains, saved?.emotional_pains),
    unresolvedConsequences: pickStr(parsed?.unresolvedConsequences, saved?.unresolved_consequences),
    fears: pickStr(parsed?.fears, saved?.fears),
    failedSolutions: pickStr(parsed?.failedSolutions, saved?.failed_solutions),
    limitingBeliefs: pickStr(parsed?.limitingBeliefs, saved?.limiting_beliefs),
    myths: pickStr(parsed?.myths, saved?.myths),
    dailyDesires: pickStr(parsed?.dailyDesires, saved?.daily_desires),
    emotionalDesires: pickStr(parsed?.emotionalDesires, saved?.emotional_desires),
    smallWins: pickStr(parsed?.smallWins, saved?.small_wins),
    idealSolution: pickStr(parsed?.idealSolution, saved?.ideal_solution),
    bottomLine: pickStr(parsed?.bottomLine, saved?.bottom_line),
    crossAudienceQuotes: pickStr(parsed?.crossAudienceQuotes, saved?.cross_audience_quotes),
    idealSolutionWords: pickStr(parsed?.idealSolutionWords, saved?.ideal_solution_words),
    identityStatements: pickStr(parsed?.identityStatements, saved?.identity_statements),
  }
}

function audienceMissingKeysFromFresh(
  parsed: Record<string, unknown> | undefined,
): Array<keyof AudienceIdentityValues> {
  const keys: Array<keyof AudienceIdentityValues> = [
    "employment", "behavioral",
    "awarenessLevel", "dailyPains", "emotionalPains", "unresolvedConsequences",
    "fears", "failedSolutions", "limitingBeliefs", "myths", "dailyDesires",
    "emotionalDesires", "smallWins", "idealSolution", "bottomLine",
    "crossAudienceQuotes", "idealSolutionWords", "identityStatements",
  ]
  return keys.filter((k) => {
    const v = parsed?.[k]
    return typeof v !== "string" || !v.trim()
  })
}

interface UploadingFile {
  id: string
  name: string
  progress: number
  status: "uploading" | "done" | "error"
}

type MediaSection = "fonts" | "elements" | "covers" | "carousels"

// Sub-sections per main tab. Module scope, not component scope, because the
// initial state has to resolve `?sub=...` against it before the first render —
// leaving the fallback to a mount effect is what broke every deep link.
const SUB_SECTIONS: Record<SettingsTab, { id: string; label: string; icon: typeof Type }[]> = {
  connections: [
    { id: "claude", label: "Claude", icon: Link2 },
    { id: "heygen", label: "HeyGen", icon: Link2 },
    { id: "apify", label: "Apify", icon: Link2 },
    { id: "openai", label: "OpenAI", icon: Link2 },
    { id: "gemini", label: "Gemini", icon: Link2 },
    // Appended rather than placed first on purpose: the tab's initial
    // sub-section is whichever entry leads this list, so promoting Instagram
    // would quietly change which panel every existing user lands on.
    { id: "instagram", label: "אינסטגרם", icon: Link2 },
  ],
  business: [
    { id: "about", label: "על העסק", icon: Type },
    { id: "you", label: "עליך", icon: Type },
    { id: "files", label: "קבצים להעלאה", icon: Upload },
    { id: "sources", label: "מקורות ידע", icon: Link2 },
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
  // Optional sub-section deep link via `?sub=...`. The home-page profile-
  // health banner uses this to land the user directly on, say, the
  // "קבצים להעלאה" panel inside the business tab instead of forcing them
  // to find it manually.
  const initialSub = searchParams.get("sub") || ""
  // Resolved once, up front: a `?sub` that names a real section of the opening
  // tab wins, anything else (missing, misspelled, belonging to another tab)
  // falls back to that tab's first section.
  const resolvedSub =
    (SUB_SECTIONS[initialTab] ?? []).find((s) => s.id === initialSub)?.id ??
    SUB_SECTIONS[initialTab]?.[0]?.id ??
    ""
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [activeSubSection, setActiveSubSection] = useState<string>(resolvedSub)
  const [activeMediaSection, setActiveMediaSection] = useState<MediaSection>(
    initialTab === "media" ? (resolvedSub as MediaSection) : "fonts",
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<KeyName | null>(null)
  const [reparsing, setReparsing] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [savingProductIndex, setSavingProductIndex] = useState<number | null>(null)
  const [storedKeys, setStoredKeys] = useState<Record<KeyName, string | null>>({
    anthropic_api_key: null,
    heygen_api_key: null,
    apify_api_key: null,
    openai_api_key: null,
    gemini_api_key: null,
  })
  const [inputValues, setInputValues] = useState<Record<KeyName, string>>({
    anthropic_api_key: "",
    heygen_api_key: "",
    apify_api_key: "",
    openai_api_key: "",
    gemini_api_key: "",
  })
  // A rejected key needs a message that stays on screen next to the field —
  // it tells the user where to go and what to copy, which is more than a
  // 12-second toast can carry. Cleared as soon as she edits the field.
  const [keyErrors, setKeyErrors] = useState<Record<KeyName, string | null>>({
    anthropic_api_key: null,
    heygen_api_key: null,
    apify_api_key: null,
    openai_api_key: null,
    gemini_api_key: null,
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

  // Gap/verify dialog state (replicates onboarding behavior: file-for-file
  // replacement on the backend, popup for filling whatever the new file left
  // empty).
  const [coreGapOpen, setCoreGapOpen] = useState(false)
  const [coreGapValues, setCoreGapValues] = useState<CoreIdentityValues>(EMPTY_CORE_IDENTITY)
  const [coreGapMode, setCoreGapMode] = useState<"gaps" | "verify">("gaps")
  const [coreGapMissingKeys, setCoreGapMissingKeys] = useState<
    Array<keyof CoreIdentityValues> | undefined
  >(undefined)
  const [coreGapSaving, setCoreGapSaving] = useState(false)
  const [audienceGapOpen, setAudienceGapOpen] = useState(false)
  const [audienceGapValues, setAudienceGapValues] =
    useState<AudienceIdentityValues>(EMPTY_AUDIENCE_IDENTITY)
  const [audienceGapMode, setAudienceGapMode] = useState<"gaps" | "verify">("gaps")
  const [audienceGapMissingKeys, setAudienceGapMissingKeys] = useState<
    Array<keyof AudienceIdentityValues> | undefined
  >(undefined)
  const [audienceGapSaving, setAudienceGapSaving] = useState(false)

  // Replace-confirmation state. Triggered when the user clicks "העלה" while
  // an existing file is already in user_media — warns that the upload will
  // wipe whatever the new file doesn't itself supply.
  const [pendingStyleReplace, setPendingStyleReplace] = useState(false)
  const [pendingAudienceReplace, setPendingAudienceReplace] = useState(false)

  // Top creators (user-specified inspiration sources for the ideas pipeline)
  const [topCreators, setTopCreators] = useState<{ id?: string; url: string }[]>([{ url: "" }])
  const [savingCreatorIndex, setSavingCreatorIndex] = useState<number | null>(null)

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
    getCurrentUser(supabase).then(async ({ data: { user } }) => {
      if (!user) return

      // Fire all queries in parallel; await each individually to keep their distinct Supabase types intact.
      const userRowPromise = supabase
        .from("users")
        .select("anthropic_api_key, heygen_api_key, apify_api_key, openai_api_key, gemini_api_key, brand_style")
        .eq("id", user.id)
        .single()
      const coreIdPromise = supabase
        .from("core_identities")
        .select("product_name, niche, who_i_am")
        .eq("user_id", user.id)
        .single()
      const creatorsPromise = supabase
        .from("user_top_creators")
        .select("id, url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
      const productsPromise = supabase
        .from("products")
        .select("id, name, type, landing_page_url, page_summary")
        .eq("user_id", user.id)
      const allMediaPromise = supabase
        .from("user_media")
        .select("id, category, file_name, storage_path, metadata")
        .eq("user_id", user.id)

      const userRowRes = await userRowPromise
      const coreIdRes = await coreIdPromise
      const creatorsRes = await creatorsPromise
      const productsRes = await productsPromise
      const allMediaRes = await allMediaPromise

      if (userRowRes.error) console.error("[settings][users]", userRowRes.error)
      const coreIdErr = coreIdRes.error as { code?: string } | null
      if (coreIdErr && coreIdErr.code !== "PGRST116") console.error("[settings][core_identities]", coreIdErr)
      if (creatorsRes.error) console.error("[settings][user_top_creators]", creatorsRes.error)
      if (productsRes.error) console.error("[settings][products]", productsRes.error)
      if (allMediaRes.error) console.error("[settings][user_media]", allMediaRes.error)

      const row = userRowRes.data as Record<string, unknown> | null
      if (row) {
        setStoredKeys({
          anthropic_api_key: (row.anthropic_api_key as string) ?? null,
          heygen_api_key: (row.heygen_api_key as string) ?? null,
          apify_api_key: (row.apify_api_key as string) ?? null,
          openai_api_key: (row.openai_api_key as string) ?? null,
          gemini_api_key: (row.gemini_api_key as string) ?? null,
        })
        if (row.brand_style) setStyleAnalyzed(true)
      }

      const coreIdData = coreIdRes.data as Record<string, string | null> | null
      if (coreIdData) {
        setBusinessName(coreIdData.product_name ?? "")
        setBusinessNiche(coreIdData.niche ?? "")
        setBusinessExpertise(coreIdData.who_i_am ?? "")
      }

      const creatorRows = creatorsRes.data
      if (creatorRows && creatorRows.length > 0) {
        setTopCreators((creatorRows as { id: string; url: string }[]).map((c) => ({ id: c.id, url: c.url })))
      }

      const prods = productsRes.data
      if (prods) {
        setProducts(prods.map((p: Record<string, unknown>) => {
          const url = (p.landing_page_url as string) || ""
          const summary = (p.page_summary as string) || null
          const noSalesPage = !url && !!summary
          return {
            id: p.id as string,
            name: (p.name as string) || "",
            type: (p.type as "front" | "premium" | "lead_magnet") || "front",
            landingPageUrl: url,
            pageSummary: summary,
            noSalesPage,
            manualSummary: noSalesPage ? (summary ?? "") : "",
          }
        }))
      }

      const mediaRows = allMediaRes.data as { id: string; category: string; file_name: string; storage_path: string; metadata: Record<string, unknown> }[] | null
      if (mediaRows) {
        for (const f of mediaRows.filter((r) => r.category === "style_file" || r.category === "audience_file")) {
          const { data: urlData } = supabase.storage.from("user-media").getPublicUrl(f.storage_path)
          if (f.category === "style_file") {
            setStyleOriginalFile({ name: f.file_name, url: urlData.publicUrl })
          } else {
            setAudienceOriginalFile({ name: f.file_name, url: urlData.publicUrl })
          }
        }

        const toItem = (r: { id: string; file_name: string; storage_path: string; metadata: Record<string, unknown> }): MediaItem => {
          const isGoogle = (r.metadata as { source?: string })?.source === "google"
          return { id: r.id, name: r.file_name, url: isGoogle ? "" : supabase.storage.from("user-media").getPublicUrl(r.storage_path).data.publicUrl }
        }
        setFontItems(mediaRows.filter((r) => r.category === "font").map(toItem))
        setElementItems(mediaRows.filter((r) => r.category === "element").map(toItem))
        setCoverItems(mediaRows.filter((r) => r.category === "cover").map(toItem))
      }

      setLoading(false)
    })
  }, [])

  // --- Connection handlers ---
  const handleConnect = async (keyName: KeyName) => {
    const value = inputValues[keyName].trim()
    if (!value) return
    setSaving(keyName)
    setKeyErrors((prev) => ({ ...prev, [keyName]: null }))
    try {
      // Validate format + live against the provider before persisting.
      // Catches: keys pasted into wrong field, typos, expired keys, 0 credits.
      const validation = await fetch("/api/validate-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName, value }),
      }).then((r) => r.json()).catch(() => ({ ok: false, code: "network", message: "תקלת רשת" }))

      if (!validation.ok) {
        setKeyErrors((prev) => ({ ...prev, [keyName]: validation.message ?? "המפתח לא עבר ולידציה" }))
        return
      }

      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (!user) return
      const { error } = await supabase.from("users").update({ [keyName]: value } as never).eq("id", user.id)
      if (error) {
        toast.error(`שגיאה בשמירת המפתח: ${error.message}`, { duration: 10000 })
        return
      }
      setStoredKeys((prev) => ({ ...prev, [keyName]: value }))
      setInputValues((prev) => ({ ...prev, [keyName]: "" }))
      toast.success("המפתח אומת ונשמר בהצלחה")
    } finally {
      setSaving(null)
    }

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
    const { data: { user } } = await getCurrentUser(supabase)
    if (!user) return
    await supabase.from("users").update({ [keyName]: null } as never).eq("id", user.id)
    setStoredKeys((prev) => ({ ...prev, [keyName]: null }))
    setSaving(null)
  }

  // --- Product handlers ---
  const handleSaveProduct = async (index: number) => {
    const p = products[index]
    if (!p || !p.name.trim()) return
    setSavingProductIndex(index)
    try {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (!user) return
      const id = p.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "")
      const payload = {
        id,
        user_id: user.id,
        name: p.name,
        type: p.type,
        landing_page_url: p.noSalesPage ? null : (p.landingPageUrl || null),
        page_summary: p.noSalesPage ? (p.manualSummary?.trim() || null) : null,
      }
      const { error } = await supabase.from("products").upsert(payload as never, { onConflict: "id" })
      if (error) {
        toast.error(`שגיאה בשמירת המוצר: ${error.message}`)
        return
      }
      // Sync the canonical id back into local state so subsequent saves update the same row.
      setProducts((prev) => prev.map((pr, i) => i === index ? { ...pr, id } : pr))
      if (!p.noSalesPage && p.landingPageUrl) {
        fetch("/api/parse-product-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: p.landingPageUrl, productId: id }),
        }).catch(() => {})
      }
      toast.success("המוצר נשמר")
    } finally {
      setSavingProductIndex(null)
    }
  }

  const handleRemoveProduct = async (index: number) => {
    const p = products[index]
    if (!p) return
    if (p.id) {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (user) {
        await supabase.from("products").delete().eq("id", p.id).eq("user_id", user.id)
      }
    }
    setProducts((prev) => prev.filter((_, i) => i !== index))
  }

  // --- Media upload helpers ---
  const uploadMediaFile = useCallback(async (file: File, category: "font" | "element" | "cover", metadata: Record<string, unknown> = {}) => {
    const supabase = createClient()
    const { data: { user } } = await getCurrentUser(supabase)
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
      } catch (err) { console.error("[settings][analyze-covers]", err) }
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
    const { data: { user } } = await getCurrentUser(supabase)
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
      const { data: { user } } = await getCurrentUser(supabase)
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

  const handleSaveCreator = async (index: number) => {
    const c = topCreators[index]
    if (!c || !c.url.trim()) return
    const parsed = parseCreatorInput(c.url)
    if (!parsed) {
      toast.error("הקישור לא תקין")
      return
    }
    setSavingCreatorIndex(index)
    try {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (!user) return
      const id = c.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "")
      const payload = {
        id,
        user_id: user.id,
        url: parsed.url,
        handle: parsed.handle,
        platform: parsed.platform,
      }
      const { error } = await supabase
        .from("user_top_creators")
        .upsert(payload as never, { onConflict: "id" })
      if (error) {
        toast.error(`שגיאה בשמירה: ${error.message}`)
        return
      }
      setTopCreators((prev) => prev.map((cr, i) => i === index ? { ...cr, id, url: parsed.url } : cr))
      toast.success("היוצר נשמר")
    } finally {
      setSavingCreatorIndex(null)
    }
  }

  const handleRemoveCreator = async (index: number) => {
    const c = topCreators[index]
    if (!c) return
    if (c.id) {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (user) {
        await supabase.from("user_top_creators").delete().eq("id", c.id).eq("user_id", user.id)
      }
    }
    setTopCreators((prev) => prev.filter((_, i) => i !== index))
  }

  const refreshIdentityFile = async (category: "style_file" | "audience_file") => {
    const supabase = createClient()
    const { data: { user } } = await getCurrentUser(supabase)
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

  const handleRemoveIdentityFile = (category: "style_file" | "audience_file") => {
    // Optimistic update — clear UI immediately, delete in background
    if (category === "style_file") {
      setStyleOriginalFile(null)
      setStyleFileToUpload(null)
    } else {
      setAudienceOriginalFile(null)
      setAudienceFileToUpload(null)
    }
    toast.success("הקובץ נמחק")

    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await getCurrentUser(supabase)
      if (!user) return

      const { data } = await supabase
        .from("user_media")
        .select("id, storage_path")
        .eq("user_id", user.id)
        .eq("category", category)
        .maybeSingle()

      if (data) {
        const row = data as { id: string; storage_path: string }
        await supabase.storage.from("user-media").remove([row.storage_path])
        await supabase.from("user_media").delete().eq("id", row.id)
      }
    })()
  }

  // Intercept the click: if a file already exists, ask before wiping. The
  // backend now always replaces file-for-file, so we owe the user a warning.
  const handleUploadStyleClick = () => {
    if (!styleFileToUpload) return
    if (styleOriginalFile) {
      setPendingStyleReplace(true)
      return
    }
    void runStyleUpload()
  }

  const runStyleUpload = async () => {
    if (!styleFileToUpload) return
    const file = styleFileToUpload
    const validation = validateIdentityFile(file)
    if (validation) {
      toast.error(validation.message, { duration: 10000 })
      return
    }
    setUploadingStyle(true)
    toast("מעלה ומנתח את הקובץ — זה יכול לקחת עד דקה")
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", "core")
      formData.append("manualFields", JSON.stringify({
        productName: businessName,
        niche: businessNiche,
        whoIAm: businessExpertise,
      }))
      let res: Response
      try {
        res = await fetch("/api/parse-identity", { method: "POST", body: formData })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(
          `החיבור נקטע באמצע ההעלאה (${msg}). בדקו את החיבור לאינטרנט ונסו שוב.`,
          { duration: 12000 }
        )
        return
      }
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = resData.message || resData.error || `שגיאת שרת ${res.status}`
        toast.error(detail, { duration: 12000 })
        if (resData.fileSaveError) {
          toast.error(`בנוסף — הקובץ לא נשמר: ${resData.fileSaveError}`, { duration: 12000 })
        }
        return
      }
      if (resData.fileSaveError) {
        toast.error(`הקובץ לא נשמר במלואו: ${resData.fileSaveError}`, { duration: 12000 })
      }
      if (resData.notice) {
        toast(resData.notice, { duration: 15000 })
      }
      setStyleOriginalFile((prev) => ({ name: file.name, url: prev?.url ?? "" }))
      setStyleFileToUpload(null)
      await refreshIdentityFile("style_file")

      // Decide what comes next: verify popup (classifier flagged the file),
      // gap popup (some required fields empty), or just a success toast.
      const identity = buildCoreIdentityFromResponse(
        { productName: businessName, niche: businessNiche, whoIAm: businessExpertise },
        resData.parsed,
        resData.saved,
      )
      const missing = coreMissingKeysFromFresh(
        { productName: businessName, niche: businessNiche, whoIAm: businessExpertise },
        resData.parsed,
      )
      if (resData.classificationWarning) {
        setCoreGapMode("verify")
        setCoreGapMissingKeys(undefined)
        setCoreGapValues(identity)
        setCoreGapOpen(true)
      } else if (missing.length > 0) {
        setCoreGapMode("gaps")
        setCoreGapMissingKeys(missing)
        setCoreGapValues(identity)
        setCoreGapOpen(true)
      } else if (resData.warning) {
        toast.error(resData.warning, { duration: 12000 })
      } else if (!resData.fileSaveError && !resData.notice) {
        toast.success("הקובץ עלה ונותח בהצלחה")
      }
    } finally {
      setUploadingStyle(false)
    }
  }

  // Bridge for the legacy onClick reference. Kept so the JSX below doesn't
  // need a rename — the click handler now routes through the confirm.
  const handleUploadStyle = handleUploadStyleClick

  const handleUploadAudienceClick = () => {
    if (!audienceFileToUpload) return
    if (audienceOriginalFile) {
      setPendingAudienceReplace(true)
      return
    }
    void runAudienceUpload()
  }

  const runAudienceUpload = async () => {
    if (!audienceFileToUpload) return
    const file = audienceFileToUpload
    const validation = validateIdentityFile(file)
    if (validation) {
      toast.error(validation.message, { duration: 10000 })
      return
    }
    setUploadingAudience(true)
    toast("מעלה ומנתח את הקובץ — זה יכול לקחת עד דקה")
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("type", "audience")
      let res: Response
      try {
        res = await fetch("/api/parse-identity", { method: "POST", body: formData })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(
          `החיבור נקטע באמצע ההעלאה (${msg}). בדקו את החיבור לאינטרנט ונסו שוב.`,
          { duration: 12000 }
        )
        return
      }
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = resData.message || resData.error || `שגיאת שרת ${res.status}`
        toast.error(detail, { duration: 12000 })
        if (resData.fileSaveError) {
          toast.error(`בנוסף — הקובץ לא נשמר: ${resData.fileSaveError}`, { duration: 12000 })
        }
        return
      }
      if (resData.fileSaveError) {
        toast.error(`הקובץ לא נשמר במלואו: ${resData.fileSaveError}`, { duration: 12000 })
      }
      if (resData.notice) {
        toast(resData.notice, { duration: 15000 })
      }
      setAudienceOriginalFile((prev) => ({ name: file.name, url: prev?.url ?? "" }))
      setAudienceFileToUpload(null)
      await refreshIdentityFile("audience_file")

      const identity = buildAudienceIdentityFromResponse(resData.parsed, resData.saved)
      const missing = audienceMissingKeysFromFresh(resData.parsed)
      if (resData.classificationWarning) {
        setAudienceGapMode("verify")
        setAudienceGapMissingKeys(undefined)
        setAudienceGapValues(identity)
        setAudienceGapOpen(true)
      } else if (missing.length > 0) {
        setAudienceGapMode("gaps")
        setAudienceGapMissingKeys(missing)
        setAudienceGapValues(identity)
        setAudienceGapOpen(true)
      } else if (resData.warning) {
        toast.error(resData.warning, { duration: 12000 })
      } else if (!resData.fileSaveError && !resData.notice) {
        toast.success("הקובץ עלה ונותח בהצלחה")
      }
    } finally {
      setUploadingAudience(false)
    }
  }

  const handleUploadAudience = handleUploadAudienceClick

  // Popup save = POST current values to the identity API. Closes on success.
  const handleCoreGapSave = async (next: CoreIdentityValues) => {
    setCoreGapSaving(true)
    try {
      const res = await fetch("/api/core-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(`שמירת הפרטים החסרים נכשלה: ${data.error || res.status}`, { duration: 12000 })
        return
      }
      setCoreGapOpen(false)
      toast.success("השדות נשמרו")
    } finally {
      setCoreGapSaving(false)
    }
  }

  // Popup close (X / cancel / outside click) — persist whatever was typed so
  // progress isn't lost between sessions.
  const handleCoreGapClose = (current: CoreIdentityValues) => {
    setCoreGapOpen(false)
    void fetch("/api/core-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    }).catch((err) => console.warn("[settings] core gap close-save failed:", err))
  }

  const handleAudienceGapSave = async (next: AudienceIdentityValues) => {
    setAudienceGapSaving(true)
    try {
      const res = await fetch("/api/audience-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(`שמירת פרטי הקהל החסרים נכשלה: ${data.error || res.status}`, { duration: 12000 })
        return
      }
      setAudienceGapOpen(false)
      toast.success("השדות נשמרו")
    } finally {
      setAudienceGapSaving(false)
    }
  }

  const handleAudienceGapClose = (current: AudienceIdentityValues) => {
    setAudienceGapOpen(false)
    void fetch("/api/audience-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    }).catch((err) => console.warn("[settings] audience gap close-save failed:", err))
  }

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "connections", label: "חיבורים" },
    { id: "business", label: "מידע על העסק" },
    { id: "products", label: "מוצרים" },
    { id: "creators", label: "יוצרים מובילים" },
    { id: "media", label: "מדיה" },
  ]

  // Reset the sub-section when the tab ACTUALLY changes — never on mount.
  //
  // This effect also fires on mount, where it used to overwrite `?sub=...`
  // with the tab's first sub-section before the user saw anything, so every
  // deep link landed on the wrong panel: ?sub=openai opened Claude, the home
  // banner's ?sub=files opened "על העסק".
  //
  // It's gated on "did the tab change since last run" rather than a
  // fired-once flag, because Strict Mode runs mount effects TWICE — a
  // once-flag is spent by the first pass and the second pass resets anyway.
  // Comparing the previous tab is idempotent, so re-running changes nothing.
  const prevTabRef = useRef(activeTab)
  useEffect(() => {
    if (prevTabRef.current === activeTab) return
    prevTabRef.current = activeTab

    const subs = SUB_SECTIONS[activeTab]
    if (!subs || subs.length === 0) return

    setActiveSubSection(subs[0].id)
    if (activeTab === "media") setActiveMediaSection(subs[0].id as MediaSection)
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
      {/* Identity gap/verify dialogs + replace confirmations — surface here
          (above the tabs) so they cover the whole settings view regardless
          of which tab is active when the parse returns. */}
      <CoreIdentityGapDialog
        open={coreGapOpen}
        initialValues={coreGapValues}
        saving={coreGapSaving}
        mode={coreGapMode}
        missingKeys={coreGapMissingKeys}
        onCancel={handleCoreGapClose}
        onSave={handleCoreGapSave}
      />
      <AudienceIdentityGapDialog
        open={audienceGapOpen}
        initialValues={audienceGapValues}
        saving={audienceGapSaving}
        mode={audienceGapMode}
        missingKeys={audienceGapMissingKeys}
        onCancel={handleAudienceGapClose}
        onSave={handleAudienceGapSave}
      />
      <ConfirmModal
        open={pendingStyleReplace}
        onOpenChange={(next) => {
          if (!next) setPendingStyleReplace(false)
        }}
        title="להחליף את קובץ סגנון הכתיבה?"
        description="הקובץ החדש יחליף לגמרי את הקיים. כל שדה שהקובץ החדש לא יכיל יישמר ריק (ניתן להשלים אותו בפופ-אפ שיופיע מיד אחרי הניתוח)."
        confirmLabel="כן, החלף קובץ"
        cancelLabel="ביטול"
        confirmVariant="destructive"
        onConfirm={async () => {
          setPendingStyleReplace(false)
          await runStyleUpload()
        }}
      />
      <ConfirmModal
        open={pendingAudienceReplace}
        onOpenChange={(next) => {
          if (!next) setPendingAudienceReplace(false)
        }}
        title="להחליף את קובץ ניתוח הקהל?"
        description="הקובץ החדש יחליף לגמרי את הקיים. כל שדה שהקובץ החדש לא יכיל יישמר ריק (ניתן להשלים אותו בפופ-אפ שיופיע מיד אחרי הניתוח)."
        confirmLabel="כן, החלף קובץ"
        cancelLabel="ביטול"
        confirmVariant="destructive"
        onConfirm={async () => {
          setPendingAudienceReplace(false)
          await runAudienceUpload()
        }}
      />

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
                  {/* Instagram is an OAuth connection, not a pasted key, so it
                      owns its whole panel instead of joining the KEYS list. */}
                  {activeSubSection === "instagram" && <InstagramConnect />}
                  {KEYS.filter((cfg) => {
                    if (activeSubSection === "claude") return cfg.key === "anthropic_api_key"
                    if (activeSubSection === "heygen") return cfg.key === "heygen_api_key"
                    if (activeSubSection === "apify") return cfg.key === "apify_api_key"
                    if (activeSubSection === "openai") return cfg.key === "openai_api_key"
                    if (activeSubSection === "gemini") return cfg.key === "gemini_api_key"
                    return false
                  }).map((cfg) => {
                    const stored = storedKeys[cfg.key]
                    const isSaving = saving === cfg.key
                    const error = keyErrors[cfg.key]
                    const errorId = `${cfg.key}-error`
                    const showLegacyGeminiWarning = cfg.key === "gemini_api_key" && isLegacyGeminiKey(stored)
                    return (
                      <div key={cfg.key} className="flex flex-col gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
                        <div className="flex items-center justify-between">
                          <span className="text-p-bold text-text-primary-default">{cfg.label}</span>
                          {stored && <span className="text-xs-body text-text-neutral-default font-mono">{maskKey(stored)}</span>}
                        </div>
                        {stored ? (
                          <div className="flex flex-col gap-3">
                            <Button size="sm" variant="outline" onClick={() => handleDisconnect(cfg.key)} disabled={isSaving} className="w-fit gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95">
                              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                              {isSaving ? "מנתק..." : "נתק"}
                            </Button>
                            {/* Google retires the legacy "AIza" key format in
                                September 2026. Warn now, while she can
                                replace it calmly, instead of letting hook
                                generation die mid-flow later. */}
                            {showLegacyGeminiWarning && (
                              <div className="flex items-start gap-2 rounded-xl border border-yellow-80 bg-bg-surface-primary-default px-3 py-2.5 dark:border-yellow-30">
                                <AlertTriangle className="size-4 shrink-0 mt-0.5 text-yellow-30 dark:text-yellow-80" aria-hidden="true" />
                                <p className="text-xs-body text-text-primary-default leading-relaxed">
                                  המפתח המחובר הוא מהסוג הישן של Google (מתחיל ב-<bdi>AIza</bdi>), שיפסיק לעבוד בספטמבר 2026.
                                  היכנסו ל-{" "}
                                  <a href={cfg.helpUrl} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{cfg.helpLabel}</a>
                                  , צרו מפתח חדש (מתחיל ב-<bdi>AQ.</bdi>) והחליפו אותו כאן.
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <Input
                                dir="ltr"
                                placeholder={cfg.placeholder}
                                value={inputValues[cfg.key]}
                                onChange={(e) => {
                                  const next = e.target.value
                                  setInputValues((prev) => ({ ...prev, [cfg.key]: next }))
                                  setKeyErrors((prev) => (prev[cfg.key] ? { ...prev, [cfg.key]: null } : prev))
                                }}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={error ? errorId : undefined}
                                className="flex-1"
                              />
                              <Button size="sm" onClick={() => handleConnect(cfg.key)} disabled={!inputValues[cfg.key].trim() || isSaving} className="gap-2">
                                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                                {isSaving ? "מתחבר..." : "חבר"}
                              </Button>
                            </div>
                            {error && (
                              <div id={errorId} role="alert" className="flex items-start gap-2 rounded-xl border border-red-90 bg-red-95 px-3 py-2.5 dark:border-red-90/25 dark:bg-red-95/10">
                                <AlertCircle className="size-4 shrink-0 mt-0.5 text-button-danger-default" aria-hidden="true" />
                                <p className="text-xs-body text-text-primary-default leading-relaxed">{error}</p>
                              </div>
                            )}
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
                    <div className="flex items-center gap-1 w-fit rounded-lg bg-bg-surface ps-3 pe-1 py-1 text-small text-text-primary-default">
                      <a
                        href={styleOriginalFile.url}
                        download={styleOriginalFile.name}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Download className="size-3.5 text-text-neutral-default" />
                        {styleOriginalFile.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleRemoveIdentityFile("style_file")}
                        className="p-1 rounded hover:bg-bg-surface-hover transition-colors"
                        aria-label="הסר קובץ"
                      >
                        <X className="size-3.5 text-text-neutral-default hover:text-button-destructive-default" />
                      </button>
                    </div>
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
                      placeholder={styleOriginalFile && !styleFileToUpload ? "החלפת קובץ" : "העלה קובץ סגנון כתיבה"}
                      value={styleFileToUpload?.name ?? ""}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={styleFileRef}
                      type="file"
                      className="hidden"
                      accept=".docx,.md,text/markdown"
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
                    {" · "}
                    ניתן להעלות קבצי doc, docx, md
                  </p>
                  <Button
                    size="sm"
                    onClick={handleUploadStyle}
                    disabled={!styleFileToUpload || uploadingStyle}
                    className="w-fit gap-2"
                  >
                    {uploadingStyle && <Loader2 className="size-4 animate-spin" />}
                    {uploadingStyle ? "שומר ומנתח..." : "שמור ונתח"}
                  </Button>
                </div>

                {/* Audience file */}
                <div className="flex flex-col gap-2">
                  <label className="text-small-bold text-text-primary-default">ניתוח קהל יעד</label>
                  {audienceOriginalFile && !audienceFileToUpload && (
                    <div className="flex items-center gap-1 w-fit rounded-lg bg-bg-surface ps-3 pe-1 py-1 text-small text-text-primary-default">
                      <a
                        href={audienceOriginalFile.url}
                        download={audienceOriginalFile.name}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Download className="size-3.5 text-text-neutral-default" />
                        {audienceOriginalFile.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleRemoveIdentityFile("audience_file")}
                        className="p-1 rounded hover:bg-bg-surface-hover transition-colors"
                        aria-label="הסר קובץ"
                      >
                        <X className="size-3.5 text-text-neutral-default hover:text-button-destructive-default" />
                      </button>
                    </div>
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
                      placeholder={audienceOriginalFile && !audienceFileToUpload ? "החלפת קובץ" : "העלה קובץ ניתוח קהל יעד"}
                      value={audienceFileToUpload?.name ?? ""}
                      readOnly
                      className="cursor-pointer pe-10 pointer-events-none"
                    />
                    <Upload className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                    <input
                      ref={audienceFileRef}
                      type="file"
                      className="hidden"
                      accept=".docx,.md,text/markdown"
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
                    {" · "}
                    ניתן להעלות קבצי doc, docx, md
                  </p>
                  <p className="text-xs-body text-text-primary-default text-start font-semibold">
                    שימו לב — בשלב הזה תומכים בקהל יעד אחד לכל קובץ. אם בקובץ יש כמה קהלים, יישמר רק הראשון.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleUploadAudience}
                    disabled={!audienceFileToUpload || uploadingAudience}
                    className="w-fit gap-2"
                  >
                    {uploadingAudience && <Loader2 className="size-4 animate-spin" />}
                    {uploadingAudience ? "שומר ומנתח..." : "שמור ונתח"}
                  </Button>
                </div>

                  </>
                )}

                {activeSubSection === "sources" && <BusinessSourcesPanel />}

                {/* Save button for about/you sub-sections */}
                {activeSubSection !== "files" && activeSubSection !== "sources" && (
                  <Button size="sm" onClick={handleSaveBusiness} disabled={savingBusiness} className="w-fit gap-2">
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
                <ProductsList
                  products={products}
                  onChange={setProducts}
                  onSaveProduct={handleSaveProduct}
                  onRemoveProduct={handleRemoveProduct}
                  savingIndex={savingProductIndex}
                />
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
                    onSaveCreator={handleSaveCreator}
                    onRemoveCreator={handleRemoveCreator}
                    savingIndex={savingCreatorIndex}
                  />
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
                          size="sm"
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
                            } catch (err) { console.error("[settings][reanalyze-covers]", err) }
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
