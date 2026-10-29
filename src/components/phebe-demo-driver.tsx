"use client"

/**
 * The app's side of Phebe's live demo — see lib/phebe-demo.ts for the rules.
 *
 * Phebe sends steps by postMessage (navigate, point, click, type, key,
 * clickOutside, scroll, caption, openPost); this component performs them with
 * a visible cursor and answers each one. Mounted in the root layout, it does
 * nothing at all unless the page is inside a frame or a window Phebe opened.
 */

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import {
  DEMO_EMAILS,
  DEMO_PARAM,
  DEMO_SESSION_KEY,
  FORBIDDEN_LABELS,
  SAFE_REAL_CLICKS,
  isPhebeOrigin,
} from "@/lib/phebe-demo"

type Target = {
  /** [data-demo="…"] */
  demo?: string
  /** CSS selector, inside `demo` when both are given. */
  pick?: string
  selector?: string
  /** Visible text (or aria-label) of the element, inside `within` if given. */
  text?: string
  within?: string
  nth?: number
}

type Step =
  | { do: "navigate"; path: string }
  | { do: "point"; target: Target; say?: string; ms?: number }
  | { do: "click"; target: Target; say?: string }
  | { do: "type"; target: Target; text: string }
  | { do: "key"; key: string }
  | { do: "clickOutside" }
  | { do: "scroll"; target?: Target; by?: number }
  | { do: "caption"; text: string; ms?: number }
  | { do: "wait"; ms: number }
  | { do: "openPost"; pick?: "latest-clean" }
  | { do: "reset" }

type Incoming = { type: "phebe-demo"; id: string; cmd: "hello" } | { type: "phebe-demo"; id: string; cmd: "run"; step: Step }

const embedded = () => typeof window !== "undefined" && (window.parent !== window || !!window.opener)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const onTestPage = () => window.location.pathname.startsWith("/test/")

// ---------------------------------------------------------------------------
// Read-only guard. Installed before the page renders whenever the page was
// opened by Phebe (?phebe_demo=1, remembered for the frame's session), so the
// Supabase client and every fetch made by the page go through it.
// ---------------------------------------------------------------------------

let guardOn = false
function installReadOnlyGuard() {
  if (guardOn || typeof window === "undefined") return
  guardOn = true
  const realFetch = window.fetch.bind(window)
  const allowed = (url: string, method: string) => {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true
    // Keeps her signed in (token refresh) — not a write to her data.
    return /\/auth\/v1\/token(\?|$)/.test(url)
  }
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (!allowed(url, method)) {
      console.info("[phebe-demo] blocked", method, url)
      // The app's own autosaves (opening a post re-saves its texts) answer
      // "ok" so no "save failed" toast lands in the middle of the demo —
      // nothing was sent. Anything else is refused outright.
      const own = new URL(url, window.location.href)
      const autosave = own.origin === window.location.origin && own.pathname.startsWith("/api/core-posts/")
      return Promise.resolve(
        new Response(JSON.stringify(autosave ? { ok: true, demo_read_only: true } : { error: "demo_read_only" }), {
          status: autosave ? 200 : 403,
          headers: { "Content-Type": "application/json" },
        }),
      )
    }
    return realFetch(input, init)
  }) as typeof fetch
  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __m?: string }, method: string, ...rest: unknown[]) {
    this.__m = String(method).toUpperCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (open as any).call(this, method, ...rest)
  }
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __m?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
    if (this.__m && !["GET", "HEAD", "OPTIONS"].includes(this.__m)) {
      console.info("[phebe-demo] blocked xhr", this.__m)
      this.abort()
      return
    }
    return send.call(this, body)
  }
  if (navigator.sendBeacon) navigator.sendBeacon = () => false
}

if (typeof window !== "undefined" && embedded()) {
  try {
    if (new URLSearchParams(window.location.search).get(DEMO_PARAM) === "1") {
      window.sessionStorage.setItem(DEMO_SESSION_KEY, "1")
    }
    if (window.sessionStorage.getItem(DEMO_SESSION_KEY) === "1") installReadOnlyGuard()
  } catch {
    // storage blocked — the guard still goes on with the first hello
  }
}

