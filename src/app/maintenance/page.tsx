import type { Metadata } from "next"
import Image from "next/image"
import { notFound } from "next/navigation"
import logoNew from "../../../images/logo-new.png"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { isMaintenanceMode } from "@/lib/maintenance"

// The screen every page shows while MAINTENANCE_MODE is on — middleware
// rewrites all page requests here with a 503 (see lib/maintenance.ts).
//
// It must stay database-free: no Supabase, no auth, no data fetching. The
// layout around it is the root one, and that layout only touches the network
// on user action (or /api/notices, which the gate answers with a 503 that the
// notice toasts already treat as "nothing to show").
//
// Rendered per request so the flag is read at runtime, not baked in at build:
// with maintenance off this route is a plain 404, exactly as before it existed.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "אנחנו משדרגים את האפליקציה",
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  if (!isMaintenanceMode()) notFound()

  // Same shell as /login: centered column, logo above, one rounded card.
  return (
    <main
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center bg-bg-surface px-6 py-12"
    >
      <Image
        src={logoNew}
        alt="Next Level Content AI"
        className="mb-10 h-[86px] w-auto"
        priority
      />

      <Card className="w-full max-w-md rounded-3xl border-border-neutral-default bg-bg-surface-primary-default text-text-primary-default">
        <CardHeader className="items-center pb-2">
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-center text-2xl leading-tight text-text-primary-default"
          >
            אנחנו משדרגים את האפליקציה
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-center">
          <p className="text-p text-text-neutral-default">
            כדי שהכול ירוץ לכם מהר יותר. נחזור לפעול בעוד כמה שעות, וכל המידע
            שלכם שמור ובטוח.
          </p>
          <p className="text-small-bold text-text-primary-default">
            תודה על הסבלנות
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
