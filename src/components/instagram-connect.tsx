"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Instagram, Loader2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Connect an Instagram account, without ever leaving nlcai.
 *
 * The whole flow is: click → a popup runs Instagram's consent screen → it
 * closes → the account is connected. The user never sees, logs into, or holds
 * an account in the system that brokers this; the workspace behind her
 * connection is created for her by the server and she has no login to it.
 *
 * Two details below are the difference between this working and this being a
 * bug report, and neither is obvious:
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

type SocialAccount = {
  id: string
  handle: string | null
  avatarUrl: string | null
  status: "connected" | "needs_reconnect" | "revoked"
}

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

export function InstagramConnect() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Held so the message listener can close the popup once it has answered.
  const popupRef = useRef<Window | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/social/accounts")
      const json = await res.json()
      if (res.ok) setAccounts(json.accounts ?? [])
    } catch {
      // A failed refresh is not worth an error banner — the list simply stays
      // as it was, and the next action retries.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The other half of the popup flow. Mounted for the life of the component
  // rather than only while a popup is open: the listener must already exist
  // when the popup fires, and re-attaching per click risks missing a fast one.
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== PROVIDER_ORIGIN) return

      const data = e.data as ConnectMessage | null
      if (!data || data.page !== "social_media_posting") return
      if (data.platform !== "instagram") return

      popupRef.current?.close()
      popupRef.current = null

      // `aborted` is the user closing the consent screen — a decision, not a
      // failure, so it gets no error banner.
      if (data.error) {
        if (data.error !== "aborted") {
          setError("החיבור לא הושלם. אפשר לנסות שוב.")
        }
        setBusy(false)
        return
      }

      const accountId = accountIdFrom(data)
      if (!accountId) {
        setError("אינסטגרם לא החזירה חשבון. ודאי שהחשבון עסקי או יוצר ומקושר לדף פייסבוק, ונסי שוב.")
        setBusy(false)
        return
      }

      try {
        const res = await fetch("/api/social/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        })
        const json = await res.json()
        if (!res.ok) {
          setError(json.message ?? "לא הצלחנו לשמור את החיבור.")
        } else {
          setError(null)
          await refresh()
        }
      } catch {
        setError("לא הצלחנו לשמור את החיבור.")
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refresh])

  async function handleConnect() {
    setError(null)
    setBusy(true)

    // Opened FIRST, synchronously — see the note at the top of the file.
    const popup = window.open("", "nlcai-instagram-connect", "width=600,height=760")
    if (!popup) {
      setBusy(false)
      setError("הדפדפן חסם את חלון החיבור. אפשרי חלונות קופצים לאתר הזה ונסי שוב.")
      return
    }
    popupRef.current = popup

    try {
      const res = await fetch("/api/social/connect", { method: "POST" })
      const json = await res.json()
      if (!res.ok || !json.url) {
        popup.close()
        popupRef.current = null
        setBusy(false)
        setError(json.message ?? "לא הצלחנו לפתוח את החיבור לאינסטגרם.")
        return
      }
      popup.location.href = json.url
    } catch {
      popup.close()
      popupRef.current = null
      setBusy(false)
      setError("לא הצלחנו לפתוח את החיבור לאינסטגרם.")
    }
  }

  async function handleDisconnect(id: string) {
    setBusy(true)
    setError(null)
    try {
      await fetch(`/api/social/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6">
      <div className="flex items-center justify-between">
        <span className="text-p-bold text-text-primary-default">אינסטגרם</span>
        <Instagram className="size-4 text-text-neutral-default" />
      </div>

      <p className="text-xs-body text-text-neutral-default">
        חיבור החשבון מאפשר לפוסטים שתזמנת ביומן להתפרסם לבד, בשעה שקבעת.
      </p>

      {loading ? (
        <Loader2 className="size-4 animate-spin text-text-neutral-default" />
      ) : accounts.length > 0 ? (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-text-primary-default">
                  {account.handle ?? "חשבון אינסטגרם"}
                </span>
                {account.status === "needs_reconnect" && (
                  <span className="text-xs-body text-button-destructive-default">
                    החיבור פג — צריך לחבר מחדש כדי שהתזמון ימשיך לעבוד
                  </span>
                )}
              </div>

              {account.status === "needs_reconnect" ? (
                <Button size="sm" onClick={handleConnect} disabled={busy} className="w-fit gap-2">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Instagram className="size-4" />}
                  חברי מחדש
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDisconnect(account.id)}
                  disabled={busy}
                  className="w-fit gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                  נתקי
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Button onClick={handleConnect} disabled={busy} className="w-fit gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Instagram className="size-4" />}
          {busy ? "מתחבר..." : "חברי אינסטגרם"}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-xs-body text-button-destructive-default">
          {error}
        </p>
      )}

      <p className="text-xs-body text-text-neutral-default">
        צריך חשבון אינסטגרם מקצועי (עסקי או יוצר) שמקושר לדף פייסבוק.
      </p>
    </div>
  )
}