// ---------------------------------------------------------------------------
// Finding elements
// ---------------------------------------------------------------------------

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const s = window.getComputedStyle(el)
  return s.visibility !== "hidden" && s.display !== "none"
}

function labelOf(el: Element): string {
  return (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim()
}

function findOnce(t: Target): HTMLElement | null {
  let scope: ParentNode = document
  if (t.demo) {
    const all = [...document.querySelectorAll<HTMLElement>(`[data-demo="${CSS.escape(t.demo)}"]`)].filter(visible)
    const host = all[t.pick || t.text ? 0 : (t.nth ?? 0)]
    if (!host) return null
    if (!t.pick && !t.text) return host
    scope = host
  } else if (t.within) {
    const host = [...document.querySelectorAll(t.within)].find(visible)
    if (!host) return null
    scope = host
  }
  if (t.pick || t.selector) {
    const list = [...scope.querySelectorAll<HTMLElement>((t.pick ?? t.selector)!)].filter(visible)
    return list[t.nth ?? 0] ?? null
  }
  if (t.text) {
    const want = t.text.replace(/\s+/g, " ").trim()
    const candidates = [...scope.querySelectorAll<HTMLElement>("button, a, [role=button], [role=tab], label, input, textarea, select, li, p, span, h1, h2, h3, div")]
      .filter(visible)
      .filter((el) => labelOf(el).includes(want))
    // The innermost match: the element closest to the words themselves.
    const inner = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)))
    const clickable = inner.map((el) => (el.closest("button, a, [role=button], [role=tab]") as HTMLElement | null) ?? el)
    return clickable[t.nth ?? 0] ?? null
  }
  return null
}

async function find(t: Target, timeout = 8000): Promise<HTMLElement> {
  const end = Date.now() + timeout
  for (;;) {
    const el = findOnce(t)
    if (el) return el
    if (Date.now() > end) throw new Error(`not found: ${JSON.stringify(t)}`)
    await sleep(150)
  }
}

// ---------------------------------------------------------------------------
// The visible cursor, highlight and caption
// ---------------------------------------------------------------------------

const CURSOR_ID = "phebe-demo-cursor"
let cursorX = 0
let cursorY = 0

function overlay() {
  let root = document.getElementById(CURSOR_ID)
  if (root) return root
  root = document.createElement("div")
  root.id = CURSOR_ID
  root.setAttribute("aria-hidden", "true")
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
  root.innerHTML = `
    <div data-ring style="position:fixed;border:3px solid #F5C518;border-radius:12px;box-shadow:0 0 0 6px rgba(245,197,24,.25);opacity:0;transition:all .35s ease"></div>
    <div data-cursor style="position:fixed;left:0;top:0;width:28px;height:28px;transform:translate(${innerWidth / 2}px,${innerHeight / 2}px);transition:transform .7s cubic-bezier(.4,.1,.2,1);opacity:0">
      <svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2l7.5 19 2.6-7.4L21 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <div data-ripple style="position:absolute;left:-14px;top:-14px;width:32px;height:32px;border-radius:50%;background:rgba(245,197,24,.55);transform:scale(0);opacity:0"></div>
    </div>
    <div data-caption dir="rtl" style="position:fixed;max-width:280px;padding:8px 12px;border-radius:12px;background:#111;color:#fff;font:600 14px/1.4 Rubik,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .25s ease, transform .35s ease"></div>`
  document.body.appendChild(root)
  cursorX = innerWidth / 2
  cursorY = innerHeight / 2
  return root
}

const part = (name: string) => overlay().querySelector<HTMLElement>(`[data-${name}]`)!

