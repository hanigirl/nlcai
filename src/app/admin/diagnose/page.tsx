"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

type Type = "core" | "audience"

export default function AdminDiagnosePage() {
  const [userId, setUserId] = useState("")
  const [type, setType] = useState<Type>("audience")
  const [save, setSave] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!userId.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/admin/diagnose-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), type, save }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const r = result as Record<string, unknown> | null

  return (
    <div className="p-8 max-w-3xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl-bold text-text-primary-default">Admin · Diagnose Identity</h1>
      <p className="text-small text-text-neutral-default">
        מקבל user_id ומריץ את הניתוח של core/audience identity מול Anthropic. מציג את התגובה הגולמית כדי להבין למה הניתוח נכשל.
      </p>

      <div className="flex flex-col gap-2 rounded-2xl bg-bg-surface p-4">
        <label className="text-small-bold text-text-primary-default">User ID</label>
        <Input
          dir="ltr"
          placeholder="UUID של המשתמשת"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />

        <label className="text-small-bold text-text-primary-default mt-2">Type</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={type === "audience"}
              onChange={() => setType("audience")}
            />
            <span className="text-small">audience (קהל יעד)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={type === "core"}
              onChange={() => setType("core")}
            />
            <span className="text-small">core (זהות עסקית)</span>
          </label>
        </div>

        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
          />
          <span className="text-small">שמור את התוצאה ב-DB אם הניתוח הצליח</span>
        </label>

        <Button
          size="sm"
          onClick={run}
          disabled={loading || !userId.trim()}
          className="self-end mt-2 gap-2"
        >
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          הרץ אבחון
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-95 p-4 text-small text-button-destructive-default">
          {error}
        </div>
      )}

      {r && (
        <div className="flex flex-col gap-3 rounded-2xl bg-bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-p-bold text-text-primary-default">Verdict:</span>
            <span className="text-small text-text-primary-default">{String(r.verdict)}</span>
          </div>
          <p className="text-small text-text-primary-default">{String(r.message)}</p>

          <div className="grid grid-cols-2 gap-2 text-small text-text-neutral-default">
            <div>has_anthropic_key: <b>{String(r.has_anthropic_key)}</b></div>
            <div>has_identity_row: <b>{String(r.has_identity_row)}</b></div>
            <div>raw_text_length: <b>{String(r.raw_text_length)}</b></div>
            <div>filled_fields_count: <b>{String(r.filled_fields_count ?? "—")}</b></div>
            <div>raw_response_length: <b>{String(r.raw_response_length ?? "—")}</b></div>
            <div>stop_reason: <b>{String(r.stop_reason ?? "—")}</b></div>
            <div>saved: <b>{String(r.saved ?? "—")}</b></div>
          </div>

          {r.claude_error ? (
            <div>
              <div className="text-small-bold text-button-destructive-default">Anthropic error:</div>
              <pre className="bg-white dark:bg-gray-10 p-2 rounded-lg text-xs overflow-auto whitespace-pre-wrap" dir="ltr">
                {String(r.claude_error)}
              </pre>
            </div>
          ) : null}

          {r.parse_error ? (
            <div>
              <div className="text-small-bold text-button-destructive-default">JSON parse error:</div>
              <pre className="bg-white dark:bg-gray-10 p-2 rounded-lg text-xs overflow-auto whitespace-pre-wrap" dir="ltr">
                {String(r.parse_error)}
              </pre>
            </div>
          ) : null}

          {r.raw_response ? (
            <details>
              <summary className="text-small-bold cursor-pointer text-text-primary-default">תגובת Claude (raw)</summary>
              <pre className="bg-white dark:bg-gray-10 p-2 rounded-lg text-xs overflow-auto whitespace-pre-wrap mt-2 max-h-96" dir="ltr">
                {String(r.raw_response)}
              </pre>
            </details>
          ) : null}

          {r.parsed ? (
            <details>
              <summary className="text-small-bold cursor-pointer text-text-primary-default">parsed JSON</summary>
              <pre className="bg-white dark:bg-gray-10 p-2 rounded-lg text-xs overflow-auto whitespace-pre-wrap mt-2 max-h-96" dir="ltr">
                {JSON.stringify(r.parsed, null, 2)}
              </pre>
            </details>
          ) : null}

          <details>
            <summary className="text-small-bold cursor-pointer text-text-neutral-default">raw_text_preview + media files</summary>
            <pre className="bg-white dark:bg-gray-10 p-2 rounded-lg text-xs overflow-auto whitespace-pre-wrap mt-2 max-h-96" dir="auto">
              {String(r.raw_text_preview ?? "")}
              {"\n\n--- media ---\n"}
              {JSON.stringify(r.media_files, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
