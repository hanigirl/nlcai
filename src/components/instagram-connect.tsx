"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Instagram, Loader2, RefreshCw, Unlink } from "lucide-react"
import { NETWORK_LOGO } from "@/components/network-logos"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  refreshInstagramConnection,
  useInstagramConnection,
  useSocialConnections,
  type InstagramConnection,
} from "@/lib/instagram-connection"
import { syncScheduledFromServer } from "@/lib/timing-storage"
import { NETWORK_LABEL, toNetwork } from "@/lib/social/networks"
import type { SocialPlatform } from "@/lib/supabase/types"

/**
 * Instagram connection — one control, used in two places.
 *
 * Above the calendar the pill says whether scheduled posts will actually go
 * out (green "אינסטגרם · מחובר" / red "אינסטגרם · לא מחובר"); in Settings →
 * חיבורים → רשתות חברתיות the Instagram card says it. Both open the same
 * modal: Hani's copy about the Facebook-page requirement, the connect button,
 * and — once connected — the account with reconnect and disconnect. One modal, so the two
 * screens cannot drift apart, and one shared store (`instagram-connection`),
 * so connecting in either updates both without a refresh.
 *
 * The user never sees, logs into, or holds an account in the system that
 * brokers this; nothing here names it.
 *
 * Two details in the connect flow are the difference between this working and
 * this being a bug report, and neither is obvious:
 *
 *   1. The popup is opened SYNCHRONOUSLY in the click handler, before the
 *      fetch that resolves its URL. Browsers only trust `window.open` when it
 *      is a direct consequence of a click — open it after an `await` and the
 *      popup blocker eats it, on every browser, only for real users and never
 *      in dev. So we open a blank window immediately and redirect it once the
 *      URL arrives.
 *
 *   2. The provider's callback page broadcasts its result with a wildcard
 *      target, meaning ANY page listening can receive it — and, more to the
 *      point, any other window can send us a lookalike. So we check the
 *      sender's origin before believing a word of it.
 */

/** The only origin whose messages we act on. */
const PROVIDER_ORIGIN = "https://services.leadconnectorhq.com"

/** Hani's copy (2026-10-15). Light Hebrew polish only — not the content. */
export const FACEBOOK_PAGE_NOTE =
  "חיבור אינסטגרם לתזמון אפשרי לחשבון שמקושר לדף פייסבוק. אם החשבון שלכם לא מקושר, צריך ליצור דף פייסבוק עסקי ולקשר אותו לחשבון האינסטגרם. אחרת התזמון לא יעבוד."

/**
 * What each network's connect modal says. YouTube and LinkedIn reuse the
 * Instagram modal as-is (Hani, 2026-11-05: same look, no restyling); only the
 * words and the glyph change.
 */
/** The networks' own logos, in brand colour (see network-logos.tsx). */
export const NETWORK_ICON: Record<SocialPlatform, (p: { className?: string }) => React.ReactElement> = {
  instagram: NETWORK_LOGO.instagram,
  youtube: NETWORK_LOGO.youtube,
  linkedin: NETWORK_LOGO.linkedin,
}

export const NETWORK_CONNECT_NOTE: Record<SocialPlatform, string> = {
  instagram: FACEBOOK_PAGE_NOTE,
  youtube:
    "מתחברים עם חשבון הגוגל שהערוץ שלכם שייך אליו. ל-YouTube עולים רק סרטונים (טוקינג הד ו-B-roll), וההוק הוא כותרת הסרטון.",
  linkedin:
    "אפשר לחבר את הפרופיל האישי או דף חברה שאתם מנהלים. ל-LinkedIn עולים סרטונים, תמונה בודדת וקרוסלות עד 9 תמונות.",
}

/** One account the login exposes, when there are several to pick from. */
type AccountOption = { originId: string; name: string; avatar: string | null; kind?: "profile" | "page" }