async function moveCursorTo(x: number, y: number) {
  const c = part("cursor")
  c.style.opacity = "1"
  const nx = Math.max(8, Math.min(innerWidth - 20, x))
  const ny = Math.max(8, Math.min(innerHeight - 20, y))
  const far = Math.hypot(nx - cursorX, ny - cursorY) > 4
  c.style.transform = `translate(${nx}px,${ny}px)`
  cursorX = nx
  cursorY = ny
  if (far) await sleep(750)
}

function ring(el: HTMLElement | null) {
  const r = part("ring")
  if (!el) {
    r.style.opacity = "0"
    return
  }
  const b = el.getBoundingClientRect()
  r.style.left = `${b.left - 6}px`
  r.style.top = `${b.top - 6}px`
  r.style.width = `${b.width + 12}px`
  r.style.height = `${b.height + 12}px`
  r.style.opacity = "1"
}

function caption(text: string | null) {
  const c = part("caption")
  if (!text) {
    c.style.opacity = "0"
    return
  }
  c.textContent = text
  const left = Math.min(Math.max(12, cursorX - 140), innerWidth - 300)
  const top = cursorY + 40 > innerHeight - 80 ? cursorY - 70 : cursorY + 36
  c.style.left = `${left}px`
  c.style.top = `${top}px`
  c.style.opacity = "1"
}

async function ripple() {
  const r = part("ripple")
  r.animate(
    [
      { transform: "scale(0)", opacity: 0.9 },
      { transform: "scale(1.6)", opacity: 0 },
    ],
    { duration: 450, easing: "ease-out" },
  )
  await sleep(250)
}

async function pointAt(el: HTMLElement, say?: string) {
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
  await sleep(450)
  const b = el.getBoundingClientRect()
  await moveCursorTo(b.left + b.width / 2, b.top + b.height / 2)
  ring(el)
  caption(say ?? null)
}

function fire(el: Element, type: string, x: number, y: number) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }
  const ev = type.startsWith("pointer")
    ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
    : new MouseEvent(type, init)
  el.dispatchEvent(ev)
}

function assertSafeClick(el: HTMLElement) {
  const label = labelOf(el)
  if (onTestPage()) return
  const host = el.closest<HTMLElement>("[data-demo]")
  const name = host?.dataset.demo
  if (!name || !SAFE_REAL_CLICKS.has(name)) throw new Error(`refused: not a safe click on a real page (${label.slice(0, 40)})`)
  if (FORBIDDEN_LABELS.includes(label)) throw new Error(`refused: "${label}" changes data`)
}

async function clickEl(el: HTMLElement, say?: string) {
  assertSafeClick(el)
  await pointAt(el, say)
  const b = el.getBoundingClientRect()
  const x = b.left + b.width / 2
  const y = b.top + b.height / 2
  await ripple()
  fire(el, "pointerdown", x, y)
  fire(el, "mousedown", x, y)
  fire(el, "pointerup", x, y)
  fire(el, "mouseup", x, y)
  el.click()
  await sleep(300)
  // What was clicked may have turned into something else in the same spot.
  ring(null)
}

async function typeInto(el: HTMLElement, text: string) {
  await pointAt(el)
  ring(null)
  const field = el.matches("input, textarea") ? (el as HTMLInputElement | HTMLTextAreaElement) : el.querySelector<HTMLTextAreaElement>("textarea, input")
  if (!field) throw new Error("no text field there")
  field.focus()
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, "value")?.set
  // Word by word: reads as typing, and stays quick even where the browser
  // slows timers down (a frame in a window that isn't focused).
  const words = text.split(/(?<=\s)/)
  let value = ""
  for (const w of words) {
    value += w
    set?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await sleep(160)
  }
}

// ---------------------------------------------------------------------------
// Her latest post with no dashes in it (for "no dashes in generated posts")
// ---------------------------------------------------------------------------

const DASH = /[–—]| - /
async function latestCleanPostPath(): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await getCurrentUser(supabase)
  if (!user) throw new Error("not signed in")
  const { data, error } = await supabase
    .from("core_posts")
    .select("id, body, created_at, format_variants!inner(body)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as Array<{ id: string; body: string; format_variants: Array<{ body: string }> }>
  const clean = rows.find((r) => !DASH.test(r.body ?? "") && r.format_variants.every((v) => !DASH.test(v.body ?? "")))
  const pick = clean ?? rows[0]
  if (!pick) throw new Error("no posts")
  return `/project?post_id=${pick.id}`
}

