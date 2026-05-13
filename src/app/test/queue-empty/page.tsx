"use client"

/**
 * Visual playground for the QueuePanel empty states.
 *
 * Route: /test/queue-empty — renders the four "no items" states the
 * panel can land in, side-by-side, each inside a panel-shaped frame
 * (same width as the real rail on /calendar) so the typography +
 * spacing + chrome read exactly like production.
 *
 * No data wiring: these are pure presentational variants exported from
 * the panel itself.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { isOwner } from "@/lib/owner"
import {
  EmptyAllScheduledState,
  EmptyNoPostsState,
  EmptyNoneReadyState,
  QueueErrorState,
} from "@/components/queue-panel"

type Variant = {
  id: string
  title: string
  description: string
  badgeCount: number
  showSearch: boolean
  content: React.ReactNode
}

const VARIANTS: Variant[] = [
  {
    id: "no-posts",
    title: "אין פוסטי ליבה",
    description:
      "המשתמשת מעולם לא יצרה פוסט ליבה. הפאנל מציג CTA מובהק לפתיחת /project.",
    badgeCount: 0,
    showSearch: false,
    content: <EmptyNoPostsState />,
  },
  {
    id: "none-ready",
    title: "פוסטים קיימים, אבל אף אחד לא מוכן",
    description:
      "יש בקליפ פוסטים בלי מדיה או סקריפט. זה האמפטי שראית בלוח — הכרטיס המודגש עם המטוס.",
    badgeCount: 0,
    showSearch: false,
    content: <EmptyNoneReadyState count={3} />,
  },
  {
    id: "all-scheduled",
    title: "הכל מתוזמן",
    description:
      "כל הפוסטים המוכנים כבר על הלוח. הפאנל מברך ומציע ליצור עוד תוכן.",
    badgeCount: 0,
    showSearch: false,
    content: <EmptyAllScheduledState />,
  },
  {
    id: "error",
    title: "שגיאת רשת",
    description:
      "ה-API נכשל בטעינת הפוסטים. הפאנל מציג הודעת שגיאה + הוראה לרענן.",
    badgeCount: 0,
    showSearch: false,
    content: <QueueErrorState message="שגיאה בטעינת הפוסטים" />,
  },
]

export default function QueueEmptyStatesTestPage() {
  // Owner gate — keeps the visual playground out of public view in
  // production. Non-owners are bounced home; owners see the playground
  // after the auth check resolves.
  const router = useRouter()
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isOwner(user?.email)) {
        setGranted(true)
      } else {
        setGranted(false)
        router.replace("/")
      }
    })
  }, [router])

  if (granted !== true) {
    return <div className="min-h-screen bg-bg-surface" />
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-bg-surface px-6 py-10"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-xs-body text-text-neutral-default mb-1">
            סביבת בדיקה · /test/queue-empty
          </p>
          <h1 className="text-text-primary-default text-2xl font-bold mb-2">
            תצוגה מקדימה — אמפטי-סטייטס של פאנל "פוסטים לתזמון"
          </h1>
          <p className="text-small text-text-neutral-default">
            ארבעה מצבים, כל אחד בתוך מסגרת פאנל ברוחב זהה לעמודה האמיתית
            ב-/calendar (420px). אין נתוני אמת — רק העיצוב.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {VARIANTS.map((v) => (
            <section
              key={v.id}
              className="flex flex-col gap-3"
              aria-labelledby={`variant-${v.id}-title`}
            >
              <div>
                <h2
                  id={`variant-${v.id}-title`}
                  className="text-p-bold text-text-primary-default"
                >
                  {v.title}
                </h2>
                <p className="text-xs-body text-text-neutral-default mt-0.5 leading-relaxed">
                  {v.description}
                </p>
              </div>

              {/* Panel chrome — mirrors the real `<aside>` from QueuePanel:
                  width 420, white bg, start border, header row with
                  title + badge, optional search input. Static here; the
                  point is to see the empty state INSIDE its real frame. */}
              <div className="w-[420px] max-w-full flex flex-col border border-border-neutral-default bg-white dark:bg-gray-10 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border-neutral-default flex items-center gap-2">
                  <h3 className="text-text-primary-default text-p-bold flex-1">
                    פוסטים לתזמון
                  </h3>
                  <Badge variant="outline" className="tabular-nums">
                    {v.badgeCount}
                  </Badge>
                </div>

                {v.showSearch && (
                  <div className="px-4 pt-3">
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-text-neutral-default pointer-events-none" />
                      <Input
                        inputSize="small"
                        placeholder="חיפוש..."
                        className="ps-8 text-xs"
                        disabled
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 px-4 py-3">{v.content}</div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
