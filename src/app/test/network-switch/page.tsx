"use client"

/**
 * State preview for the calendar's network switch (Hani's pick, direction A:
 * tabs over the phone frame) and the connected-networks marker.
 *
 * Route: /test/network-switch — /calendar needs a login, so this page renders
 * the same preview modal and the same connected-networks marker from sample
 * data. No fetches, no DB writes, no provider calls; toggles change local
 * state only.
 *
 *   ?state=one               — story, Instagram only
 *   ?state=three             — reel to Instagram + YouTube + LinkedIn, all scheduled
 *   ?state=failed            — LinkedIn refused the video, the others scheduled
 *   ?state=optout            — YouTube taken off this post
 *   ?state=mixed             — LinkedIn not connected (marker + preview)
 *   (no state)               — the marker in every connection mix, and links
 */

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { FormatPreviewDialog } from "@/components/format-preview/format-preview-dialog"
import { InstagramConnectDialogHost } from "@/components/instagram-connect"
import type { InstagramConnection } from "@/lib/instagram-connection"
import type { SocialPlatform } from "@/lib/supabase/types"
import {
  ConnectedNetworksIndicator,
  type ConnectedNetwork,
} from "@/components/format-preview/network-switch"
import {
  NETWORK_REVIEW_STATES,
  isNetworkReviewState,
  reviewConnections,
  reviewPreviewData,
  type NetworkReviewState,
} from "@/components/format-preview/network-review-fixtures"
import type { PreviewNetwork } from "@/components/format-preview/shared"

const MARKER_MIXES: { title: string; networks: ConnectedNetwork[] }[] = [
  {
    title: "הכול מחובר",
    networks: [
      { platform: "instagram", state: "connected", handle: "noa.cohen.consulting" },
      { platform: "youtube", state: "connected", handle: "Noa Cohen Consulting" },
      { platform: "linkedin", state: "connected", handle: "נועה כהן" },
    ],
  },
  {
    title: "מעורב: אינסטגרם ו-YouTube מחוברים, LinkedIn לא",
    networks: [
      { platform: "instagram", state: "connected", handle: "noa.cohen.consulting" },
      { platform: "youtube", state: "connected", handle: "Noa Cohen Consulting" },
      { platform: "linkedin", state: "none" },
    ],
  },
  {
    title: "החיבור ל-YouTube פג",
    networks: [
      { platform: "instagram", state: "connected", handle: "noa.cohen.consulting" },
      { platform: "youtube", state: "expired", handle: "Noa Cohen Consulting" },
      { platform: "linkedin", state: "none" },
    ],
  },
  {
    title: "שום דבר לא מחובר",
    networks: [
      { platform: "instagram", state: "none" },
      { platform: "youtube", state: "none" },
      { platform: "linkedin", state: "none" },
    ],
  },
]

/** A marker entry as the connect modal sees it. */
function asConnection(n: ConnectedNetwork | undefined): InstagramConnection {
  if (!n || n.state === "none" || n.state === "loading") return { status: "disconnected", accounts: [], primary: null }
  const account = {
    id: `sample-${n.platform}`,
    platform: n.platform,
    handle: n.handle ?? null,
    avatarUrl: null,
    status: n.state === "connected" ? ("connected" as const) : ("needs_reconnect" as const),
    queuedCount: n.state === "connected" ? 2 : 0,
  }
  return { status: n.state === "connected" ? "connected" : "disconnected", accounts: [account], primary: account }
}

function Header({ networks }: { networks: ConnectedNetwork[] }) {
  // Each icon opens that network's real connect modal, on sample data, inert.
  const [open, setOpen] = useState<SocialPlatform | null>(null)
  return (
    <>
      <HeaderRow networks={networks} onOpen={setOpen} />
      <InstagramConnectDialogHost
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        platform={open ?? "instagram"}
        previewConnection={asConnection(networks.find((n) => n.platform === (open ?? "instagram")))}
      />
    </>
  )
}

function HeaderRow({ networks, onOpen }: { networks: ConnectedNetwork[]; onOpen: (p: SocialPlatform) => void }) {
  return (
    <div className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/calendar-min.png" alt="" className="h-[48px] w-[48px]" />
      <h2 className="text-text-primary-default">תזמון</h2>
      <ConnectedNetworksIndicator className="ms-auto" networks={networks} onOpen={onOpen} />
    </div>
  )
}

function StateView({ state }: { state: NetworkReviewState }) {
  const [networks, setNetworks] = useState<PreviewNetwork[]>(reviewPreviewData(state).networks ?? [])
  const [open, setOpen] = useState(true)
  const noop = () => toast("תצוגת סקירה — שום דבר לא נשמר")
  return (
    <div dir="rtl" className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-8">
      <Header networks={reviewConnections(state)} />
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="w-fit text-small underline">
          פתיחת התצוגה המקדימה
        </button>
      )}
      <FormatPreviewDialog
        open={open}
        onOpenChange={setOpen}
        data={{ ...reviewPreviewData(state), networks }}
        content="ready"
        onReschedule={noop}
        onCaptionSave={noop}
        onUnschedule={noop}
        onOpenCanvas={noop}
        onStatusAction={noop}
        onConnectNetwork={noop}
        onYouTubePrivacy={(privacy) =>
          setNetworks((list) => list.map((n) => (n.platform === "youtube" ? { ...n, youtubePrivacy: privacy } : n)))
        }
        onNetworkToggle={(platform, include) =>
          setNetworks((list) =>
            list.map((n) =>
              n.platform === platform
                ? { ...n, included: include, publish: include ? { kind: "scheduled" } : { kind: "unscheduled" } }
                : n,
            ),
          )
        }
      />
    </div>
  )
}

function Page() {
  const params = useSearchParams()
  const state = params.get("state")
  if (isNetworkReviewState(state)) return <StateView key={state} state={state} />

  return (
    <div dir="rtl" className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 p-8">
      <section className="flex flex-col gap-6">
        <h3 className="text-p-bold text-text-primary-default">הסימון מעל לוח התזמון</h3>
        {MARKER_MIXES.map((m) => (
          <div key={m.title} className="flex flex-col gap-2 rounded-2xl border border-border-neutral-default bg-white p-6 dark:bg-gray-10">
            <span className="text-xs-body text-text-neutral-default">{m.title}</span>
            <Header networks={m.networks} />
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-p-bold text-text-primary-default">התצוגה המקדימה</h3>
        <ul className="flex flex-col gap-1">
          {NETWORK_REVIEW_STATES.map((s) => (
            <li key={s.id}>
              <Link className="text-small text-text-primary-default underline" href={`/test/network-switch?state=${s.id}`}>
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default function NetworkSwitchTestPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  )
}
