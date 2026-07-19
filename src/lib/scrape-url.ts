// Fetch a URL and return its visible text, capped for LLM input. Special-cases
// Google Docs links (exports as plain text) and strips HTML tags/scripts/styles
// from ordinary pages. Extracted from parse-product-page so both that route and
// the business-sources ingestion share one scraper (no divergence).

const MAX_CHARS = 15000

export class ScrapeError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "ScrapeError"
    this.status = status
  }
}

export async function scrapeUrlToText(url: string): Promise<string> {
  // Detect Google Docs links and export as plain text.
  const googleDocMatch = url.match(
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
  )
  const fetchUrl = googleDocMatch
    ? `https://docs.google.com/document/d/${googleDocMatch[1]}/export?format=txt`
    : url

  let res: Response
  try {
    res = await fetch(fetchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Postudio/1.0; +https://postudio.app)",
      },
    })
  } catch (err) {
    throw new ScrapeError(
      `Cannot access URL: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res.ok) {
    throw new ScrapeError(`Failed to fetch page: ${res.status}`)
  }

  let pageText: string
  if (googleDocMatch) {
    // Google Docs export gives clean text.
    pageText = (await res.text()).trim().slice(0, MAX_CHARS)
  } else {
    const html = await res.text()
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CHARS)
  }

  if (!pageText || pageText.length < 50) {
    throw new ScrapeError("Page has too little text content")
  }

  return pageText
}
