"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export interface CoreIdentityValues {
  productName: string
  niche: string
  whoIAm: string
  whoIServe: string
  howISound: string
  slangExamples: string
  whatINeverDo: string
}

export const EMPTY_CORE_IDENTITY: CoreIdentityValues = {
  productName: "",
  niche: "",
  whoIAm: "",
  whoIServe: "",
  howISound: "",
  slangExamples: "",
  whatINeverDo: "",
}

export function isCoreIdentityComplete(v: CoreIdentityValues): boolean {
  return (Object.keys(EMPTY_CORE_IDENTITY) as (keyof CoreIdentityValues)[]).every(
    (k) => v[k].trim().length > 0,
  )
}

interface CoreIdentityFormProps {
  values: CoreIdentityValues
  onChange: (next: CoreIdentityValues) => void
}

export interface CoreIdentityField {
  key: keyof CoreIdentityValues
  label: string
  placeholder: string
  hint?: string
  multiline?: boolean
}

export const CORE_IDENTITY_FIELDS: CoreIdentityField[] = [
  { key: "productName", label: "שם העסק / המוצר", placeholder: "למשל: סטודיו ליצירה" },
  { key: "niche", label: "נישה", placeholder: "למשל: כושר לאמהות, שיווק B2B, UX לסטארטאפים" },
  {
    key: "whoIAm",
    label: "מי אתם",
    placeholder: "ניסיון, רקע, מה אתם מביאים לשולחן",
    multiline: true,
  },
  {
    key: "whoIServe",
    label: "למי אתם פונים",
    placeholder: "הקהל שאתם משרתים — בשורה אחת",
    multiline: true,
  },
  {
    key: "howISound",
    label: "איך אתם נשמעים",
    placeholder: "הטון, האנרגיה, אופי הדיבור",
    hint: "למשל: חם ומכיל, ישיר ולא מתפשר, פלפלי עם הומור",
    multiline: true,
  },
  {
    key: "slangExamples",
    label: "ביטויים שחוזרים אצלכם",
    placeholder: "מילים, אמרות, קריאות עידוד שאתם משתמשים בהן",
    hint: "למשל: ׳חמודה את יכולה׳, ׳בקצב שלך׳, ׳זה בסדר לפחד׳",
    multiline: true,
  },
  {
    key: "whatINeverDo",
    label: "מה אתם לעולם לא אומרים / עושים",
    placeholder: "קווים אדומים סגנוניים",
    hint: "למשל: לא משתמשת בשיימינג, לא מבטיחה תוצאות קסם",
    multiline: true,
  },
]

export function CoreIdentityForm({ values, onChange }: CoreIdentityFormProps) {
  const update = (key: keyof CoreIdentityValues, value: string) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="flex flex-col gap-4">
      {CORE_IDENTITY_FIELDS.map((field) => {
        const isEmpty = !values[field.key].trim()
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label className="text-small-bold text-text-primary-default px-1">
              {field.label}
              <span className="text-button-destructive-default"> *</span>
            </label>
            {field.multiline ? (
              <Textarea
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => update(field.key, e.target.value)}
                className={
                  "min-h-[88px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none" +
                  (isEmpty ? " ring-1 ring-button-destructive-default/30" : "")
                }
                aria-invalid={isEmpty ? true : undefined}
              />
            ) : (
              <Input
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => update(field.key, e.target.value)}
                className={isEmpty ? "ring-1 ring-button-destructive-default/30" : ""}
                aria-invalid={isEmpty ? true : undefined}
              />
            )}
            {field.hint && (
              <p className="text-xs-body text-text-neutral-default px-1">{field.hint}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