// ---------------------------------------------------------------------------

function withDemoParam(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("same-site paths only")
  const url = new URL(path, window.location.origin)
  url.searchParams.set(DEMO_PARAM, "1")
  return url.pathname + url.search + url.hash
}

async function run(step: Step): Promise<unknown> {
  switch (step.do) {
    case "navigate":
      window.location.assign(withDemoParam(step.path))
      return { navigating: true }
    case "openPost": {
      const path = await latestCleanPostPath()
      window.location.assign(withDemoParam(path))
      return { navigating: true }
    }
    case "point": {
      const el = await find(step.target)
      await pointAt(el, step.say)
      if (step.ms) await sleep(step.ms)
      return null
    }
    case "click": {
      const el = await find(step.target)
      await clickEl(el, step.say)
      return null
    }
    case "type": {
      const el = await find(step.target)
      await typeInto(el, step.text)
      return null
    }
    case "key": {
      const target = document.activeElement ?? document.body
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, { key: step.key, bubbles: true, cancelable: true }))
      }
      await sleep(300)
      return null
    }
    case "clickOutside": {
      ring(null)
      caption(null)
      const x = Math.round(innerWidth * 0.12)
      const y = Math.round(innerHeight * 0.5)
      await moveCursorTo(x, y)
      await ripple()
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(document.body, type, x, y)
      await sleep(300)
      return null
    }
    case "scroll": {
      if (step.target) (await find(step.target)).scrollIntoView({ block: "center", behavior: "smooth" })
      else window.scrollBy({ top: step.by ?? 400, behavior: "smooth" })
      await sleep(600)
      return null
    }
    case "caption":
      caption(step.text)
      if (step.ms) await sleep(step.ms)
      return null
    case "wait":
      await sleep(Math.min(step.ms, 15000))
      return null
    case "reset":
      ring(null)
      caption(null)
      return null
  }
}

async function whoAmI(): Promise<{ signedIn: boolean; allowed: boolean }> {
  try {
    const {
      data: { user },
    } = await getCurrentUser(createClient())
    const email = user?.email?.toLowerCase() ?? null
    // Local dev: the /test pages are open without signing in, so allow them there.
    const devTest = process.env.NODE_ENV !== "production" && onTestPage()
    return { signedIn: !!user, allowed: (!!email && DEMO_EMAILS.includes(email)) || devTest }
  } catch {
    return { signedIn: false, allowed: false }
  }
}

export function PhebeDemoDriver() {
  useEffect(() => {
    if (!embedded()) return
    let busy = false
    const onMessage = async (e: MessageEvent) => {
      if (!isPhebeOrigin(e.origin)) return
      const msg = e.data as Incoming
      if (!msg || msg.type !== "phebe-demo" || typeof msg.id !== "string") return
      const reply = (body: Record<string, unknown>) =>
        (e.source as WindowProxy | null)?.postMessage({ type: "nlcai-demo", id: msg.id, ...body }, e.origin)

      const me = await whoAmI()
      if (msg.cmd === "hello") {
        if (me.allowed) {
          try {
            window.sessionStorage.setItem(DEMO_SESSION_KEY, "1")
          } catch {}
          installReadOnlyGuard()
        }
        reply({ ok: true, info: { ...me, path: window.location.pathname + window.location.search } })
        return
      }
      if (!me.allowed) {
        reply({ ok: false, error: me.signedIn ? "not_allowed" : "signed_out" })
        return
      }
      if (busy) {
        reply({ ok: false, error: "busy" })
        return
      }
      busy = true
      installReadOnlyGuard()
      try {
        const info = await run(msg.step)
        reply({ ok: true, info })
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) })
      } finally {
        busy = false
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])
  return null
}
