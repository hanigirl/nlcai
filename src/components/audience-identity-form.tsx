"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export interface AudienceIdentityValues {
  location: string
  employment: string
  education: string
  income: string
  behavioral: string
  awarenessLevel: string
  dailyPains: string
  emotionalPains: string
  unresolvedConsequences: string
  fears: string
  failedSolutions: string
  limitingBeliefs: string
  myths: string
  dailyDesires: string
  emotionalDesires: string
  smallWins: string
  idealSolution: string
  bottomLine: string
  crossAudienceQuotes: string
  idealSolutionWords: string
  identityStatements: string
}

export const EMPTY_AUDIENCE_IDENTITY: AudienceIdentityValues = {
  location: "",
  employment: "",
  education: "",
  income: "",
  behavioral: "",
  awarenessLevel: "",
  dailyPains: "",
  emotionalPains: "",
  unresolvedConsequences: "",
  fears: "",
  failedSolutions: "",
  limitingBeliefs: "",
  myths: "",
  dailyDesires: "",
  emotionalDesires: "",
  smallWins: "",
  idealSolution: "",
  bottomLine: "",
  crossAudienceQuotes: "",
  idealSolutionWords: "",
  identityStatements: "",
}

export function isAudienceIdentityComplete(v: AudienceIdentityValues): boolean {
  return (Object.keys(EMPTY_AUDIENCE_IDENTITY) as (keyof AudienceIdentityValues)[]).every(
    (k) => v[k].trim().length > 0,
  )
}

export interface AudienceIdentityField {
  key: keyof AudienceIdentityValues
  label: string
  placeholder: string
  multiline?: boolean
}

export interface AudienceFieldGroup {
  title: string
  fields: AudienceIdentityField[]
}

export const AUDIENCE_IDENTITY_GROUPS: AudienceFieldGroup[] = [
  {
    title: "דמוגרפיה",
    fields: [
      { key: "location", label: "מיקום", placeholder: "אזור, ערים מרכזיות" },
      { key: "employment", label: "תעסוקה", placeholder: "תפקיד, ענף, סוג עבודה" },
      { key: "education", label: "השכלה", placeholder: "רמת השכלה, תחום" },
      { key: "income", label: "הכנסה", placeholder: "נמוכה / בינונית / גבוהה / טווח" },
      {
        key: "behavioral",
        label: "התנהגות",
        placeholder: "איך הם מתנהלים ביום־יום, הרגלים בולטים",
        multiline: true,
      },
    ],
  },
  {
    title: "מודעות",
    fields: [
      {
        key: "awarenessLevel",
        label: "רמת מודעות לבעיה",
        placeholder: "האם הם יודעים שיש להם בעיה? ניסו פתרונות? עדיין מחפשים?",
        multiline: true,
      },
    ],
  },
  {
    title: "כאבים ופחדים",
    fields: [
      {
        key: "dailyPains",
        label: "כאבים יומיומיים",
        placeholder: "מה מציק להם בכל יום",
        multiline: true,
      },
      {
        key: "emotionalPains",
        label: "כאבים רגשיים",
        placeholder: "מה הם מרגישים בפנים — אשמה, בושה, בריחה",
        multiline: true,
      },
      {
        key: "unresolvedConsequences",
        label: "מה יקרה אם זה לא יפתר",
        placeholder: "ההשלכות שהם פוחדים מהן בטווח הארוך",
        multiline: true,
      },
      {
        key: "fears",
        label: "פחדים",
        placeholder: "ממה הם הכי פוחדים",
        multiline: true,
      },
    ],
  },
  {
    title: "אמונות וניסיונות",
    fields: [
      {
        key: "failedSolutions",
        label: "פתרונות שניסו ולא עבדו",
        placeholder: "מה הם כבר ניסו וזה לא החזיק",
        multiline: true,
      },
      {
        key: "limitingBeliefs",
        label: "אמונות מגבילות",
        placeholder: "מה הם מאמינים על עצמם שמונע שינוי",
        multiline: true,
      },
      {
        key: "myths",
        label: "מיתוסים בתחום",
        placeholder: "מה הם חושבים שנכון בתחום וזה לא",
        multiline: true,
      },
    ],
  },
  {
    title: "תשוקות ופתרון אידיאלי",
    fields: [
      {
        key: "dailyDesires",
        label: "תשוקות יומיומיות",
        placeholder: "מה הם רוצים שיקרה בכל יום",
        multiline: true,
      },
      {
        key: "emotionalDesires",
        label: "תשוקות רגשיות",
        placeholder: "מה הם רוצים להרגיש",
        multiline: true,
      },
      {
        key: "smallWins",
        label: "נצחונות קטנים שמשמחים אותם",
        placeholder: "מה ירגיש להם כמו התקדמות",
        multiline: true,
      },
      {
        key: "idealSolution",
        label: "הפתרון האידיאלי שלהם",
        placeholder: "איך נראה העולם שלהם אחרי שזה ייפתר",
        multiline: true,
      },
      {
        key: "bottomLine",
        label: "השורה התחתונה",
        placeholder: "מה הם באמת רוצים מתחת לכל זה",
        multiline: true,
      },
    ],
  },
  {
    title: "קול הקהל",
    fields: [
      {
        key: "crossAudienceQuotes",
        label: "ציטוטים חוזרים בקהל",
        placeholder: "מילים שהם אומרים, בלשון שלהם",
        multiline: true,
      },
      {
        key: "idealSolutionWords",
        label: "איך הם מתארים את הפתרון בלשון שלהם",
        placeholder: "המילים בהן הם יבקשו את הפתרון",
        multiline: true,
      },
      {
        key: "identityStatements",
        label: "הצהרות זהות",
        placeholder: "איך הם רוצים שיגדירו אותם — ׳אישה ש...׳, ׳מישהי ש...׳",
        multiline: true,
      },
    ],
  },
]

interface AudienceIdentityFormProps {
  values: AudienceIdentityValues
  onChange: (next: AudienceIdentityValues) => void
}

export function AudienceIdentityForm({ values, onChange }: AudienceIdentityFormProps) {
  const update = (key: keyof AudienceIdentityValues, value: string) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="flex flex-col gap-7">
      {AUDIENCE_IDENTITY_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-3">
          <h4 className="text-small-bold text-text-primary-default border-b border-border-neutral-default pb-1.5">
            {group.title}
          </h4>
          <div className="flex flex-col gap-3">
            {group.fields.map((field) => {
              const isEmpty = !values[field.key].trim()
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <label className="text-xs-body text-text-primary-default px-1">
                    {field.label}
                    <span className="text-button-destructive-default"> *</span>
                  </label>
                  {field.multiline ? (
                    <Textarea
                      placeholder={field.placeholder}
                      value={values[field.key]}
                      onChange={(e) => update(field.key, e.target.value)}
                      className={
                        "min-h-[72px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none" +
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
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