/** Where the picker goes when Facebook keeps handing back the old account. */
const WRONG_ACCOUNT_HELP =
  "בפייסבוק: הגדרות ← אינטגרציות עסקיות ← LeadConnector ← ״הצג וערוך״. מסמנים שם את החשבון והדף שרוצים, ואז חוזרים לכאן ולוחצים ״חיבור מחדש״."

/** The shape the provider's popup posts back when it closes. */
type ConnectMessage = {
  page?: string
  platform?: string
  accountId?: string
  /**
   * Populated instead of `accountId` when the user came back through the
   * reconnect path rather than connecting fresh. Taken from the live callback
   * payload, which carries both fields and fills whichever applies — reading
   * only `accountId` would leave every reconnect looking like a failure.
   */
  reconnectAccounts?: string[] | string
  error?: string
}

/** Whichever of the two fields the provider actually filled in. */
function accountIdFrom(data: ConnectMessage): string | null {
  if (data.accountId) return data.accountId
  const re = data.reconnectAccounts
  if (Array.isArray(re) && re.length > 0 && re[0]) return re[0]
  if (typeof re === "string" && re) return re
  return null
}

const PROFILE_KIND_LABEL = { profile: "פרופיל אישי", page: "דף חברה" } as const

/** After the connection changes, the board's cards change with it. */
async function afterConnectionChange() {
  await refreshInstagramConnection()
  await syncScheduledFromServer()
}

/**
 * The popup flow. Its message listener is mounted for the life of the
 * control rather than only while a popup is open: it must already exist when
 * the popup fires, and re-attaching per click risks missing a fast one.
 */
function useConnectFlow(platform: SocialPlatform = "instagram") {
  const label = NETWORK_LABEL[platform]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the login exposes several accounts: the grant to attach from,
  // and the accounts to choose between.
  const [choice, setChoice] = useState<{ accountId: string; options: AccountOption[] } | null>(null)
  const popupRef = useRef<Window | null>(null)

  /** Attach the grant — and, the second time round, the account she picked. */
  const save = useCallback(async (accountId: string, originId?: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/social/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, platform, ...(originId ? { originId } : {}) }),
      })
      const json = await res.json()
      if (res.status === 409 && json.error === "choose_account" && Array.isArray(json.choose)) {
        setError(null)
        setChoice({ accountId, options: json.choose as AccountOption[] })
      } else if (!res.ok) {
        setError(json.message ?? "לא הצלחנו לשמור את החיבור.")
      } else {
        setError(null)
        setChoice(null)
        await afterConnectionChange()
        toast.success(`${label} מחובר`)
      }
    } catch {
      setError("לא הצלחנו לשמור את החיבור.")
    } finally {
      setBusy(false)
    }
  }, [platform, label])

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== PROVIDER_ORIGIN) return

      const data = e.data as ConnectMessage | null
      if (!data || data.page !== "social_media_posting") return
      // Each network's control listens only for its own popup.
      if (data.platform !== platform) return

      popupRef.current?.close()
      popupRef.current = null

      // `aborted` is the user closing the consent screen — a decision, not a
      // failure, so it gets no error banner.
      if (data.error) {
        if (data.error !== "aborted") setError("החיבור לא הושלם. אפשר לנסות שוב.")
        setBusy(false)
        return
      }

      const accountId = accountIdFrom(data)
      if (!accountId) {
        setError(
          platform === "instagram"
            ? "אינסטגרם לא החזירה חשבון. צריך לוודא שהחשבון עסקי או יוצר ומקושר לדף פייסבוק, ולנסות שוב."
            : `החיבור ${toNetwork(platform)} לא החזיר חשבון. אפשר לנסות שוב.`,
        )
        setBusy(false)
        return
      }

      await save(accountId)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [save, platform])

  const connect = useCallback(async () => {
    setError(null)
    setChoice(null)
    setBusy(true)

    // Opened FIRST, synchronously — see the note at the top of the file.
    const popup = window.open("", `nlcai-${platform}-connect`, "width=600,height=760")
    if (!popup) {
      setBusy(false)
      setError("הדפדפן חסם את חלון החיבור. צריך לאפשר חלונות קופצים לאתר הזה ולנסות שוב.")
      return
    }
    popupRef.current = popup

    try {
      const res = await fetch("/api/social/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      })
      const json = await res.json()
      if (!res.ok || !json.url) {
        popup.close()
        popupRef.current = null
        setBusy(false)
        setError(json.message ?? `לא הצלחנו לפתוח את החיבור ${toNetwork(platform)}.`)
        return
      }
      popup.location.href = json.url
    } catch {
      popup.close()
      popupRef.current = null
      setBusy(false)
      setError(`לא הצלחנו לפתוח את החיבור ${toNetwork(platform)}.`)
    }
  }, [platform])

  const choose = useCallback(
    (originId: string) => {
      if (choice) void save(choice.accountId, originId)
    },
    [choice, save],
  )

  return { busy, error, setError, connect, choice, setChoice, choose }
}

