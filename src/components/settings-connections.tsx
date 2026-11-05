"use client"

/**
 * Settings → חיבורים, split into three categories (Hani, 2026-11-05):
 *
 *   כתיבה          — Claude, Apify, Gemini   (the keys behind ideas, hooks, posts)
 *   מדיה           — OpenAI, HeyGen          (the keys behind images and video)
 *   רשתות חברתיות  — Instagram, TikTok, LinkedIn, YouTube, stacked on one page
 *
 * The key cards are the ones Settings always had — moved here so the settings
 * page and the /test/settings-connections preview render the same markup, not
 * restyled.
 *
 * Old deep links name a single service (`?tab=connections&sub=openai`). They
 * still work: `resolveConnectionsSub` maps the service to its category, and the
 * page scrolls to that service's card (`connectionAnchorId`).
 */

import { useState, type ComponentType, type SVGProps } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Image as ImageIcon,
  Instagram,
  Link2,
  Linkedin,
  Loader2,
  PenLine,
  RefreshCw,
  Share2,
  Unlink,
  Youtube,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isLegacyGeminiKey } from "@/lib/api-keys"
import { useSocialConnections, type InstagramConnection } from "@/lib/instagram-connection"
import { NETWORK_CONNECT_NOTE, InstagramConnectDialogHost } from "@/components/instagram-connect"

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

export type KeyName = "anthropic_api_key" | "heygen_api_key" | "apify_api_key" | "openai_api_key" | "gemini_api_key"

export interface KeyConfig {
  key: KeyName
  /** The legacy `?sub=` id for this key — also its scroll anchor. */
  sub: string
  label: string
  placeholder: string
  helpUrl: string
  helpLabel: string
}

export const KEYS: KeyConfig[] = [
  {
    key: "anthropic_api_key",
    sub: "claude",
    label: "Claude API Key",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpLabel: "console.anthropic.com",
  },
  {
    key: "heygen_api_key",
    sub: "heygen",
    label: "HeyGen API Key",
    placeholder: "הכניסו את ה-API key שלכם",
    helpUrl: "https://app.heygen.com/settings?nav=API",
    helpLabel: "app.heygen.com",
  },
  {
    key: "apify_api_key",
    sub: "apify",
    label: "Apify API Key",
    placeholder: "apify_api_...",
    helpUrl: "https://console.apify.com/settings/integrations",
    helpLabel: "console.apify.com",
  },
  {
    key: "openai_api_key",
    sub: "openai",
    label: "OpenAI API Key",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpLabel: "platform.openai.com",
  },
  {
    key: "gemini_api_key",
    sub: "gemini",
    label: "Gemini API Key",
    // AI Studio issues "AQ." auth keys today; "AIza" is the legacy format
    // still in circulation until Google retires it. Show both so neither
    // looks wrong.
    placeholder: "AQ.... / AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    helpLabel: "aistudio.google.com",
  },
]

export function maskKey(key: string): string {
  if (key.length <= 4) return "••••"
  return "••••••" + key.slice(-4)
}

// ---------------------------------------------------------------------------
// categories + deep links
// ---------------------------------------------------------------------------

export type ConnectionCategory = "writing" | "media" | "social"

export const CONNECTION_CATEGORIES: { id: ConnectionCategory; label: string; icon: typeof Link2 }[] = [
  // First on purpose: the tab opens on whichever category leads this list,
  // and the writing keys are what every existing user came here for.
  { id: "writing", label: "כתיבה", icon: PenLine },
  { id: "media", label: "מדיה", icon: ImageIcon },
  { id: "social", label: "רשתות חברתיות", icon: Share2 },
]

/** Which keys sit on each key category, in display order. */
export const CATEGORY_KEYS: Record<Exclude<ConnectionCategory, "social">, KeyName[]> = {
  writing: ["anthropic_api_key", "apify_api_key", "gemini_api_key"],
  media: ["openai_api_key", "heygen_api_key"],
}

/** The pre-categories `?sub=` ids, and the category each one now lives in. */
const LEGACY_SUBS: Record<string, ConnectionCategory> = {
  claude: "writing",
  apify: "writing",
  gemini: "writing",
  openai: "media",
  heygen: "media",
  instagram: "social",
  tiktok: "social",
  linkedin: "social",
  youtube: "social",
}

