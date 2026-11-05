"use client"

import { useEffect, useRef, useState } from "react"
import { Link2, Loader2, X } from "lucide-react"
import type { ReferenceImages } from "@/components/ai-edit-reference"

/**
 * A pasted link as a reference (Hani, 2026-11-05). When her words carry a
 * link — an Instagram post, a website — the panel pulls the picture that page
 * shares (api/media/link-reference) and adds it to her references, so she sees
 * exactly what the AI will look at, and can remove it like any screenshot.
 * The link itself stays in her words.
 *
 * Nothing here calls the AI: one page fetch, no credits.
 */

const URL_RE = /https?:\/\/[^\s"'<>]+/gi
/** Links pulled per message — the references cap is 3 anyway. */
const MAX_LINKS = 2

type LinkState =
  | { url: string; host: string; status: "loading" }
  | { url: string; host: string; status: "added"; title: string | null }
  | { url: string; host: string; status: "failed"; message: string }

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

async function dataUrlToFile(dataUrl: string): Promise<File> {
  const [head, b64] = dataUrl.split(",")
  const type = head.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg"
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], "link-reference", { type })
}

/**
 * Watches the composer text; each new link (up to MAX_LINKS) is pulled once.
 * `enabled` = only while the panel asks how to start.
 */
export function useLinkReferences(text: string, refs: ReferenceImages, enabled: boolean) {
  const [links, setLinks] = useState<LinkState[]>([])
  const seen = useRef(new Set<string>())
  const { add } = refs

  useEffect(() => {
    if (!enabled) return
    const found = Array.from(new Set(text.match(URL_RE) ?? [])).map((u) => u.replace(/[.,;:!?)\]]+$/, ""))
    const fresh = found.filter((u) => !seen.current.has(u)).slice(0, Math.max(0, MAX_LINKS - seen.current.size))
    if (!fresh.length) return
    // Wait for the paste / typing to settle.
    const t = setTimeout(() => {
      for (const url of fresh) {
        seen.current.add(url)
        const host = hostOf(url)
        setLinks((prev) => [...prev, { url, host, status: "loading" }])
        void (async () => {
          let next: LinkState
          try {
            const res = await fetch("/api/media/link-reference", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url }),
            })
            const data = (await res.json().catch(() => ({}))) as { image?: string; title?: string | null; message?: string }
            if (!res.ok || !data.image) throw new Error(data.message || "לא הצלחנו לפתוח את הקישור. אפשר לצרף צילום מסך במקום.")
            await add([await dataUrlToFile(data.image)])
            next = { url, host, status: "added", title: data.title ?? null }
          } catch (err) {
            next = {
              url,
              host,
              status: "failed",
              message: err instanceof Error && err.message ? err.message : "לא הצלחנו לפתוח את הקישור.",
            }
          }
          setLinks((prev) => prev.map((l) => (l.url === url ? next : l)))
        })()
      }
    }, 500)
    return () => clearTimeout(t)
  }, [text, enabled, add])

  /** After the message is sent: the next message starts clean. */
  const reset = () => {
    seen.current.clear()
    setLinks([])
  }
  const dismiss = (url: string) => setLinks((prev) => prev.filter((l) => l.url !== url))
  return { links, reset, dismiss, busy: links.some((l) => l.status === "loading") }
}

export type LinkReferences = ReturnType<typeof useLinkReferences>

/** One line per link, above the composer: pulling · added · couldn't. */
export function LinkReferenceRows({ l }: { l: LinkReferences }) {
  if (!l.links.length) return null
  return (
    <ul className="mb-2 flex flex-col gap-1" aria-live="polite">
      {l.links.map((link) => (
        <li
          key={link.url}
          className="flex items-start gap-1.5 rounded-lg bg-bg-surface px-2 py-1.5 text-xs-body text-text-neutral-default"
        >
          {link.status === "loading" ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            {link.status === "loading" && <>מושכים תמונה מ-{link.host}...</>}
            {link.status === "added" && (
              <>
                התמונה מ-{link.host} צורפה כרפרנס
                {link.title && <span className="block truncate text-text-neutral-default">{link.title}</span>}
              </>
            )}
            {link.status === "failed" && (
              <>
                {link.host}: {link.message}
              </>
            )}
          </span>
          {link.status !== "loading" && (
            <button
              type="button"
              onClick={() => l.dismiss(link.url)}
              aria-label="הסתרה"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-gray-95 dark:hover:bg-gray-20"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
