"use client"

/**
 * State preview for Settings → חיבורים (three categories).
 *
 * Route: /test/settings-connections — /settings needs a login, so this page
 * renders the same components (key cards, side nav, social cards) from sample
 * data. No fetches, no DB writes, no connect popups: the buttons are inert.
 *
 *   ?state=writing           — כתיבה (Claude + Gemini connected, Apify not)
 *   ?state=media             — מדיה (OpenAI connected, HeyGen not)
 *   ?state=social-connected  — רשתות חברתיות, Instagram connected
 *   ?state=social-expired    — רשתות חברתיות, Instagram lapsed
 *   ?state=empty             — nothing connected anywhere
 *   (no param)               — all of the above, one under the other
 *
 * The side nav in each frame is live, so any state can be walked to the other
 * categories.
 */

import { Suspense, useState } from "react"
import { notFound, useSearchParams } from "next/navigation"
import {
  ApiKeyCard,
  CATEGORY_KEYS,
  CONNECTION_CATEGORIES,
  KEYS,
  SettingsSubNav,
  SocialNetworksPanel,
  type ConnectionCategory,
  type KeyName,
} from "@/components/settings-connections"
import type { InstagramConnection } from "@/lib/instagram-connection"

type StateId = "writing" | "media" | "social-connected" | "social-expired" | "empty"

const NO_KEYS: Record<KeyName, string | null> = {
  anthropic_api_key: null,
  heygen_api_key: null,
  apify_api_key: null,
  openai_api_key: null,
  gemini_api_key: null,
}

const SOME_KEYS: Record<KeyName, string | null> = {
  anthropic_api_key: "sk-ant-sample-7Qx2",
  heygen_api_key: null,
  apify_api_key: null,
  openai_api_key: "sk-sample-p9Lm",
  gemini_api_key: "AQ.sample-k3Tz",
}

const IG_CONNECTED: InstagramConnection = {
  status: "connected",
  accounts: [],
  primary: { id: "sample", handle: "noa.cohen.consulting", avatarUrl: null, status: "connected", queuedCount: 3 },
}
const IG_EXPIRED: InstagramConnection = {
  status: "disconnected",
  accounts: [],
  primary: { id: "sample", handle: "noa.cohen.consulting", avatarUrl: null, status: "needs_reconnect" },
}
const IG_NONE: InstagramConnection = { status: "disconnected", accounts: [], primary: null }

const STATES: {
  id: StateId
  title: string
  category: ConnectionCategory
  keys: Record<KeyName, string | null>
  instagram: InstagramConnection
}[] = [
  { id: "writing", title: "כתיבה", category: "writing", keys: SOME_KEYS, instagram: IG_CONNECTED },
  { id: "media", title: "מדיה", category: "media", keys: SOME_KEYS, instagram: IG_CONNECTED },
  { id: "social-connected", title: "רשתות חברתיות · אינסטגרם מחובר", category: "social", keys: SOME_KEYS, instagram: IG_CONNECTED },
  { id: "social-expired", title: "רשתות חברתיות · החיבור לאינסטגרם פג", category: "social", keys: SOME_KEYS, instagram: IG_EXPIRED },
  { id: "empty", title: "שום דבר לא מחובר", category: "writing", keys: NO_KEYS, instagram: IG_NONE },
]

const TAB_LABELS = ["חיבורים", "מידע על העסק", "מוצרים", "יוצרים מובילים", "מדיה", "תזמון"]

function SettingsFrame({ state }: { state: (typeof STATES)[number] }) {
  const [category, setCategory] = useState<ConnectionCategory>(state.category)
  const [inputs, setInputs] = useState<Record<KeyName, string>>({
    anthropic_api_key: "",
    heygen_api_key: "",
    apify_api_key: "",
    openai_api_key: "",
    gemini_api_key: "",
  })

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1200px] flex flex-col gap-8">
      <h2 className="text-text-primary-default">הגדרות</h2>
      {/* Static copy of the settings tab bar — only חיבורים is live here. */}
      <div className="flex gap-6 border-b border-border-neutral-default">
        {TAB_LABELS.map((label, i) => (
          <span
            key={label}
            className={`pb-3 text-p ${
              i === 0
                ? "text-text-primary-default border-b-2 border-text-primary-default font-semibold"
                : "text-text-neutral-default"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex gap-8">
        <SettingsSubNav
          sections={CONNECTION_CATEGORIES}
          active={category}
          onChange={(id) => setCategory(id as ConnectionCategory)}
        />
        <div className="flex-1 min-w-0 max-w-lg flex flex-col gap-4">
          {category === "social" ? (
            <SocialNetworksPanel instagramPreview={state.instagram} />
          ) : (
            CATEGORY_KEYS[category].map((keyName) => {
              const cfg = KEYS.find((k) => k.key === keyName)!
              return (
                <ApiKeyCard
                  key={cfg.key}
                  cfg={cfg}
                  stored={state.keys[cfg.key]}
                  inputValue={inputs[cfg.key]}
                  error={null}
                  saving={false}
                  onInputChange={(v) => setInputs((prev) => ({ ...prev, [cfg.key]: v }))}
                  onConnect={() => {}}
                  onDisconnect={() => {}}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function Preview() {
  const params = useSearchParams()
  const requested = params.get("state")
  const shown = STATES.filter((s) => !requested || s.id === requested)

  return (
    <main className="min-h-screen w-full bg-white dark:bg-gray-10 px-6 py-10">
      <div className="mx-auto max-w-[1200px] flex flex-col gap-16">
        <p dir="rtl" className="text-xs-body text-text-neutral-default">
          סביבת בדיקה · /test/settings-connections — נתוני דוגמה בלבד, הכפתורים לא מחברים כלום.
        </p>
        {shown.map((s) => (
          <section key={s.id} className="flex w-full flex-col gap-4">
            {!requested && (
              <h3 dir="rtl" className="text-small-bold text-text-neutral-default">
                {s.title} · <bdi>?state={s.id}</bdi>
              </h3>
            )}
            <SettingsFrame state={s} />
          </section>
        ))}
      </div>
    </main>
  )
}

export default function SettingsConnectionsPreviewPage() {
  // Dev-only. Middleware already puts /test/* behind auth in production; this
  // makes the page not exist there at all.
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
