"use client"

import { Suspense, useState, useRef, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Paperclip, Loader2, Link2 } from "lucide-react"
import logoNew from "../../../images/logo-new.png"
import onboardingHero from "../../../images/art-onboarding.png"
import { createClient } from "@/lib/supabase/client"
import { parseCreatorInput, validateCreatorInput } from "@/lib/creator-url"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { CreatorsList } from "@/components/creators-list"
import { ProductsList, type ProductEntry } from "@/components/products-list"
import {
  EMPTY_CORE_IDENTITY,
  isCoreIdentityComplete,
  type CoreIdentityValues,
} from "@/components/core-identity-form"
import {
  EMPTY_AUDIENCE_IDENTITY,
  isAudienceIdentityComplete,
  type AudienceIdentityValues,
} from "@/components/audience-identity-form"
import {
  CoreIdentityGapDialog,
  AudienceIdentityGapDialog,
} from "@/components/identity-gap-dialog"
import { ConfirmModal } from "@/components/confirm-modal"
import { toast } from "sonner"
import { validateIdentityFile } from "@/lib/validate-identity-file"

const STEPS = [
  { id: "connections", label: "חיבור חשבונות" },
  { id: "business", label: "העסק שלכם" },
  { id: "audience", label: "קהל היעד" },
  { id: "creators", label: "יוצרים מובילים" },
  { id: "products", label: "המוצרים שלכם" },
]

// Backend returns the saved snake_case row alongside the camelCase parsed
// object. Stitch both into a CoreIdentityValues so the gap dialog can decide
// which fields are still empty.
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

// Which fields did the FRESH upload (this session's manual + parsed) leave
// empty? Stale DB values don't count — if the user uploads a new file, gaps
// in that file should surface for confirmation even if the old DB row covers
// them. The popup will still prefill from `saved` via initialValues, so the
// user can keep, edit, or replace.
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

