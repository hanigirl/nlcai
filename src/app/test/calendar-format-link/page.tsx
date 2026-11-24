/**
 * State preview — "ללוח התזמון" on a format card lands on THAT format.
 *
 * Route: /test/calendar-format-link[?state=story-scheduled|nothing-scheduled|own-slot]
 * No param = all states side by side.
 *
 * Each state renders the real approval footer (approved) for every format,
 * with the link it builds, and where the calendar's deep link sends it — the
 * same pure function the calendar runs. Sample data only: no fetches, no
 * writes.
 */

import { ApprovalCardFooter } from "@/components/format-approval/approval-card-footer"
import { calendarHref, formatDeepLinkTarget } from "@/lib/calendar-href"

async function noop() {
  "use server"
}

const POST = "00000000-0000-4000-8000-000000000001"

const FORMATS: { id: string; label: string; noun: string }[] = [
  { id: "story", label: "סטורי", noun: "הסטורי" },
  { id: "talking_head", label: "דיבור למצלמה", noun: "הדיבור למצלמה" },
  { id: "carousel", label: "קרוסלה", noun: "הקרוסלה" },
  { id: "image_post", label: "פוסט תמונה", noun: "פוסט התמונה" },
  { id: "b_roll", label: "בי-רול", noun: "הבי-רול" },
]
const LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label]))

type Board = { corePostId: string; format: string; scheduledDate: string }[]

const STATES: { id: string; title: string; description: string; board: Board }[] = [
  {
    id: "story-scheduled",
    title: "הסטורי כבר מתוזמן",
    description: "המצב מהדיווח: הסטורי על הלוח, ושאר הפורמטים עוד לא. כל כפתור נוחת על הפורמט שלו.",
    board: [{ corePostId: POST, format: "story", scheduledDate: "2026-11-22" }],
  },
  {
    id: "nothing-scheduled",
    title: "שום דבר עוד לא מתוזמן",
    description: "כל כפתור פותח את התצוגה של הפורמט שלו, מוכן לתזמון.",
    board: [],
  },
  {
    id: "own-slot",
    title: "לבי-רול כבר יש מקום בלוח",
    description: "הסטורי והבי-רול מתוזמנים. הבי-רול נפתח בשבוע של המקום שלו, לא בשבוע של הסטורי.",
    board: [
      { corePostId: POST, format: "story", scheduledDate: "2026-11-22" },
      { corePostId: POST, format: "b_roll", scheduledDate: "2026-12-03" },
    ],
  },
]

export default async function CalendarFormatLinkPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const shown = state ? STATES.filter((s) => s.id === state) : STATES

  return (
    <main dir="rtl" className="min-h-screen bg-bg-surface p-4 sm:p-8">
      <h1 className="text-xl font-semibold text-text-primary-default">ללוח התזמון — נוחת על הפורמט שנלחץ</h1>
      <div className="mt-6 flex flex-col gap-10">
        {shown.map((s) => (
          <section key={s.id} data-state={s.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text-primary-default">{s.title}</h2>
            <p className="text-small text-text-neutral-default">{s.description}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FORMATS.map((f) => {
                const href = calendarHref(POST, f.id)
                const target = formatDeepLinkTarget(s.board, POST, f.id)
                return (
                  <div
                    key={f.id}
                    className="flex flex-col gap-3 rounded-[10px] border border-border-neutral-default bg-white dark:bg-gray-10 p-4"
                  >
                    <span className="font-semibold text-text-primary-default">{f.label}</span>
                    <ApprovalCardFooter
                      status="approved"
                      formatNoun={f.noun}
                      onApprove={noop}
                      onRevoke={noop}
                      calendarHref={href}
                    />
                    <p className="text-xs text-text-neutral-default" data-lands-on={target.format}>
                      נפתח בלוח: {LABEL[target.format]}
                      {target.weekOf ? ` (בשבוע של ${target.weekOf.split("-").reverse().join(".")})` : " (עוד לא מתוזמן)"}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
