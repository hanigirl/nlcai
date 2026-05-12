"use client"

// Preview page for the profile-health banner. Mocks every variant of the
// data shape so the design can be reviewed without seeding actual broken
// state in the DB. Open at /test-banner.
//
// TODO: delete this route once the banner is verified — it shouldn't ship
// in a public surface long-term.

import { AppShell } from "@/components/app-shell"

type ProfileHealth = {
  enabled: true
  styleFileIssue: { reason: "parse_failed" | "missing" } | null
  audienceFileIssue: { reason: "parse_failed" | "missing" } | null
  hasProducts: boolean
  hasCreators: boolean
}

// Inline banner copy duplicated from src/app/page.tsx so this preview
// page renders identically. Keep them in sync until the banner is
// extracted to a shared component.
function HealthBanner({ health }: { health: ProfileHealth }) {
  const reasonText = (reason: "parse_failed" | "missing") =>
    reason === "parse_failed"
      ? "הקובץ לא נקרא במלואו — חסר תוכן שמשמש לג'ינרוט"
      : "לא הועלה קובץ ולא הוזן תוכן ידנית"

  const fileIssues: Array<{ key: string; label: string; reason: "parse_failed" | "missing" }> = []
  if (health.styleFileIssue) {
    fileIssues.push({ key: "style", label: "סגנון הכתיבה", reason: health.styleFileIssue.reason })
  }
  if (health.audienceFileIssue) {
    fileIssues.push({ key: "audience", label: "ניתוח קהל היעד", reason: health.audienceFileIssue.reason })
  }

  if (fileIssues.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {fileIssues.map((issue) => (
          <div
            key={issue.key}
            className="rounded-xl border border-red-50 bg-red-95 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-small text-text-primary-default">
              <span className="text-small-bold">בעיה בקובץ {issue.label}:</span>{" "}
              {reasonText(issue.reason)}
            </p>
            <a
              href="/settings?tab=business"
              className="text-small-bold text-text-primary-default hover:underline shrink-0"
            >
              לעדכון →
            </a>
          </div>
        ))}
      </div>
    )
  }

  const missingItems: string[] = []
  if (!health.hasProducts) missingItems.push("מוצרים")
  if (!health.hasCreators) missingItems.push("יוצרים מובילים")

  if (missingItems.length > 0) {
    return (
      <div className="rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-small text-text-primary-default">
          כדי להפיק את המירב מהמערכת כדאי להגדיר {missingItems.join(" ו")}
        </p>
        <a
          href="/settings?tab=business"
          className="text-small-bold text-text-primary-default hover:underline shrink-0"
        >
          להגדרות →
        </a>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border-neutral-default bg-bg-surface px-4 py-3 text-center">
      <p className="text-small text-text-neutral-default">
        אין באנר — הכל תקין
      </p>
    </div>
  )
}

const variants: Array<{ title: string; health: ProfileHealth }> = [
  {
    title: "1. קובץ סגנון לא הועלה (missing)",
    health: {
      enabled: true,
      styleFileIssue: { reason: "missing" },
      audienceFileIssue: null,
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "2. קובץ סגנון נכשל בקריאה (parse_failed)",
    health: {
      enabled: true,
      styleFileIssue: { reason: "parse_failed" },
      audienceFileIssue: null,
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "3. קובץ קהל יעד לא הועלה",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: { reason: "missing" },
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "4. קובץ קהל יעד נכשל בקריאה",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: { reason: "parse_failed" },
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "5. שני הקבצים בעייתיים (missing + parse_failed)",
    health: {
      enabled: true,
      styleFileIssue: { reason: "missing" },
      audienceFileIssue: { reason: "parse_failed" },
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "6. קבצים תקינים, חסרים מוצרים בלבד",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: null,
      hasProducts: false,
      hasCreators: true,
    },
  },
  {
    title: "7. קבצים תקינים, חסרים יוצרים בלבד",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: null,
      hasProducts: true,
      hasCreators: false,
    },
  },
  {
    title: "8. קבצים תקינים, חסרים גם מוצרים וגם יוצרים",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: null,
      hasProducts: false,
      hasCreators: false,
    },
  },
  {
    title: "9. הכל תקין — אין באנר",
    health: {
      enabled: true,
      styleFileIssue: null,
      audienceFileIssue: null,
      hasProducts: true,
      hasCreators: true,
    },
  },
  {
    title: "10. בעיית קבצים גוברת על חסרי מוצרים/יוצרים",
    health: {
      enabled: true,
      styleFileIssue: { reason: "parse_failed" },
      audienceFileIssue: null,
      hasProducts: false,
      hasCreators: false,
    },
  },
]

export default function TestBannerPage() {
  return (
    <AppShell>
      <div dir="rtl" className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-text-primary-default mb-2">Profile health banner — preview</h1>
          <p className="text-small text-text-neutral-default">
            כל הוריאנטים של הבאנר במסך הבית. הסדר משקף את ה-priority של ה-API:
            קבצים גוברים על מוצרים/יוצרים.
          </p>
        </header>

        <div className="flex flex-col gap-8">
          {variants.map((v, i) => (
            <section key={i} className="flex flex-col gap-2">
              <p className="text-small-bold text-text-primary-default">{v.title}</p>
              <HealthBanner health={v.health} />
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