// Audience equivalent of coreMissingKeysFromFresh — keys empty in `parsed`
// only, ignoring any pre-existing DB row.
function audienceMissingKeysFromFresh(
  parsed: Record<string, unknown> | undefined,
): Array<keyof AudienceIdentityValues> {
  const keys: Array<keyof AudienceIdentityValues> = [
    "employment",
    "behavioral",
    "awarenessLevel",
    "dailyPains",
    "emotionalPains",
    "unresolvedConsequences",
    "fears",
    "failedSolutions",
    "limitingBeliefs",
    "myths",
    "dailyDesires",
    "emotionalDesires",
    "smallWins",
    "idealSolution",
    "bottomLine",
    "crossAudienceQuotes",
    "idealSolutionWords",
    "identityStatements",
  ]
  return keys.filter((k) => {
    const v = parsed?.[k]
    return typeof v !== "string" || !v.trim()
  })
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
    unresolvedConsequences: pickStr(
      parsed?.unresolvedConsequences,
      saved?.unresolved_consequences,
    ),
    fears: pickStr(parsed?.fears, saved?.fears),
    failedSolutions: pickStr(parsed?.failedSolutions, saved?.failed_solutions),
    limitingBeliefs: pickStr(parsed?.limitingBeliefs, saved?.limiting_beliefs),
    myths: pickStr(parsed?.myths, saved?.myths),
    dailyDesires: pickStr(parsed?.dailyDesires, saved?.daily_desires),
    emotionalDesires: pickStr(parsed?.emotionalDesires, saved?.emotional_desires),
    smallWins: pickStr(parsed?.smallWins, saved?.small_wins),
    idealSolution: pickStr(parsed?.idealSolution, saved?.ideal_solution),
    bottomLine: pickStr(parsed?.bottomLine, saved?.bottom_line),
    crossAudienceQuotes: pickStr(
      parsed?.crossAudienceQuotes,
      saved?.cross_audience_quotes,
    ),
    idealSolutionWords: pickStr(parsed?.idealSolutionWords, saved?.ideal_solution_words),
    identityStatements: pickStr(parsed?.identityStatements, saved?.identity_statements),
  }
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  )
}

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Dev navigator — visible only when running locally OR when the URL has
  // `?dev=1`. Lets the designer jump between steps without satisfying each
  // step's validation. Production users never see this.
  const devMode =
    process.env.NODE_ENV === "development" || searchParams.get("dev") === "1"

  // ?step=N teleports the user to a specific step. Honored only in devMode —
  // in production it was an unintended escape route: real users could land at
  // /onboarding?step=4 and skip past identity collection entirely.
  const stepParam = devMode ? searchParams.get("step") : null
  const initialStep = stepParam
    ? Math.max(0, Math.min(STEPS.length - 1, parseInt(stepParam, 10) || 0))
    : 0
  const [currentStep, setCurrentStep] = useState(initialStep)

  // Smart-resume state. The boot effect below fetches what the user already
  // saved in earlier sessions and lands them on the first incomplete step,
  // pre-filling fields they've filled before. Without this, a user with a
  // partial profile (e.g. missing only audience identity) gets bounced here
  // by the middleware and has to retype their API keys + business identity
  // before they can even reach the step that's actually missing.
  const [bootChecked, setBootChecked] = useState(false)
  const stepsDoneAtMount = useRef<Set<number>>(new Set())

  // Step 1 - Connections
  const [anthropicKey, setAnthropicKey] = useState("")
  const [heygenKey, setHeygenKey] = useState("")
  const [apifyKey, setApifyKey] = useState("")

  // Step 2 - Business
  const [businessName, setBusinessName] = useState("")
  const [niche, setNiche] = useState("")
  const [expertise, setExpertise] = useState("")
  const [styleFile, setStyleFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 3 - Audience
  const [audienceFile, setAudienceFile] = useState<File | null>(null)
  const audienceFileRef = useRef<HTMLInputElement>(null)

  // Step 4 - Top creators (user-specified inspiration sources).
  const [creatorsList, setCreatorsList] = useState<{ url: string }[]>([{ url: "" }])

  // Step 5 - Products
  const [productsList, setProductsList] = useState<ProductEntry[]>([])

  const [saving, setSaving] = useState(false)

  // Gap-fill dialog state. After parse-identity succeeds, if any required
  // field is still empty, open the matching dialog with prefill so the user
  // completes the gaps before we advance.
  const [coreGapOpen, setCoreGapOpen] = useState(false)
  const [coreGapValues, setCoreGapValues] =
    useState<CoreIdentityValues>(EMPTY_CORE_IDENTITY)
  const [coreGapSaving, setCoreGapSaving] = useState(false)
  const [coreGapMode, setCoreGapMode] = useState<"gaps" | "verify">("gaps")
  const [coreGapMissingKeys, setCoreGapMissingKeys] = useState<
    Array<keyof CoreIdentityValues> | undefined
  >(undefined)
  const [audienceGapOpen, setAudienceGapOpen] = useState(false)
  const [audienceGapValues, setAudienceGapValues] =
    useState<AudienceIdentityValues>(EMPTY_AUDIENCE_IDENTITY)
  const [audienceGapSaving, setAudienceGapSaving] = useState(false)
  const [audienceGapMode, setAudienceGapMode] = useState<"gaps" | "verify">("gaps")
  const [audienceGapMissingKeys, setAudienceGapMissingKeys] = useState<
    Array<keyof AudienceIdentityValues> | undefined
  >(undefined)
  // When true, the popup's save button just closes the dialog without
  // touching the DB or advancing — used by the dev preview buttons.
  const [gapPreviewMode, setGapPreviewMode] = useState(false)

  // Track whether parse-identity already ran successfully for the current step.
  // A second file selection while this is true triggers the replace confirmation
  // so users don't accidentally mix two files' worth of partial data.
  const [styleParseDone, setStyleParseDone] = useState(false)
  const [audienceParseDone, setAudienceParseDone] = useState(false)
  // Pending file replacement waits in this state until the user confirms.
  const [pendingStyleFile, setPendingStyleFile] = useState<File | null>(null)
  const [pendingAudienceFile, setPendingAudienceFile] = useState<File | null>(null)

  // Smart-resume boot. Fires once on mount; reads everything the user has
  // already saved, pre-fills the form, marks completed steps so handleNext
  // can skip them, and lands the user on the first incomplete step.
  useEffect(() => {
    let cancelled = false
    let redirecting = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) setBootChecked(true)
          return
        }

        const [usersRes, coreRes, audRes, creatorsRes, productsRes] =
          await Promise.all([
            supabase
              .from("users")
              .select("anthropic_api_key, apify_api_key, heygen_api_key")
              .eq("id", user.id)
              .maybeSingle<{
                anthropic_api_key: string | null
                apify_api_key: string | null
                heygen_api_key: string | null
              }>(),
            supabase
              .from("core_identities")
              .select("product_name, niche, who_i_am, how_i_sound")
              .eq("user_id", user.id)
              .maybeSingle<{
                product_name: string | null
                niche: string | null
                who_i_am: string | null
                how_i_sound: string | null
              }>(),
            supabase
              .from("audience_identities")
              .select(
                "daily_pains, emotional_pains, fears, daily_desires, emotional_desires"
              )
              .eq("user_id", user.id)
              .maybeSingle<{
                daily_pains: string | null
                emotional_pains: string | null
                fears: string | null
                daily_desires: string | null
                emotional_desires: string | null
              }>(),
            supabase
              .from("user_top_creators")
              .select("id")
              .eq("user_id", user.id)
              .limit(1),
            supabase
              .from("products")
              .select("id")
              .eq("user_id", user.id)
              .limit(1),
          ])

        if (cancelled) return

        const hasText = (v: unknown) =>
          typeof v === "string" && v.trim().length > 0

        // Pre-fill the visible form fields. Users will never see these inputs
        // if their step is already complete (we skip them), but keeping the
        // form state in sync with the DB is the safe default — if anything
        // does fall through, the user sees their data instead of blanks.
        const usersRow = usersRes.data
        if (usersRow?.anthropic_api_key) setAnthropicKey(usersRow.anthropic_api_key)
        if (usersRow?.apify_api_key) setApifyKey(usersRow.apify_api_key)
        if (usersRow?.heygen_api_key) setHeygenKey(usersRow.heygen_api_key)

        const coreRow = coreRes.data
        if (coreRow?.product_name) setBusinessName(coreRow.product_name)
        if (coreRow?.niche) setNiche(coreRow.niche)
        if (coreRow?.who_i_am) setExpertise(coreRow.who_i_am)

        // Step completeness — same rules the middleware and
        // /api/onboarding/complete use, so all three agree on "done".
        const step0Done =
          hasText(usersRow?.anthropic_api_key) && hasText(usersRow?.apify_api_key)
        const step1Done =
          !!coreRow &&
          [coreRow.who_i_am, coreRow.niche, coreRow.how_i_sound].every(hasText)
        const audRow = audRes.data
        const step2Done =
          !!audRow &&
          [
            audRow.daily_pains,
            audRow.emotional_pains,
            audRow.fears,
            audRow.daily_desires,
            audRow.emotional_desires,
          ].every(hasText)
        const step3Done = (creatorsRes.data?.length ?? 0) > 0
        const step4Done = (productsRes.data?.length ?? 0) > 0

        const doneFlags = [step0Done, step1Done, step2Done, step3Done, step4Done]
        doneFlags.forEach((done, i) => {
          if (done) stepsDoneAtMount.current.add(i)
        })

        // Find first incomplete step. If everything is already done the user
        // shouldn't be on /onboarding at all — try to finalize and bounce.
        const firstIncomplete = doneFlags.findIndex((d) => !d)
        if (firstIncomplete === -1) {
          const res = await fetch("/api/onboarding/complete", { method: "POST" })
          if (res.ok) {
            redirecting = true
            router.replace("/welcome")
            return
          }
          // Server still considers them incomplete (rare drift). Fall through
          // to the original step 0 so they have somewhere to act.
          setCurrentStep(0)
        } else if (devMode && stepParam) {
          // Dev override takes priority — same behavior as today.
          setCurrentStep(initialStep)
        } else {
          setCurrentStep(firstIncomplete)
        }
      } catch (err) {
        console.error("[onboarding] boot fetch failed:", err)
      } finally {
        if (!cancelled && !redirecting) setBootChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // Mount-only — running this once is the point; later state changes are
    // handled by the step handlers themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Find the next step the user actually needs to do, skipping ones that were
  // already complete at mount. Returns -1 when nothing's left.
  const findNextStep = (from: number): number => {
    for (let i = from + 1; i < STEPS.length; i++) {
      if (!stepsDoneAtMount.current.has(i)) return i
    }
    return -1
  }

  // Snake_case DB column names returned by /api/onboarding/complete's
  // `missing[]` mapped to the camelCase TS keys the gap dialogs expect.
  // Keep in sync with the server's validation set in
  // /api/onboarding/complete/route.ts.
  const CORE_MISSING_MAP: Record<string, keyof CoreIdentityValues> = {
    who_i_am: "whoIAm",
    niche: "niche",
    how_i_sound: "howISound",
  }
  const AUDIENCE_MISSING_MAP: Record<string, keyof AudienceIdentityValues> = {
    daily_pains: "dailyPains",
    emotional_pains: "emotionalPains",
    fears: "fears",
    daily_desires: "dailyDesires",
    emotional_desires: "emotionalDesires",
  }

  // Centralized "what's next" decision after a step handler finishes. If the
  // next step is in stepsDoneAtMount we skip past it; if nothing's left we
  // try the server-validated completion endpoint instead of setCurrentStep.
  // When the server reports a 400 `incomplete` with a `missing[]` list, we
  // open the right gap dialog in place rather than just toasting — the user
  // already finished step 5 (products), there's nothing left to "go back to."
  const advanceFromStep = async (current: number): Promise<void> => {
    const next = findNextStep(current)
    if (next !== -1) {
      setCurrentStep(next)
      return
    }
    const res = await fetch("/api/onboarding/complete", { method: "POST" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      // Server reported missing critical fields. Open the appropriate gap
      // dialog (core first if any core fields are missing, otherwise
      // audience) prefilled with whatever's currently saved, so the user
      // fixes in-place. The toast falls back to a generic message for any
      // other 4xx/5xx (network, RLS, etc.).
      if (
        data?.error === "incomplete" &&
        Array.isArray(data.missing) &&
        data.missing.length > 0
      ) {
        const coreMissing = (data.missing as string[])
          .map((k) => CORE_MISSING_MAP[k])
          .filter((k): k is keyof CoreIdentityValues => Boolean(k))
        const audienceMissing = (data.missing as string[])
          .map((k) => AUDIENCE_MISSING_MAP[k])
          .filter((k): k is keyof AudienceIdentityValues => Boolean(k))

        if (coreMissing.length > 0) {
          const fetchRes = await fetch("/api/core-identity").catch(() => null)
          const fetchData = fetchRes && fetchRes.ok ? await fetchRes.json().catch(() => null) : null
          const saved = (fetchData?.identity ?? {}) as Record<string, unknown>
          const prefill = buildCoreIdentityFromResponse(
            { productName: businessName, niche, whoIAm: expertise },
            undefined,
            saved,
          )
          setCoreGapMode("gaps")
          setCoreGapMissingKeys(coreMissing)
          setCoreGapValues(prefill)
          setCoreGapOpen(true)
          toast("חסרים שדות חיוניים בסגנון הכתיבה — השלימו ונמשיך", { duration: 8000 })
          return
        }
        if (audienceMissing.length > 0) {
          const fetchRes = await fetch("/api/audience-identity").catch(() => null)
          const fetchData = fetchRes && fetchRes.ok ? await fetchRes.json().catch(() => null) : null
          const saved = (fetchData?.identity ?? {}) as Record<string, unknown>
          const prefill = buildAudienceIdentityFromResponse(undefined, saved)
          setAudienceGapMode("gaps")
          setAudienceGapMissingKeys(audienceMissing)
          setAudienceGapValues(prefill)
          setAudienceGapOpen(true)
          toast("חסרים שדות חיוניים בקהל היעד — השלימו ונמשיך", { duration: 8000 })
          return
        }
      }
      toast.error(
        data.message ||
          "לא הצלחנו לסיים את האונבורדינג. השלימו את הפרטים החסרים.",
        { duration: 12000 },
      )
      return
    }
    router.push("/welcome")
  }

  const canProceed = () => {
    if (saving) return false
    if (currentStep === 0) {
      return anthropicKey.trim() && apifyKey.trim()
    }
    if (currentStep === 1) {
      return businessName.trim() && niche.trim() && expertise.trim() && !!styleFile
    }
    if (currentStep === 2) {
      return !!audienceFile
    }
    if (currentStep === 3) {
      const filled = creatorsList.filter((c) => c.url.trim())
      if (filled.length === 0) return false
      return filled.every((c) => !validateCreatorInput(c.url))
    }
    if (currentStep === 4) {
      return productsList.length > 0 && productsList.every((p) => p.name.trim())
    }
    return false
  }

  const handleNext = async () => {
    setSaving(true)
    try {
      if (currentStep === 0) {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          // Validate every entered key against its provider before persisting.
          // Catches the recurring "pasted into wrong field" bug + dead keys.
          // Each entry runs format + live check via the same endpoint Settings uses.
          const entries: Array<["anthropic_api_key" | "heygen_api_key" | "apify_api_key", string, string]> = []
          if (anthropicKey.trim()) entries.push(["anthropic_api_key", anthropicKey.trim(), "Anthropic"])
          if (heygenKey.trim()) entries.push(["heygen_api_key", heygenKey.trim(), "HeyGen"])
          if (apifyKey.trim()) entries.push(["apify_api_key", apifyKey.trim(), "Apify"])

          for (const [keyName, value, label] of entries) {
            const v = await fetch("/api/validate-api-key", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keyName, value }),
            }).then((r) => r.json()).catch(() => ({ ok: false, message: "תקלת רשת" }))
            if (!v.ok) {
              toast.error(`${label}: ${v.message ?? "המפתח לא עבר ולידציה"}`, { duration: 12000 })
              return
            }
          }

          const updates: Record<string, string> = {}
          for (const [keyName, value] of entries) updates[keyName] = value
          if (Object.keys(updates).length > 0) {
            const { error } = await supabase.from("users").update(updates as never).eq("id", user.id)
            if (error) {
              console.error("Failed to save API keys:", error)
              toast.error(`שגיאה בשמירת ה-API keys: ${error.message}`, { duration: 12000 })
              return
            }
          }
        }
        await advanceFromStep(0)
      } else if (currentStep === 1) {
        if (styleFile) {
          const validation = validateIdentityFile(styleFile)
          if (validation) {
            toast.error(validation.message, { duration: 10000 })
            return
          }
          toast("מעלה ומנתח את הקובץ — זה יכול לקחת עד דקה")
        }
        const formData = new FormData()
        if (styleFile) {
          formData.append("file", styleFile)
        }
        formData.append("type", "core")
        formData.append(
          "manualFields",
          JSON.stringify({
            productName: businessName,
            niche,
            whoIAm: expertise,
          }),
        )
        let res: Response
        try {
          res = await fetch("/api/parse-identity", { method: "POST", body: formData })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(
            `החיבור נקטע באמצע ההעלאה (${msg}). בדקו את החיבור לאינטרנט ונסו שוב.`,
            { duration: 12000 },
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
        if (resData.classificationWarning) {
          toast(resData.classificationWarning, { duration: 12000 })
        } else if (resData.warning) {
          toast.error(resData.warning, { duration: 12000 })
        }

        // Stitch the response into the full identity shape so we can decide
        // whether to advance, open a gap-fill popup, or open a verify popup.
        // - classificationWarning set → ALWAYS open verify popup, never silent
        //   advance. The file didn't match what we expected; the user must
        //   confirm what we have or cancel and try a different file.
        // - identity complete + no warning → advance directly.
        // - identity incomplete → open gap-fill popup with only empty fields.
        const identity = buildCoreIdentityFromResponse(
          { productName: businessName, niche, whoIAm: expertise },
          resData.parsed,
          resData.saved,
        )
        // Gap detection: which keys did THIS upload's fresh data (manual +
        // parsed) leave empty? Ignores stale DB values so the user always
        // sees what the new file actually missed.
        const missing = coreMissingKeysFromFresh(
          { productName: businessName, niche, whoIAm: expertise },
          resData.parsed,
        )
        setStyleParseDone(true)
        if (resData.classificationWarning) {
          setCoreGapMode("verify")
          setCoreGapMissingKeys(undefined)
          setCoreGapValues(identity)
          setCoreGapOpen(true)
        } else if (missing.length === 0) {
          if (styleFile && !resData.fileSaveError && !resData.notice && !resData.warning) {
            toast.success("הקובץ עלה ונותח בהצלחה")
          }
          await advanceFromStep(1)
        } else {
          setCoreGapMode("gaps")
          setCoreGapMissingKeys(missing)
          setCoreGapValues(identity)
          setCoreGapOpen(true)
        }
      } else if (currentStep === 2) {
        if (audienceFile) {
          const validation = validateIdentityFile(audienceFile)
          if (validation) {
            toast.error(validation.message, { duration: 10000 })
            return
          }
          toast("מעלה ומנתח את הקובץ — זה יכול לקחת עד דקה")
        }
        const formData = new FormData()
        if (audienceFile) {
          formData.append("file", audienceFile)
        }
        formData.append("type", "audience")
        let res: Response
        try {
          res = await fetch("/api/parse-identity", { method: "POST", body: formData })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(
            `החיבור נקטע באמצע ההעלאה (${msg}). בדקו את החיבור לאינטרנט ונסו שוב.`,
            { duration: 12000 },
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
        if (resData.classificationWarning) {
          toast(resData.classificationWarning, { duration: 12000 })
        } else if (resData.warning) {
          toast.error(resData.warning, { duration: 12000 })
        }

        const identity = buildAudienceIdentityFromResponse(resData.parsed, resData.saved)
        const missing = audienceMissingKeysFromFresh(resData.parsed)
        setAudienceParseDone(true)
        if (resData.classificationWarning) {
          setAudienceGapMode("verify")
          setAudienceGapMissingKeys(undefined)
          setAudienceGapValues(identity)
          setAudienceGapOpen(true)
        } else if (missing.length === 0) {
          if (audienceFile && !resData.fileSaveError && !resData.notice && !resData.warning) {
            toast.success("הקובץ עלה ונותח בהצלחה")
          }
          await advanceFromStep(2)
        } else {
          setAudienceGapMode("gaps")
          setAudienceGapMissingKeys(missing)
          setAudienceGapValues(identity)
          setAudienceGapOpen(true)
        }
      } else if (currentStep === 3) {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const parsed = creatorsList
            .map((c) => parseCreatorInput(c.url))
            .filter((p): p is NonNullable<typeof p> => p !== null)
          if (parsed.length > 0) {
            await supabase.from("user_top_creators").delete().eq("user_id", user.id)
            const payload = parsed.map((p) => ({
              user_id: user.id,
              url: p.url,
              handle: p.handle,
              platform: p.platform,
            }))
            const { error: insErr } = await supabase
              .from("user_top_creators")
              .insert(payload as never)
            if (insErr) {
              console.error("Failed to insert creators:", insErr)
              toast.error(`שגיאה בשמירת היוצרים: ${insErr.message}`, { duration: 12000 })
              return
            }
          }
        }
        await advanceFromStep(3)
      } else {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          await supabase.from("products").delete().eq("user_id", user.id)
          const insertPayload = productsList.map((p) => ({
            user_id: user.id,
            name: p.name,
            type: p.type,
            landing_page_url: p.noSalesPage ? null : (p.landingPageUrl || null),
            page_summary: p.noSalesPage ? (p.manualSummary?.trim() || null) : null,
          }))
          const { data: insertedProducts, error: insertError } = await supabase
            .from("products")
            .insert(insertPayload as never)
            .select("id")

          if (insertError) {
            console.error("Failed to insert products:", insertError)
            toast.error(`שגיאה בשמירת מוצרים: ${insertError.message}`, { duration: 12000 })
            return
          }

          if (insertedProducts) {
            const productsWithUrls = productsList
              .map((p, i) => ({ url: p.landingPageUrl, productId: (insertedProducts[i] as { id: string }).id, skip: p.noSalesPage }))
              .filter((p) => !p.skip && p.url)

            for (const { url, productId } of productsWithUrls) {
              fetch("/api/parse-product-page", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, productId }),
              }).catch((err) => console.error("Product page parse failed:", err))
            }
          }
        }

        // Step 4 is the last in the sequence — advanceFromStep finds no
        // next step and runs /api/onboarding/complete itself, which also
        // does the /welcome push on success.
        await advanceFromStep(4)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleCoreGapSave = async (next: CoreIdentityValues) => {
    if (gapPreviewMode) {
      toast("תצוגה בלבד — הנתונים לא נשמרו")
      setCoreGapOpen(false)
      setGapPreviewMode(false)
      return
    }
    setCoreGapSaving(true)
    try {
      const res = await fetch("/api/core-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(
          `שמירת הפרטים החסרים נכשלה: ${data.error || res.status}`,
          { duration: 12000 },
        )
        return
      }
      setCoreGapOpen(false)
      // currentStep, not a hardcoded 1: when the dialog was opened in-place
      // from the products step (E flow), advancing from currentStep retries
      // the /api/onboarding/complete check instead of jumping back to the
      // audience step.
      await advanceFromStep(currentStep)
    } finally {
      setCoreGapSaving(false)
    }
  }

  // Closing the popup without "primary save" still persists current values so
  // typed progress isn't lost. In gaps mode the dialog is locked — the only
  // way the user reaches this is by clicking "אשלים בהגדרות", which we honor
  // by saving what we have and bouncing them to /settings/business so the
  // missing fields can be completed there. Otherwise (verify / preview) the
  // popup just closes.
  const handleCoreGapClose = (current: CoreIdentityValues) => {
    setCoreGapOpen(false)
    if (gapPreviewMode) {
      setGapPreviewMode(false)
      return
    }
    const isGapsMode = coreGapMode === "gaps"
    void fetch("/api/core-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    }).catch((err) => console.warn("[onboarding] core gap close-save failed:", err))
    if (isGapsMode) {
      toast("נמשיך מאוחר יותר בעמוד ההגדרות", { duration: 8000 })
      router.push("/settings?tab=business")
    }
  }

  const handleAudienceGapSave = async (next: AudienceIdentityValues) => {
    if (gapPreviewMode) {
      toast("תצוגה בלבד — הנתונים לא נשמרו")
      setAudienceGapOpen(false)
      setGapPreviewMode(false)
      return
    }
    setAudienceGapSaving(true)
    try {
      const res = await fetch("/api/audience-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(
          `שמירת פרטי הקהל החסרים נכשלה: ${data.error || res.status}`,
          { duration: 12000 },
        )
        return
      }
      setAudienceGapOpen(false)
      // currentStep, not a hardcoded 2: see handleCoreGapSave comment for
      // why — same in-place fix scenario applies here.
      await advanceFromStep(currentStep)
    } finally {
      setAudienceGapSaving(false)
    }
  }

  const handleAudienceGapClose = (current: AudienceIdentityValues) => {
    setAudienceGapOpen(false)
    if (gapPreviewMode) {
      setGapPreviewMode(false)
      return
    }
    // Same locked-mode escape hatch as core: save progress, send the user
    // to settings to finish. The home page would otherwise hit
    // audience_missing and the React tree crashes — exactly the bug we're
    // fixing here.
    const isGapsMode = audienceGapMode === "gaps"
    void fetch("/api/audience-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current),
    }).catch((err) => console.warn("[onboarding] audience gap close-save failed:", err))
    if (isGapsMode) {
      toast("נמשיך מאוחר יותר בעמוד ההגדרות", { duration: 8000 })
      router.push("/settings?tab=business")
    }
  }

  // File replacement: overwrite the existing identity row with an empty one
  // (preserving the manual fields for core), so the next parse-identity call
  // starts clean. Without this, pickFilled would silently merge old + new.
  const confirmStyleFileReplacement = async () => {
    if (!pendingStyleFile) return
    const file = pendingStyleFile
    // For core, keep what the user typed in step 2 (productName/niche/whoIAm)
    // and wipe the file-derived fields so the next parse can fill cleanly.
    await fetch("/api/core-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: businessName,
        niche,
        whoIAm: expertise,
        whoIServe: "",
        howISound: "",
        slangExamples: "",
        whatINeverDo: "",
      }),
    }).catch((err) => console.warn("[onboarding] core reset failed:", err))
    setStyleFile(file)
    setStyleParseDone(false)
    setPendingStyleFile(null)
  }

  const confirmAudienceFileReplacement = async () => {
    if (!pendingAudienceFile) return
    const file = pendingAudienceFile
    // Audience has no manual fields — wipe everything.
    await fetch("/api/audience-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(EMPTY_AUDIENCE_IDENTITY),
    }).catch((err) => console.warn("[onboarding] audience reset failed:", err))
    setAudienceFile(file)
    setAudienceParseDone(false)
    setPendingAudienceFile(null)
  }

  // Don't flash step 0 while the boot effect figures out where to land the
  // user. Returning users would otherwise see the connections form for a few
  // hundred milliseconds before snapping to their real first-incomplete step.
  if (!bootChecked) {
    return <div className="min-h-screen bg-white dark:bg-gray-10" />
  }

  return (
    <div dir="rtl" className="flex min-h-screen">
      {/* Gap-fill dialogs */}
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

      {/* File replacement confirmations — show only when the user picks a
          second file after the first already parsed. */}
      <ConfirmModal
        open={!!pendingStyleFile}
        onOpenChange={(next) => {
          if (!next) setPendingStyleFile(null)
        }}
        title="כבר העלית קובץ סגנון"
        description="החלפת הקובץ תמחק את כל מה שחילצנו ושמרנו עד עכשיו, ותתחיל מחדש עם הקובץ החדש. ההמשך לא יערבב בין שני הקבצים."
        confirmLabel="כן, החלף קובץ"
        cancelLabel="ביטול, להישאר עם הקיים"
        confirmVariant="destructive"
        onConfirm={confirmStyleFileReplacement}
      />
      <ConfirmModal
        open={!!pendingAudienceFile}
        onOpenChange={(next) => {
          if (!next) setPendingAudienceFile(null)
        }}
        title="כבר העלית קובץ ניתוח קהל"
        description="החלפת הקובץ תמחק את כל מה שחילצנו ושמרנו עד עכשיו, ותתחיל מחדש עם הקובץ החדש. ההמשך לא יערבב בין שני הקבצים."
        confirmLabel="כן, החלף קובץ"
        cancelLabel="ביטול, להישאר עם הקיים"
        confirmVariant="destructive"
        onConfirm={confirmAudienceFileReplacement}
      />

      {/* Right side - form */}
      <div className="flex w-full flex-col items-center px-6 py-12 lg:w-1/2">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <Image
            src={logoNew}
            alt="Next Level Content AI"
            className="h-[100px] w-auto"
            priority
          />
        </div>

        {/* Progress wizard */}
        <div className="w-full max-w-2xl mb-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center gap-3">
              <span
                className={
                  i === currentStep
                    ? "text-small-bold text-text-primary-default"
                    : i < currentStep
                      ? "text-small text-text-neutral-default"
                      : "text-small text-text-primary-disabled"
                }
              >
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className="h-px w-8 bg-border-neutral-default" />
              )}
            </div>
          ))}
        </div>

        {/* Dev navigator — local/?dev=1 only. */}
        {devMode && (
          <div className="w-full max-w-2xl mb-6 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-neutral-default bg-bg-surface px-3 py-2">
              <span className="text-xs-body text-text-neutral-default">
                מצב פיתוח · דלגו בין שלבים:
              </span>
              {STEPS.map((step, i) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStep(i)}
                  className={
                    "text-xs-body rounded-md px-2 py-1 transition-colors " +
                    (i === currentStep
                      ? "bg-bg-surface-primary-default text-text-primary-default font-semibold"
                      : "text-text-neutral-default hover:bg-bg-surface-hover")
                  }
                  aria-label={`קפיצה לשלב ${i + 1} — ${step.label}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-neutral-default bg-bg-surface px-3 py-2">
              <span className="text-xs-body text-text-neutral-default">תצוגת פופ-אפ:</span>
              <button
                type="button"
                onClick={() => {
                  setGapPreviewMode(true)
                  setCoreGapMode("gaps")
                  setCoreGapValues({
                    productName: "אקדמיית UXtra",
                    niche: "AI ועיצוב",
                    whoIAm: "מנטורית עם 10 שנות ניסיון בעיצוב",
                    whoIServe: "",
                    howISound: "חמה, סיפורית, ישירה",
                    slangExamples: "",
                    whatINeverDo: "",
                  })
                  setCoreGapOpen(true)
                }}
                className="text-xs-body rounded-md px-2 py-1 text-text-neutral-default hover:bg-bg-surface-hover"
              >
                פופ-אפ סגנון
              </button>
              <button
                type="button"
                onClick={() => {
                  setGapPreviewMode(true)
                  setCoreGapMode("verify")
                  setCoreGapValues({
                    productName: "אקדמיית UXtra",
                    niche: "AI ועיצוב",
                    whoIAm: "מנטורית עם 10 שנות ניסיון בעיצוב",
                    whoIServe: "מעצבי UI/UX שרוצים להתעדכן ב-AI",
                    howISound: "חמה, סיפורית, ישירה",
                    slangExamples: "תבינו, וזה כל ההבדל",
                    whatINeverDo: "לא משתמשת בשפה קרה או טכנית מדי",
                  })
                  setCoreGapOpen(true)
                }}
                className="text-xs-body rounded-md px-2 py-1 text-text-neutral-default hover:bg-bg-surface-hover"
              >
                סגנון · אישור
              </button>
              <button
                type="button"
                onClick={() => {
                  setGapPreviewMode(true)
                  setAudienceGapMode("gaps")
                  setAudienceGapValues({
                    employment: "מעצבי UI/UX",
                    behavioral: "חיים על פיגמה, צורכים תוכן רב",
                    awarenessLevel: "",
                    dailyPains: "לא בטוחים אם הקובץ בנוי נכון לקוד",
                    emotionalPains: "תחושת פער ועייפות",
                    unresolvedConsequences: "",
                    fears: "AI יחליף אותי",
                    failedSolutions: "קורסים כלליים מדי",
                    limitingBeliefs: "",
                    myths: "",
                    dailyDesires: "לעבוד מהר ולהבין פיגמה",
                    emotionalDesires: "ביטחון ושקט",
                    smallWins: "",
                    idealSolution: "ידע פרקטי בגובה העיניים",
                    bottomLine: "",
                    crossAudienceQuotes: "",
                    idealSolutionWords: "",
                    identityStatements: "",
                  })
                  setAudienceGapOpen(true)
                }}
                className="text-xs-body rounded-md px-2 py-1 text-text-neutral-default hover:bg-bg-surface-hover"
              >
                פופ-אפ קהל
              </button>
              <button
                type="button"
                onClick={() => {
                  setGapPreviewMode(true)
                  setAudienceGapMode("verify")
                  setAudienceGapValues({
                    employment: "מעצבי UI/UX",
                    behavioral: "חיים על פיגמה, צורכים תוכן רב",
                    awarenessLevel: "מודעים לבעיה ולאיום של AI",
                    dailyPains: "לא בטוחים אם הקובץ בנוי נכון לקוד",
                    emotionalPains: "תחושת פער ועייפות",
                    unresolvedConsequences: "להישאר מאחור, לאבד רלוונטיות",
                    fears: "AI יחליף אותי",
                    failedSolutions: "קורסים כלליים מדי",
                    limitingBeliefs: "אני לא מספיק טכני",
                    myths: "AI זה רק אוטומציות קטנות",
                    dailyDesires: "לעבוד מהר ולהבין פיגמה",
                    emotionalDesires: "ביטחון ושקט",
                    smallWins: "אה, עכשיו זה ברור",
                    idealSolution: "ידע פרקטי בגובה העיניים",
                    bottomLine: "מחפשים בהירות, לא השראה",
                    crossAudienceQuotes: "יש יותר מדי מידע",
                    idealSolutionWords: "שתראה לי איך זה ביום־יום",
                    identityStatements: "המעצב שסומכים עליו",
                  })
                  setAudienceGapOpen(true)
                }}
                className="text-xs-body rounded-md px-2 py-1 text-text-neutral-default hover:bg-bg-surface-hover"
              >
                קהל · אישור
              </button>
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="w-full max-w-lg flex flex-col gap-6">
          {/* Step 1 - Connections */}
          {currentStep === 0 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  מחברים את הכלים ומתחילים
                </h3>
                <p className="text-small text-text-neutral-default">
                  חיבור הכלים הכרחי כדי לאפשר למערכת ליצר עבורכם תוכן מנצח
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-small-bold text-text-primary-default flex items-center gap-2">
                  <Link2 className="size-4" />
                  Claude API Key *
                </label>
                <Input
                  dir="ltr"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                />
                <p className="text-xs-body text-text-neutral-default">
                  מצאו את ה-API key שלכם ב-{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary-default font-semibold hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-small-bold text-text-primary-default flex items-center gap-2">
                  <Link2 className="size-4" />
                  Apify API Key *
                </label>
                <Input
                  dir="ltr"
                  placeholder="apify_api_..."
                  value={apifyKey}
                  onChange={(e) => setApifyKey(e.target.value)}
                />
                <p className="text-xs-body text-text-neutral-default">
                  מצאו את ה-API key שלכם ב-{" "}
                  <a
                    href="https://console.apify.com/settings/integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary-default font-semibold hover:underline"
                  >
                    console.apify.com
                  </a>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-small-bold text-text-primary-default flex items-center gap-2">
                  <Link2 className="size-4" />
                  HeyGen API Key (אופציונאלי)
                </label>
                <Input
                  dir="ltr"
                  value={heygenKey}
                  onChange={(e) => setHeygenKey(e.target.value)}
                />
                <p className="text-xs-body text-text-neutral-default">
                  מצאו את ה-API key שלכם ב-{" "}
                  <a
                    href="https://app.heygen.com/settings?nav=API"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-primary-default font-semibold hover:underline"
                  >
                    app.heygen.com
                  </a>
                </p>
              </div>
            </>
          )}

          {/* Step 2 - Business */}
          {currentStep === 1 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  ספרו לנו על העסק שלכם
                </h3>
                <p className="text-small text-text-neutral-default">
                  כדי לקחת את יצירת התוכן שלכם לנקסט לבל
                  <br />
                  אנחנו צריכים למלא כמה פרטים עליכם ועל העסק שלכם
                </p>
              </div>

              <Input
                placeholder="שם העסק *"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />

              <Input
                placeholder="נישה *"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                required
              />

              <Textarea
                placeholder="כתבו על הניסיון והמומחיות שלכם *"
                value={expertise}
                onChange={(e) => setExpertise(e.target.value)}
                required
                className="min-h-[120px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none"
              />

              <div className="flex flex-col gap-1">
                <div
                  className="relative cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Input
                    placeholder="העלו קובץ סגנון כתיבה *"
                    value={styleFile?.name ?? ""}
                    readOnly
                    className="cursor-pointer pe-10 pointer-events-none"
                  />
                  <Paperclip className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".docx,.doc,.txt,.md"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      if (f && styleParseDone) {
                        setPendingStyleFile(f)
                      } else {
                        setStyleFile(f)
                      }
                      // Reset the input element so picking the same file twice
                      // still fires onChange (browsers de-dupe by default).
                      e.target.value = ""
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
                  ניתן להעלות קבצי doc, docx, txt, md
                </p>
              </div>
            </>
          )}

          {/* Step 3 - Audience */}
          {currentStep === 2 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  ספרו לנו על קהל היעד שלכם
                </h3>
                <p className="text-small text-text-neutral-default">
                  ככל שנבין יותר את הקהל, כך התוכן ידבר אליו טוב יותר
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <div
                  className="relative cursor-pointer"
                  onClick={() => audienceFileRef.current?.click()}
                >
                  <Input
                    placeholder="ניתוח קהל יעד *"
                    value={audienceFile?.name ?? ""}
                    readOnly
                    className="cursor-pointer pe-10 pointer-events-none"
                  />
                  <Paperclip className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                  <input
                    ref={audienceFileRef}
                    type="file"
                    className="hidden"
                    accept=".docx,.doc,.txt,.md"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      if (f && audienceParseDone) {
                        setPendingAudienceFile(f)
                      } else {
                        setAudienceFile(f)
                      }
                      e.target.value = ""
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
                  ניתן להעלות קבצי doc, docx, txt, md
                </p>
                <p className="text-xs-body text-text-primary-default text-start font-semibold">
                  שימו לב — בשלב הזה תומכים בקהל יעד אחד לכל קובץ. אם בקובץ יש כמה קהלים, יישמר רק הראשון.
                </p>
              </div>
            </>
          )}

          {/* Step 4 - Top creators */}
          {currentStep === 3 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  יוצרים מובילים שמעניינים אתכם
                </h3>
                <p className="text-small text-text-neutral-default">
                  מאילו יוצרים תרצו לקבל השראה לתכנים?
                  <br />
                  אנחנו נחפש את הפוסטים הויראליים שלהם ונביא מהם רעיונות.
                </p>
              </div>

              <CreatorsList
                creators={creatorsList}
                onChange={setCreatorsList}
                showRequiredAsterisk
              />
            </>
          )}

          {/* Step 5 - Products */}
          {currentStep === 4 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  המוצרים שלכם
                </h3>
                <p className="text-small text-text-neutral-default">
                  איזה מוצרים אתם מציעים כיום? הדביקו את שם המוצר ולינק לדף מכירה.
                  <br />
                  זה יעזור לנו לדייק עבורכם את ההוקים.
                </p>
              </div>

              <ProductsList
                products={productsList}
                onChange={setProductsList}
                requireName
              />
            </>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center gap-3 justify-end">
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="w-fit h-12 rounded-xl px-8 gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  שומר...
                </>
              ) : currentStep === 0 ? (
                <>
                  שמור והמשך
                  <ArrowLeft className="size-4" />
                </>
              ) : (
                <>
                  המשך
                  <ArrowLeft className="size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Left side */}
      <div
        className="hidden flex-1 lg:flex items-center justify-center"
        style={{ backgroundColor: "#FAF7E6" }}
      >
        <Image
          src={onboardingHero}
          alt=""
          className="w-[715px] object-contain"
          priority
        />
      </div>
    </div>
  )
}
