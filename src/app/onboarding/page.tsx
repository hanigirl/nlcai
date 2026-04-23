"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Paperclip, Loader2, Link2 } from "lucide-react"
import logoNew from "../../../images/logo-new.png"
import onboardingHero from "../../../images/onboarding-hero.png"
import { createClient } from "@/lib/supabase/client"
import { parseCreatorInput } from "@/lib/creator-url"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { CreatorsList } from "@/components/creators-list"
import { ProductsList, type ProductEntry } from "@/components/products-list"
import { toast } from "sonner"

const STEPS = [
  { id: "connections", label: "חיבור חשבונות" },
  { id: "business", label: "העסק שלכם" },
  { id: "audience", label: "קהל היעד" },
  { id: "creators", label: "יוצרים מובילים" },
  { id: "products", label: "המוצרים שלכם" },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)

  // Step 1 - Connections
  const [anthropicKey, setAnthropicKey] = useState("")
  const [heygenKey, setHeygenKey] = useState("")

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

  const canProceed = () => {
    if (saving) return false
    if (currentStep === 0) {
      return true // connections step — always possible (skip or save)
    }
    if (currentStep === 1) {
      return businessName.trim() && niche.trim() && expertise.trim()
    }
    if (currentStep === 2) {
      return !!audienceFile
    }
    if (currentStep === 3) {
      return creatorsList.some((c) => c.url.trim())
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
        // Connections step — save keys if provided, then advance
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          const updates: Record<string, string> = {}
          if (anthropicKey.trim()) updates.anthropic_api_key = anthropicKey.trim()
          if (heygenKey.trim()) updates.heygen_api_key = heygenKey.trim()
          if (Object.keys(updates).length > 0) {
            const { error } = await supabase.from("users").update(updates as never).eq("id", user.id)
            if (error) {
              console.error("Failed to save API keys:", error)
              alert(`שגיאה בשמירת ה-API keys: ${error.message}`)
              return
            }
          }
        }
        setCurrentStep(1)
      } else if (currentStep === 1) {
        // Business step — save business info + parse style file
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
          })
        )
        const res = await fetch("/api/parse-identity", {
          method: "POST",
          body: formData,
        })
        const resData = await res.json()
        if (!res.ok) {
          alert(`שגיאה בשמירת נתוני העסק: ${resData.error}`)
          return
        }
        if (resData.warning) {
          alert(resData.warning)
        }
        if (styleFile) {
          toast.success("הקובץ עלה בהצלחה")
        }
        setCurrentStep(2)
      } else if (currentStep === 2) {
        // Audience step — parse audience file
        const formData = new FormData()
        if (audienceFile) {
          formData.append("file", audienceFile)
        }
        formData.append("type", "audience")
        const res = await fetch("/api/parse-identity", {
          method: "POST",
          body: formData,
        })
        const resData = await res.json()
        if (!res.ok) {
          alert(`שגיאה בשמירת קהל היעד: ${resData.error}`)
          return
        }
        if (resData.warning) {
          alert(resData.warning)
        }
        if (audienceFile) {
          toast.success("הקובץ עלה בהצלחה")
        }
        setCurrentStep(3)
      } else if (currentStep === 3) {
        // Creators step — save user-specified top creators
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const parsed = creatorsList
            .map((c) => parseCreatorInput(c.url))
            .filter((p): p is NonNullable<typeof p> => p !== null)
          if (parsed.length > 0) {
            // Replace any existing selections so the list is authoritative
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
              alert(`שגיאה בשמירת היוצרים: ${insErr.message}`)
              return
            }
          }
        }
        setCurrentStep(4)
      } else {
        // Products step (last) — save products + mark onboarding complete
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          await supabase.from("products").delete().eq("user_id", user.id)
          const insertPayload = productsList.map((p) => ({
            user_id: user.id,
            name: p.name,
            type: p.type,
            landing_page_url: p.landingPageUrl || null,
          }))
          const { data: insertedProducts, error: insertError } = await supabase
            .from("products")
            .insert(insertPayload as never)
            .select("id")

          if (insertError) {
            console.error("Failed to insert products:", insertError)
            alert(`שגיאה בשמירת מוצרים: ${insertError.message}`)
            return
          }

          // Parse product pages in the background (don't block navigation)
          if (insertedProducts) {
            const productsWithUrls = productsList
              .map((p, i) => ({ url: p.landingPageUrl, productId: (insertedProducts[i] as { id: string }).id }))
              .filter((p) => p.url)

            for (const { url, productId } of productsWithUrls) {
              fetch("/api/parse-product-page", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, productId }),
              }).catch((err) => console.error("Product page parse failed:", err))
            }
          }
        }

        await supabase.auth.updateUser({
          data: { onboarding_completed: true },
        })
        router.push("/welcome")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div dir="rtl" className="flex min-h-screen">
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

        {/* Content area */}
        <div className="w-full max-w-lg flex flex-col gap-6">
          {/* Step 1 - Connections */}
          {currentStep === 0 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default text-center leading-tight mb-2">
                  וולקאם לנקסט לבל של יצירת תוכן
                </h3>
                <p className="text-small text-text-neutral-default">
                  חברו את חשבונות ה-AI שלכם כדי להתחיל ליצור תוכן.
                  <br />
                  אפשר לדלג ולחבר מאוחר יותר בהגדרות.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-small-bold text-text-primary-default flex items-center gap-2">
                  <Link2 className="size-4" />
                  Claude API Key
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
                  HeyGen API Key
                </label>
                <Input
                  dir="ltr"
                  placeholder="הכניסו את ה-API key שלכם"
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
                    accept=".docx"
                    onChange={(e) => setStyleFile(e.target.files?.[0] ?? null)}
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
                    accept=".docx"
                    onChange={(e) => setAudienceFile(e.target.files?.[0] ?? null)}
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
            {currentStep === 0 && (
              <Button
                variant="outline"
                onClick={() => setCurrentStep(1)}
                disabled={saving}
                className="w-fit h-12 rounded-xl px-8"
              >
                דלג
              </Button>
            )}
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
      <div className="hidden flex-1 bg-bg-surface lg:flex items-center justify-center">
        <Image
          src={onboardingHero}
          alt=""
          className="w-[550px] object-contain -translate-x-12"
          priority
        />
      </div>
    </div>
  )
}
