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
  | "no_credits" // Anthropic returned credits_exhausted during the parse
  | "empty_content" // file was readable but had no extractable content

type ProfileHealth = {
  enabled: true
  // Global Anthropic credits flag. When true the user can't generate
  // anything until they top up — shown as the highest-priority banner
  // above file issues and improvement nudges. File-level no_credits
  // is reported through styleFileIssue / audienceFileIssue so the user
  // sees a per-file explanation when only the parse died.
  creditsExhausted: boolean
  styleFileIssue: { reason: FileIssueReason } | null
  audienceFileIssue: { reason: FileIssueReason } | null
  hasProducts: boolean
  hasCreators: boolean
}

const ANTHROPIC_BILLING_URL = "https://console.anthropic.com/settings/billing"

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
    case "no_credits":
      return `הניתוח של ${fileLabel} לא הצליח כי נגמרו הקרדיטים מאנתרופיק. צריך להטעין קרדיטים ולנסות שוב.`
    case "empty_content":
      return `הקובץ שהועלה עבור ${fileLabel} ריק או קצר מדי. צריך להוסיף תוכן ולהעלות שוב.`
  }
}

function HealthBanner({ health }: { health: ProfileHealth }) {
  // Credits-exhausted is the highest-priority banner — nothing else
  // generates until the user tops up at Anthropic. Renders alone with a
  // red treatment + external link to billing; the file/inventory
  // banners below are intentionally suppressed because acting on them
  // is pointless until credits are restored.
  if (health.creditsExhausted) {
    return (
      <div className="rounded-xl border border-red-50 bg-red-95 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-small text-text-primary-default">
          <strong className="text-small-bold">
            לא ניתן לייצר תוכן נוסף כי נגמרו הקרדיטים מאנתרופיק.
          </strong>{" "}
          יש להטעין קרדיטים מחדש באתר אנתרופיק.
        </p>
        <a
          href={ANTHROPIC_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-small-bold text-text-primary-default hover:underline shrink-0"
        >
          להטעינה ←
        </a>
      </div>
    )
  }

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

  // Improvement nudges — one banner per missing inventory so each has
  // its own tailored copy + deep link. The shared "הכל מוכן ליצור תוכן!
  // אבל..." prefix is repeated intentionally; treating them as separate
  // cards keeps the action wording specific to what's missing.
  const improvements: Array<{ key: string; body: string; href: string }> = []
  if (!health.hasCreators) {
    improvements.push({
      key: "creators",
      body: "כדי להפיק את המירב מהמערכת יש לעדכן גם יוצרים ולקבל רעיונות מהשטח שיפתחו את החשיבה.",
      href: "/settings?tab=creators",
    })
  }
  if (!health.hasProducts) {
    improvements.push({
      key: "products",
      body: "כדי לדייק עבורך את התוכן יש להכניס את כל המוצרים המוצעים בעסק.",
      href: "/settings?tab=products",
    })
  }

  if (improvements.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {improvements.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-yellow-50 bg-yellow-95 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-small text-text-primary-default">
              <strong className="text-small-bold">הכל מוכן ליצור תוכן! אבל...</strong>{" "}
              {item.body}
            </p>
            <a
              href={item.href}
              className="text-small-bold text-text-primary-default hover:underline shrink-0"
            >
              להגדרות ←
            </a>
          </div>
        ))}
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

const base = { creditsExhausted: false, hasProducts: true, hasCreators: true } as const

const variants: Array<{ title: string; health: ProfileHealth }> = [
  {
    title: "0. אין קרדיטים מאנתרופיק (גובר על הכל)",
    health: { enabled: true, ...base, creditsExhausted: true, styleFileIssue: null, audienceFileIssue: null },
  },
  {
    title: "1. סגנון — לא הועלה קובץ (no_file)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "no_file" }, audienceFileIssue: null },
  },
  {
    title: "2. סגנון — קובץ לא תקין (file_invalid)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "file_invalid" }, audienceFileIssue: null },
  },
  {
    title: "3. סגנון — קובץ ארוך מדי (file_too_long)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "file_too_long" }, audienceFileIssue: null },
  },
  {
    title: "4. סגנון — קובץ ריק (empty_content)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "empty_content" }, audienceFileIssue: null },
  },
  {
    title: "5. סגנון — שגיאת AI כללית (ai_failed)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "ai_failed" }, audienceFileIssue: null },
  },
  {
    title: "6. סגנון — פירסור נכשל כי אין קרדיטים (no_credits)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "no_credits" }, audienceFileIssue: null },
  },
  {
    title: "7. קהל יעד — לא הועלה קובץ",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: { reason: "no_file" } },
  },
  {
    title: "8. קהל יעד — מכיל 2 קהלים (multiple_audiences)",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: { reason: "multiple_audiences" } },
  },
  {
    title: "9. קהל יעד — פירסור נכשל כי אין קרדיטים",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: { reason: "no_credits" } },
  },
  {
    title: "10. שני הקבצים בעייתיים (סגנון לא תקין + קהל מרובה)",
    health: { enabled: true, ...base, styleFileIssue: { reason: "file_invalid" }, audienceFileIssue: { reason: "multiple_audiences" } },
  },
  {
    title: "11. קבצים תקינים, חסרים מוצרים בלבד",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: null, hasProducts: false },
  },
  {
    title: "12. קבצים תקינים, חסרים יוצרים בלבד",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: null, hasCreators: false },
  },
  {
    title: "13. קבצים תקינים, חסרים גם מוצרים וגם יוצרים",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: null, hasProducts: false, hasCreators: false },
  },
  {
    title: "14. הכל תקין — אין באנר",
    health: { enabled: true, ...base, styleFileIssue: null, audienceFileIssue: null },
  },
  {
    title: "15. בעיית קובץ גוברת — סגנון ארוך מדי + חסרים מוצרים+יוצרים",
    health: { enabled: true, ...base, styleFileIssue: { reason: "file_too_long" }, audienceFileIssue: null, hasProducts: false, hasCreators: false },
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