/**
 * `?sub=` on the connections tab → the category to open, plus the card to
 * scroll to when the link named a single service. Unknown or missing → the
 * first category, no scroll.
 */
export function resolveConnectionsSub(sub: string): { category: ConnectionCategory; anchor: string | null } {
  if (CONNECTION_CATEGORIES.some((c) => c.id === sub)) return { category: sub as ConnectionCategory, anchor: null }
  const category = LEGACY_SUBS[sub]
  if (category) return { category, anchor: sub }
  return { category: CONNECTION_CATEGORIES[0].id, anchor: null }
}

export function connectionAnchorId(sub: string): string {
  return `connection-${sub}`
}

// ---------------------------------------------------------------------------
// side nav — shared by every settings tab
// ---------------------------------------------------------------------------

export function SettingsSubNav({
  sections,
  active,
  onChange,
}: {
  sections: { id: string; label: string; icon: typeof Link2 }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <nav className="w-[200px] shrink-0 flex flex-col gap-1">
      {sections.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          aria-current={active === item.id ? "page" : undefined}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer text-start ${
            active === item.id
              ? "bg-bg-surface-primary-default text-yellow-20 font-medium"
              : "text-text-neutral-default hover:bg-bg-surface hover:text-text-primary-default"
          }`}
        >
          <item.icon className="size-4 shrink-0" />
          {item.label}
        </button>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// one key card — the block Settings always had, unchanged
// ---------------------------------------------------------------------------

export function ApiKeyCard({
  cfg,
  stored,
  inputValue,
  error,
  saving,
  onInputChange,
  onConnect,
  onDisconnect,
}: {
  cfg: KeyConfig
  stored: string | null
  inputValue: string
  error: string | null
  saving: boolean
  onInputChange: (value: string) => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  const errorId = `${cfg.key}-error`
  const showLegacyGeminiWarning = cfg.key === "gemini_api_key" && isLegacyGeminiKey(stored)
  return (
    <div
      id={connectionAnchorId(cfg.sub)}
      className="flex scroll-mt-6 flex-col gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6"
    >
      <div className="flex items-center justify-between">
        <span className="text-p-bold text-text-primary-default">{cfg.label}</span>
        {stored && <span className="text-xs-body text-text-neutral-default font-mono">{maskKey(stored)}</span>}
      </div>
      {stored ? (
        <div className="flex flex-col gap-3">
          <Button size="sm" variant="outline" onClick={onDisconnect} disabled={saving} className="w-fit gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
            {saving ? "מנתק..." : "נתק"}
          </Button>
          {/* Google retires the legacy "AIza" key format in September 2026.
              Warn now, while she can replace it calmly, instead of letting
              hook generation die mid-flow later. */}
          {showLegacyGeminiWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-80 bg-bg-surface-primary-default px-3 py-2.5 dark:border-yellow-30">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-yellow-30 dark:text-yellow-80" aria-hidden="true" />
              <p className="text-xs-body text-text-primary-default leading-relaxed">
                המפתח המחובר הוא מהסוג הישן של Google (מתחיל ב-<bdi>AIza</bdi>), שיפסיק לעבוד בספטמבר 2026.
                היכנסו ל-{" "}
                <a href={cfg.helpUrl} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{cfg.helpLabel}</a>
                , צרו מפתח חדש (מתחיל ב-<bdi>AQ.</bdi>) והחליפו אותו כאן.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              dir="ltr"
              placeholder={cfg.placeholder}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="flex-1"
            />
            <Button size="sm" onClick={onConnect} disabled={!inputValue.trim() || saving} className="gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {saving ? "מתחבר..." : "חבר"}
            </Button>
          </div>
          {error && (
            <div id={errorId} role="alert" className="flex items-start gap-2 rounded-xl border border-red-90 bg-red-95 px-3 py-2.5 dark:border-red-90/25 dark:bg-red-95/10">
              <AlertCircle className="size-4 shrink-0 mt-0.5 text-button-danger-default" aria-hidden="true" />
              <p className="text-xs-body text-text-primary-default leading-relaxed">{error}</p>
            </div>
          )}
          <p className="text-xs-body text-text-neutral-default">
            מצאו את ה-API key שלכם ב-{" "}
            <a href={cfg.helpUrl} target="_blank" rel="noopener noreferrer" className="text-text-primary-default font-semibold hover:underline">{cfg.helpLabel}</a>
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// social networks
// ---------------------------------------------------------------------------

/**
 * The networks the רשתות חברתיות page lists. Instagram, YouTube and LinkedIn
 * are live (2026-11-05); TikTok stays "בקרוב" until there is an account to
 * test it end to end with.
 */
export type SocialNetworkId = "instagram" | "tiktok" | "linkedin" | "youtube"

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>

/** TikTok's note mark — lucide has no TikTok glyph. Inherits currentColor. */
function TikTokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48Z" />
    </svg>
  )
}

export const SOCIAL_NETWORKS: { id: SocialNetworkId; label: string; icon: IconComponent }[] = [
  { id: "instagram", label: "אינסטגרם", icon: Instagram },
  { id: "tiktok", label: "TikTok", icon: TikTokIcon },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin },
  { id: "youtube", label: "YouTube", icon: Youtube },
]

export type SocialConnectionState = "loading" | "connected" | "disconnected" | "expired"

/**
 * One network, one card. Presentational: whoever renders it decides what
 * connect / disconnect do. A network with no `onConnect` is "coming soon" —
 * the button is there, disabled, with a בקרוב badge.
 */
export function SocialConnectionCard({
  network,
  state,
  handle,
  busy = false,
  onConnect,
  onDisconnect,
  note,
  handleStyle = "at",
}: {
  network: (typeof SOCIAL_NETWORKS)[number]
  state: SocialConnectionState
  handle?: string | null
  /** Instagram handles read "@name"; a YouTube channel or LinkedIn name has no "@". */
  handleStyle?: "at" | "plain"
  busy?: boolean
  onConnect?: () => void
  onDisconnect?: () => void
  note?: string
}) {
  const Icon = network.icon
  const comingSoon = !onConnect
  const statusId = `social-${network.id}-status`
  const cleanHandle = handle?.replace(/^@/, "") ?? null

  return (
    <div
      id={connectionAnchorId(network.id)}
      className="flex scroll-mt-6 flex-col gap-3 rounded-2xl border border-border-neutral-default bg-white dark:bg-gray-10 p-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-surface">
          <Icon className="size-5 text-text-primary-default" aria-hidden />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-p-bold text-text-primary-default">{network.label}</span>
            {comingSoon && <Badge variant="outline" className="text-text-neutral-default">בקרוב</Badge>}
          </div>
          {state === "loading" ? (
            <span aria-hidden className="h-4 w-28 animate-pulse rounded bg-gray-95 dark:bg-gray-20" />
          ) : (
            <span
              id={statusId}
              className={cn(
                "flex items-center gap-1.5 text-xs-body",
                state === "expired" ? "text-button-destructive-default" : "text-text-neutral-default",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  state === "connected"
                    ? "bg-bg-surface-success-default"
                    : state === "expired"
                      ? "bg-button-destructive-default"
                      : "bg-gray-80 dark:bg-gray-40",
                )}
              />
              <span className="truncate">
                {state === "connected" ? (
                  cleanHandle ? (
                    <>
                      מחובר בתור <bdi>{handleStyle === "at" ? `@${cleanHandle}` : cleanHandle}</bdi>
                    </>
                  ) : (
                    "מחובר"
                  )
                ) : state === "expired" ? (
                  "החיבור פג — צריך להתחבר מחדש"
                ) : (
                  "לא מחובר"
                )}
              </span>
            </span>
          )}
        </div>

        {state === "loading" ? null : state === "connected" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onDisconnect}
            disabled={busy || !onDisconnect}
            aria-label={`ניתוק ${network.label}`}
            aria-describedby={statusId}
            className="gap-2 border-button-destructive-default text-button-destructive-default hover:bg-red-95"
          >
            <Unlink className="size-4" />
            ניתוק
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onConnect}
            disabled={busy || comingSoon}
            aria-label={`${state === "expired" ? "חיבור מחדש של" : "חיבור"} ${network.label}${comingSoon ? " (בקרוב)" : ""}`}
            aria-describedby={statusId}
            className="gap-2"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : state === "expired" ? (
              <RefreshCw className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
            {state === "expired" ? "חיבור מחדש" : "חיבור"}
          </Button>
        )}
      </div>

      {note && <p className="text-xs-body text-text-neutral-default">{note}</p>}
    </div>
  )
}

/** Instagram's store answer → the card's state. A lapsed account is "expired". */
export function instagramCardState(connection: InstagramConnection): {
  state: SocialConnectionState
  handle: string | null
  available: boolean
} {
  const account = connection.primary
  if (connection.status === "loading") return { state: "loading", handle: null, available: true }
  if (connection.status === "unavailable") return { state: "disconnected", handle: null, available: false }
  if (connection.status === "connected") return { state: "connected", handle: account?.handle ?? null, available: true }
  if (account?.status === "needs_reconnect") return { state: "expired", handle: account.handle, available: true }
  return { state: "disconnected", handle: null, available: true }
}

/** The networks that connect today. TikTok is listed but not among them. */
const LIVE_NETWORKS = ["instagram", "youtube", "linkedin"] as const
type LiveNetworkId = (typeof LIVE_NETWORKS)[number]

/** Settings card notes: Instagram keeps Hani's Facebook-page copy. */
const CARD_NOTE: Partial<Record<LiveNetworkId, string>> = {
  instagram: NETWORK_CONNECT_NOTE.instagram,
}

/**
 * One live network card: the shared store + the shared connect modal. The
 * Instagram card exactly as built; YouTube and LinkedIn are the same card and
 * the same modal with their own words.
 */
function LiveNetworkCard({ id }: { id: LiveNetworkId }) {
  const connection = useSocialConnections()[id]
  const [dialog, setDialog] = useState<null | "connect" | "disconnect">(null)
  const { state, handle, available } = instagramCardState(connection)
  const network = SOCIAL_NETWORKS.find((n) => n.id === id)!

  return (
    <>
      <SocialConnectionCard
        network={network}
        state={state}
        handle={handle}
        handleStyle={id === "instagram" ? "at" : "plain"}
        onConnect={available ? () => setDialog("connect") : undefined}
        onDisconnect={() => setDialog("disconnect")}
        note={CARD_NOTE[id]}
      />
      <InstagramConnectDialogHost
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        startOnDisconnect={dialog === "disconnect"}
        platform={id}
      />
    </>
  )
}

/**
 * The רשתות חברתיות page. `preview` swaps the live cards for static ones —
 * the /test preview uses it so nothing fetches or opens. `instagramPreview`
 * is the older single-network form of the same thing.
 */
export function SocialNetworksPanel({
  instagramPreview,
  preview,
}: {
  instagramPreview?: InstagramConnection
  preview?: Partial<Record<LiveNetworkId, InstagramConnection>>
}) {
  const previews = preview ?? (instagramPreview ? { instagram: instagramPreview } : null)
  const tiktok = SOCIAL_NETWORKS.find((n) => n.id === "tiktok")!
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-text-neutral-default">
        חיבור החשבונות מאפשר לפוסטים שתזמנתם ביומן להתפרסם לבד, בשעה שקבעתם.
      </p>
      {LIVE_NETWORKS.map((id) => {
        if (!previews) return <LiveNetworkCard key={id} id={id} />
        const p = instagramCardState(previews[id] ?? { status: "disconnected", accounts: [], primary: null })
        return (
          <SocialConnectionCard
            key={id}
            network={SOCIAL_NETWORKS.find((n) => n.id === id)!}
            state={p.state}
            handle={p.handle}
            handleStyle={id === "instagram" ? "at" : "plain"}
            onConnect={() => {}}
            onDisconnect={() => {}}
            note={CARD_NOTE[id]}
          />
        )
      })}
      {/* No account to test it with yet — stays "בקרוב". */}
      <SocialConnectionCard network={tiktok} state="disconnected" />
    </div>
  )
}
