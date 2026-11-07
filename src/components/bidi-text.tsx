import { Fragment } from "react"

/**
 * Chat text in an RTL bubble: links (and other Latin runs like emails) are
 * isolated left-to-right, so a URL's slashes and punctuation stay where they
 * belong instead of jumping to the wrong end of the line (Hani, 2026-11-07).
 */
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g

export function BidiText({ text }: { text: string }) {
  if (!text) return null
  const parts = text.split(URL_RE)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr" className="break-all">
            {p}
          </bdi>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}