// ---------------------------------------------------------------------------
// pill
// ---------------------------------------------------------------------------

/**
 * The pill itself. Green only for a live connection; a lapsed one is red,
 * because posts on it will not go out.
 */
export function InstagramStatusPill({
  connection,
  onClick,
  className,
}: {
  connection: InstagramConnection
  onClick: () => void
  className?: string
}) {
  if (connection.status === "loading") {
    return (
      <span
        aria-hidden
        className={cn("inline-flex h-7 w-36 animate-pulse rounded-full bg-gray-95 dark:bg-gray-20", className)}
      />
    )
  }

  const connected = connection.status === "connected"
  const label = connected ? "אינסטגרם · מחובר" : "אינסטגרם · לא מחובר"

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`${label}. פתיחת הגדרות החיבור`}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50",
        connected
          ? "bg-green-95 text-green-20 hover:bg-green-90 dark:bg-green-95/10 dark:text-green-80"
          : "bg-red-95 text-button-destructive-default hover:bg-red-90 dark:bg-red-95/10",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          connected ? "bg-bg-surface-success-default" : "bg-button-destructive-default",
        )}
      />
      <Instagram className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// modal
// ---------------------------------------------------------------------------

function InstagramConnectDialog({
  open,
  onOpenChange,
  connection,
  flow,
  startOnDisconnect = false,
  platform = "instagram",
  inert = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: InstagramConnection
  flow: ReturnType<typeof useConnectFlow>
  /** Which network this modal is for. Same modal, its own words and glyph. */
  platform?: SocialPlatform
  /** Review only: buttons do nothing but say so. No fetch, no popup. */
  inert?: boolean
  /** Open straight on the disconnect confirmation (a card's "ניתוק"). */
  startOnDisconnect?: boolean
}) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const label = NETWORK_LABEL[platform]
  const Icon = NETWORK_ICON[platform]

  const account = connection.primary
  const isLive = connection.status === "connected" && account?.status === "connected"
  const isLapsed = !!account && account.status === "needs_reconnect"
  const queued = account?.queuedCount ?? 0

  const { setChoice } = flow
  useEffect(() => {
    if (!open) {
      setConfirmingDisconnect(false)
      setChoice(null)
    } else if (startOnDisconnect && isLive) {
      setConfirmingDisconnect(true)
    }
  }, [open, setChoice, startOnDisconnect, isLive])

  async function disconnect() {
    if (!account) return
    if (inert) {
      toast("תצוגת סקירה — שום דבר לא נותק")
      setConfirmingDisconnect(false)
      return
    }
    setDisconnecting(true)
    flow.setError(null)
    try {
      const res = await fetch(`/api/social/accounts?id=${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        flow.setError(json?.message ?? "הניתוק לא הצליח. אפשר לנסות שוב.")
        return
      }
      await afterConnectionChange()
      const cancelled = typeof json?.cancelled === "number" ? json.cancelled : 0
      toast.success(
        cancelled > 0
          ? `${label} נותק, ו-${cancelled === 1 ? "פוסט אחד בוטל" : `${cancelled} פוסטים בוטלו`} בתור`
          : `${label} נותק`,
      )
      setConfirmingDisconnect(false)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" aria-hidden />
            חיבור {label}
          </DialogTitle>
          <DialogDescription className="text-start text-small text-text-neutral-default">
            {NETWORK_CONNECT_NOTE[platform]}
          </DialogDescription>
        </DialogHeader>

        {flow.choice ? (
          <div className="flex flex-col gap-2">
            <span className="text-small-bold text-text-primary-default">לאיזה חשבון לחבר?</span>
            <div role="list" className="flex flex-col gap-1.5">
              {flow.choice.options.map((o) => (
                <button
                  key={o.originId}
                  type="button"
                  role="listitem"
                  onClick={() => flow.choose(o.originId)}
                  disabled={flow.busy}
                  className="flex items-center gap-3 rounded-xl border border-border-neutral-default p-3 text-start transition-colors hover:bg-gray-95 dark:hover:bg-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 disabled:opacity-60"
                >
                  <AccountAvatar src={o.avatar} platform={platform} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-small-bold text-text-primary-default">
                      {platform === "instagram" ? <bdi>@{o.name.replace(/^@/, "")}</bdi> : <bdi>{o.name}</bdi>}
                    </span>
                    {o.kind && platform === "linkedin" && (
                      <span className="text-xs-body text-text-neutral-default">{PROFILE_KIND_LABEL[o.kind]}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : connection.status === "unavailable" ? (
          <p className="text-small text-text-neutral-default">
            החיבור {toNetwork(platform)} ייפתח בקרוב. נעדכן ברגע שיהיה זמין.
          </p>
        ) : account && (isLive || isLapsed) ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border-neutral-default p-3">
            <div className="flex items-center gap-3">
              <AccountAvatar src={account.avatarUrl} platform={platform} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-small-bold text-text-primary-default">
                  {/* bdi, not dir="ltr": keeps "@handle" reading correctly
                      while the line itself stays right-aligned. */}
                  {account.handle ? (
                    platform === "instagram" ? <bdi>@{account.handle.replace(/^@/, "")}</bdi> : <bdi>{account.handle}</bdi>
                  ) : (
                    `חשבון ${label}`
                  )}
                </span>
                <span
                  className={cn(
                    "text-xs-body",
                    isLive ? "text-text-neutral-default" : "text-button-destructive-default",
                  )}
                >
                  {isLive
                    ? queued > 0
                      ? `מחובר · ${queued === 1 ? "פוסט אחד בתור" : `${queued} פוסטים בתור`}`
                      : "מחובר"
                    : "החיבור פג — צריך לחבר מחדש כדי שהתזמון ימשיך לעבוד"}
                </span>
              </div>
            </div>

            {confirmingDisconnect ? (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-lg bg-red-95 p-3 text-small text-button-destructive-default dark:bg-red-95/10"
              >
                {queued > 0
                  ? `ניתוק יבטל ${queued === 1 ? "פוסט אחד שמתוזמן" : `${queued} פוסטים שמתוזמנים`} ${toNetwork(platform)}. הם יישארו על הלוח, אבל לא יתפרסמו שם.`
                  : `אחרי הניתוק, פוסטים שתשימו ביומן לא יתפרסמו ${toNetwork(platform)}.`}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={disconnect}
                    disabled={disconnecting}
                    className="gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-90"
                  >
                    {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                    {queued > 0 ? "ניתוק וביטול הפוסטים" : "ניתוק"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
                    חזרה
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {flow.error && (
          <p role="alert" className="text-xs-body text-button-destructive-default">
            {flow.error}
          </p>
        )}

        {connection.status !== "unavailable" && !confirmingDisconnect && !flow.choice && (
          <DialogFooter className="gap-2 sm:justify-start">
            {isLive ? (
              <>
                <Button variant="outline" onClick={flow.connect} disabled={flow.busy} className="gap-2">
                  {flow.busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  חיבור מחדש
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={flow.busy}
                  className="gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95"
                >
                  <Unlink className="size-4" />
                  ניתוק
                </Button>
              </>
            ) : isLapsed ? (
              // Expired: reconnecting is the point; unplugging it stays possible.
              <>
                <Button onClick={flow.connect} disabled={flow.busy} className="gap-2">
                  {flow.busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {flow.busy ? "מתחבר..." : "חיבור מחדש"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={flow.busy}
                  className="gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95"
                >
                  <Unlink className="size-4" />
                  ניתוק
                </Button>
              </>
            ) : (
              <Button onClick={flow.connect} disabled={flow.busy} className="gap-2">
                {flow.busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                {flow.busy ? "מתחבר..." : `קישור ${toNetwork(platform)}`}
              </Button>
            )}
          </DialogFooter>
        )}

        {connection.status !== "unavailable" && platform === "instagram" && (
          <p className="text-xs-body text-text-neutral-default">
            <span className="font-semibold text-text-primary-default">לא רואה את החשבון הנכון? </span>
            {WRONG_ACCOUNT_HELP}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// the control, as each screen uses it
// ---------------------------------------------------------------------------

/**
 * Pill + modal. What sits above the calendar.
 * `open` / `onOpenChange` let a card's "לחבר מחדש" action open the same modal.
 */
export function InstagramConnectionControl({
  className,
  open: openProp,
  onOpenChange,
}: {
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const connection = useInstagramConnection()
  const flow = useConnectFlow()
  const [openLocal, setOpenLocal] = useState(false)
  const open = openProp ?? openLocal
  const setOpen = (v: boolean) => {
    setOpenLocal(v)
    onOpenChange?.(v)
    if (v) {
      flow.setError(null)
      // Fresh queued counts before anyone reads "disconnect will cancel N".
      void refreshInstagramConnection()
    }
  }

  return (
    <>
      <InstagramStatusPill connection={connection} onClick={() => setOpen(true)} className={className} />
      <InstagramConnectDialog open={open} onOpenChange={setOpen} connection={connection} flow={flow} />
    </>
  )
}

/**
 * Settings → חיבורים → רשתות חברתיות. The Instagram card there owns its own
 * status line and buttons, so it mounts only the modal — the same one the
 * calendar pill opens, with the same connect flow.
 */
export function InstagramConnectDialogHost({
  open,
  onOpenChange,
  startOnDisconnect = false,
  platform = "instagram",
  previewConnection,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  startOnDisconnect?: boolean
  /** YouTube and LinkedIn open this same modal with their own words. */
  platform?: SocialPlatform
  /**
   * Review only: show this connection instead of the live one, with every
   * button inert (no fetch, no popup, nothing disconnected).
   */
  previewConnection?: InstagramConnection
}) {
  const live = useSocialConnections()[platform]
  const connection = previewConnection ?? live
  const liveFlow = useConnectFlow(platform)
  const flow = previewConnection
    ? { ...liveFlow, connect: async () => void toast("תצוגת סקירה — לא נפתח חיבור") }
    : liveFlow
  const { setError } = flow
  useEffect(() => {
    if (open) {
      setError(null)
      // Fresh queued counts before anyone reads "disconnect will cancel N".
      void refreshInstagramConnection()
    }
  }, [open, setError])

  return (
    <InstagramConnectDialog
      open={open}
      onOpenChange={onOpenChange}
      connection={connection}
      flow={flow}
      startOnDisconnect={startOnDisconnect}
      platform={platform}
      inert={!!previewConnection}
    />
  )
}

/** Profile picture of an Instagram account. The URL is Facebook's CDN link,
 *  which expires after a while, so the Instagram glyph stands in whenever it
 *  is missing or fails to load. */
function AccountAvatar({
  src,
  platform = "instagram",
}: {
  src: string | null | undefined
  platform?: SocialPlatform
}) {
  const Icon = NETWORK_ICON[platform]
  return (
    <Avatar size="lg">
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className="bg-bg-surface">
        <Icon className="size-4 text-text-neutral-default" aria-hidden />
      </AvatarFallback>
    </Avatar>
  )
}
