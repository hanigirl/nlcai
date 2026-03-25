"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Paperclip, Plus, Trash2, Loader2, Link2 } from "lucide-react"
import logoFull from "../../../images/logo-full.png"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

const STEPS = [
  { id: "connections", label: "חיבור חשבונות" },
  { id: "business", label: "העסק שלך" },
  { id: "audience", label: "קהל היעד" },
  { id: "products", label: "המוצרים שלך" },
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

  // Step 4 - Products
  const [productsList, setProductsList] = useState<
    { name: string; type: "front" | "premium" | "lead_magnet"; url: string }[]
  >([])


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
        setCurrentStep(3)
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
            landing_page_url: p.url || null,
          }))
          const { data: insertedProducts, error: insertError } = await supabase
            .from("products")
            .insert(insertPayload)
            .select("id")

          if (insertError) {
            console.error("Failed to insert products:", insertError)
            alert(`שגיאה בשמירת מוצרים: ${insertError.message}`)
            return
          }

          // Parse product pages in the background (don't block navigation)
          if (insertedProducts) {
            const productsWithUrls = productsList
              .map((p, i) => ({ url: p.url, productId: (insertedProducts[i] as { id: string }).id }))
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
        router.push("/")
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
            src={logoFull}
            alt="Postudio"
            className="h-[86px] w-auto"
            priority
          />
        </div>

        {/* Progress wizard */}
        <div className="w-full max-w-lg mb-10 flex items-center justify-center gap-3">
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
                <h3 className="text-text-primary-default mb-2">
                  היי חני, וולקאם לפוסט סטודיו!
                </h3>
                <p className="text-small text-text-neutral-default">
                  חברי את חשבונות ה-AI שלך כדי להתחיל ליצור תוכן.
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
                  מצא את ה-API key שלך ב-{" "}
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
                  placeholder="הכנס את ה-API key שלך"
                  value={heygenKey}
                  onChange={(e) => setHeygenKey(e.target.value)}
                />
                <p className="text-xs-body text-text-neutral-default">
                  מצא את ה-API key שלך ב-{" "}
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
                <h3 className="text-text-primary-default mb-2">
                  ספרי לנו על העסק שלך
                </h3>
                <p className="text-small text-text-neutral-default">
                  כדי לקחת את יצירת התוכן שלך לנקסט לבל
                  <br />
                  אנחנו צריכים למלא כמה פרטים עליך ועל העסק שלך
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
                placeholder="כתוב על הניסיון והמומחיות שלך *"
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
                    placeholder="העלה קובץ סגנון כתיבה *"
                    value={styleFile?.name ?? ""}
                    readOnly
                    className="cursor-pointer pe-10 pointer-events-none"
                  />
                  <Paperclip className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-text-neutral-default" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".doc,.docx,.txt,.rtf,.pdf,.odt"
                    onChange={(e) => setStyleFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <p className="text-xs-body text-text-neutral-default text-start">
                  במידה ואין לך קובץ כזה{" "}
                  <a href="#" className="text-text-primary-default font-semibold hover:underline">
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
                <h3 className="text-text-primary-default mb-2">
                  ספרי לנו על קהל היעד שלך
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
                    accept=".doc,.docx,.txt,.rtf,.pdf,.odt"
                    onChange={(e) => setAudienceFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <p className="text-xs-body text-text-neutral-default text-start">
                  אם אין לך ניתוח קהל יעד{" "}
                  <a href="#" className="text-text-primary-default font-semibold hover:underline">
                    יוצרים את זה כאן
                  </a>
                </p>
              </div>
            </>
          )}

          {/* Step 4 - Products */}
          {currentStep === 3 && (
            <>
              <div className="text-center mb-2">
                <h3 className="text-text-primary-default mb-2">
                  המוצרים שלך
                </h3>
                <p className="text-small text-text-neutral-default">
                  מה שמות המוצרים שיש לך בעסק? מאיזה סוג הם?
                </p>
              </div>

              {/* Product list */}
              <div className="flex flex-col gap-3">
                {productsList.map((product, i) => (
                  <div
                    key={i}
                    className="group flex flex-col gap-2 rounded-2xl bg-bg-surface px-3 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="שם המוצר *"
                        value={product.name}
                        onChange={(e) => {
                          const updated = [...productsList]
                          updated[i].name = e.target.value
                          setProductsList(updated)
                        }}
                        required
                        className="flex-1 border-none bg-transparent shadow-none"
                      />

                      <select
                        value={product.type}
                        onChange={(e) => {
                          const updated = [...productsList]
                          updated[i].type = e.target.value as "front" | "premium" | "lead_magnet"
                          setProductsList(updated)
                        }}
                        className="h-10 rounded-xl border border-border-neutral-default bg-white px-3 text-small text-text-primary-default appearance-none cursor-pointer pe-8"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808080' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "left 0.5rem center",
                        }}
                      >
                        <option value="front">פרונט</option>
                        <option value="premium">פרימיום</option>
                        <option value="lead_magnet">מגנט לידים</option>
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          setProductsList(productsList.filter((_, j) => j !== i))
                        }
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                      >
                        <Trash2 className="size-4 text-text-neutral-default hover:text-button-destructive-default" />
                      </button>
                    </div>

                    <Input
                      dir="ltr"
                      placeholder="לינק לדף המוצר (אופציונלי)"
                      value={product.url}
                      onChange={(e) => {
                        const updated = [...productsList]
                        updated[i].url = e.target.value
                        setProductsList(updated)
                      }}
                      className="border-none bg-white shadow-none text-sm"
                    />
                  </div>
                ))}
              </div>

              {/* Add product button */}
              <Button
                variant="outline"
                onClick={() =>
                  setProductsList([
                    ...productsList,
                    { name: "", type: "front", url: "" },
                  ])
                }
                className="w-full h-12 rounded-2xl border-border-neutral-default text-text-neutral-default gap-2"
              >
                <Plus className="size-4" />
                הוספת מוצר חדש
              </Button>
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
      <div className="hidden flex-1 bg-bg-surface lg:block" />
    </div>
  )
}
