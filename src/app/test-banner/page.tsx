"use client"

// Preview page for the profile-health banner. Mocks every variant of the
// data shape so the design can be reviewed without seeding actual broken
// state in the DB. Open at /test-banner.
//
// TODO: delete this route once the banner is verified — it shouldn't ship
// in a public surface long-term.

import { AppShell } from "@/components/app-shell"

type FileIssueReason =
  | "no_file" // user didn't upload + didn't type anything manually
  | "file_invalid" // upload failed to read (unsupported format / corrupted)
  | "file_too_long" // exceeded the AI context window
  | "multiple_audiences" // multi-persona file detected (audience only)
  | "ai_failed" // generic AI / parsing error
  | "empty_content" // file was readable but had no extractable content

type ProfileHealth = {
  enabled: true
  styleFileIssue: { reason: FileIssueReason } | null
  audienceFileIssue: { reason: FileIssueReason } | null
  hasProducts: boolean
  hasCreators: boolean
}

// Reason → user-facing message. The structure is "what went wrong" +
// "what to do" so the user can act without guessing. The label points
// the user at the exact section name they'll find in /settings, so the
// no_file copy reads as concrete ("לא הוזן מידע על העסק") instead of
// vague ("manual entry").
function reasonCopy(reason: FileIssueReason, fileLabel: string) {
  switch (reason) {
    case "no_file":
      return `עדיין לא הוזן ${fileLabel}. אפשר להעלות קובץ או להזין ידנית בהגדרות.`
    case "file_invalid":
      return `הקובץ שהועלה עבור ${fileLabel} לא תקין. צריך לנסות קובץ docx/pdf אחר, ולוודא שאינו פגום.`
    case "file_too_long":
      return `הקובץ שהועלה עבור ${fileLabel} ארוך מדי לעיבוד. צריך לקצר אותו ולהעלות שוב.`
    case "multiple_audiences":
      return `הקובץ של ${fileLabel} מכיל יותר מקהל יעד אחד. צריך להעלות קובץ נפרד לכל קהל, או להשאיר קהל אחד בלבד.`
    case "ai_failed":
      return `הניתוח של ${fileLabel} נכשל. אפשר לנסות להעלות שוב או להזין ידנית בהגדרות.`
    case "empty_content":
      return `הקובץ שהועלה עבור ${fileLabel} ריק או קצר מדי. צריך להוסיף תוכן ולהעלות שוב.`
  }
}

function HealthBanner({ health }: { health: ProfileHealth }) {
  // Labels match the section names the user will see in /settings so the
  // "go fix it" link lands somewhere predictable. Per-reason link target
  // lets the banner point at the exact panel (file upload sub-section for
  // parse failures, manual-entry sub-section for missing content).
  const fileSettingsHref = (reason: FileIssueReason, kind: "style" | "audience") => {
    // no_file is the only state where typing manually is the natural
    // first move — point at the matching about/you sub-section. Every
    // other reason is upload-recovery → the files sub-section.
    if (reason === "no_file") {
      return kind === "style"
        ? "/settings?tab=business&sub=about"
        : "/settings?tab=business&sub=you"
    }
    return "/settings?tab=business&sub=files"
  }

  const fileIssues: Array<{ key: "style" | "audience"; label: string; reason: FileIssueReason }> = []
  if (health.styleFileIssue) {
    fileIssues.push({ key: "style", label: "מידע על העסק", reason: health.styleFileIssue.reason })
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
              {reasonCopy(issue.reason, issue.label)}
            </p>
            <a
              href={fileSettingsHref(issue.reason, issue.key)}
              className="text-small-bold text-text-primary-default hover:underline shrink-0"
            >
              להגדרות ←
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
    // Land the user on whichever inventory is empty. When both are
    // empty, default to products (first in the message order).
    const inventoryHref = !health.hasProducts
      ? "/settings?tab=products"
      : "/settings?tab=creators"
    return (
      <div className="rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-small text-text-primary-default">
          כדי להפיק את המירב מהמערכת כדאי להגדיר {missingItems.join(" ו")}
        </p>
        <a
          href={inventoryHref}
          className="text-small-bold text-text-primary-default hover:underline shrink-0"
        >
          להגדרות ←
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
    title: "1. סגנון — לא הועלה קובץ (no_file)",
    health: { enabled: true, styleFileIssue: { reason: "no_file" }, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "2. סגנון — קובץ לא תקין (file_invalid)",
    health: { enabled: true, styleFileIssue: { reason: "file_invalid" }, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "3. סגנון — קובץ ארוך מדי (file_too_long)",
    health: { enabled: true, styleFileIssue: { reason: "file_too_long" }, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "4. סגנון — קובץ ריק (empty_content)",
    health: { enabled: true, styleFileIssue: { reason: "empty_content" }, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "5. סגנון — שגיאת AI (ai_failed)",
    health: { enabled: true, styleFileIssue: { reason: "ai_failed" }, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "6. קהל יעד — לא הועלה קובץ",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: { reason: "no_file" }, hasProducts: true, hasCreators: true },
  },
  {
    title: "7. קהל יעד — מכיל 2 קהלים (multiple_audiences)",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: { reason: "multiple_audiences" }, hasProducts: true, hasCreators: true },
  },
  {
    title: "8. קהל יעד — קובץ ארוך מדי",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: { reason: "file_too_long" }, hasProducts: true, hasCreators: true },
  },
  {
    title: "9. שני הקבצים בעייתיים (סגנון לא תקין + קהל מרובה)",
    health: { enabled: true, styleFileIssue: { reason: "file_invalid" }, audienceFileIssue: { reason: "multiple_audiences" }, hasProducts: true, hasCreators: true },
  },
  {
    title: "10. קבצים תקינים, חסרים מוצרים בלבד",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: null, hasProducts: false, hasCreators: true },
  },
  {
    title: "11. קבצים תקינים, חסרים יוצרים בלבד",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: null, hasProducts: true, hasCreators: false },
  },
  {
    title: "12. קבצים תקינים, חסרים גם מוצרים וגם יוצרים",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: null, hasProducts: false, hasCreators: false },
  },
  {
    title: "13. הכל תקין — אין באנר",
    health: { enabled: true, styleFileIssue: null, audienceFileIssue: null, hasProducts: true, hasCreators: true },
  },
  {
    title: "14. בעיית קובץ גוברת — סגנון ארוך מדי + חסרים מוצרים+יוצרים",
    health: { enabled: true, styleFileIssue: { reason: "file_too_long" }, audienceFileIssue: null, hasProducts: false, hasCreators: false },
  },
]

export default function TestBannerPage() {
  return (
    <AppShell>
      <div dir="rtl" className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-text-primary-default mb-2">Profile health banner — preview</h1>
          <p className="text-small text-text-neutral-default">
            כל הוריאנטים של הבאנר במסך הבית. ההודעה אומרת בדיוק מה השתבש ומה צריך לעשות.
            הסדר משקף את ה-priority של ה-API: קבצים גוברים על מוצרים/יוצרים.
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
