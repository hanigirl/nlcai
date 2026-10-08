"use client"

import { toast } from "sonner"
import type { BusinessSource, BusinessSourceType } from "@/lib/supabase/types"

/**
 * Knowledge sources are read in the background.
 *
 * Reading a long transcript takes up to a minute. Holding the user inside the
 * add dialog for that long was the wrong trade — so the dialog closes at once,
 * a toast at the bottom tracks the read, and she can keep moving through the
 * app. The request lives HERE, at module level, not in the settings panel:
 * the panel unmounts when she navigates away, the module doesn't, so the
 * fetch completes and the toast resolves wherever she is (same approach as
 * hook generation — the toast lives on the layout's <Toaster />).
 *
 * A full page reload still drops the request on the client side; that's the
 * one case this doesn't cover.
 */

export type KnowledgeJob = { id: string; title: string; sourceType: BusinessSourceType }

const ERROR_MESSAGE: Record<string, string> = {
  not_text_file: "אפשר להעלות רק קבצי טקסט: docx, pdf, txt, md, או קובץ תמלול (vtt, srt).",
  link_not_supported: "אפשר להדביק רק קישור ל-Google Doc או לקובץ טקסט בגוגל דרייב.",
  link_not_public: "לא הצלחנו לפתוח את הקובץ. שתפו אותו ל„כל מי שיש לו את הקישור” ונסו שוב.",
  file_unreadable: "לא הצלחנו לקרוא את הקובץ. תומכים ב-docx, pdf, txt, md, vtt, srt.",
  file_too_large: "הקובץ גדול מדי (מקסימום 10MB).",
}

let jobs: KnowledgeJob[] = []
const jobListeners = new Set<() => void>()
const addedListeners = new Set<(source: BusinessSource) => void>()

function setJobs(next: KnowledgeJob[]) {
  jobs = next
  jobListeners.forEach((fn) => fn())
}

/** For useSyncExternalStore — sources currently being read. */
export function subscribeKnowledgeJobs(fn: () => void) {
  jobListeners.add(fn)
  return () => {
    jobListeners.delete(fn)
  }
}
export function getKnowledgeJobs() {
  return jobs
}
const EMPTY: KnowledgeJob[] = []
export function getServerKnowledgeJobs() {
  return EMPTY
}

/** Fires with the saved row once a source finishes (ready, pending or failed). */
export function onKnowledgeSourceAdded(fn: (source: BusinessSource) => void) {
  addedListeners.add(fn)
  return () => {
    addedListeners.delete(fn)
  }
}

export function startKnowledgeSourceJob(opts: {
  title: string
  sourceType: BusinessSourceType
  /** FormData for a file upload, a plain object for a link. */
  body: FormData | { type: BusinessSourceType; url: string; title?: string }
}) {
  const job: KnowledgeJob = {
    id: `knowledge-${crypto.randomUUID()}`,
    title: opts.title,
    sourceType: opts.sourceType,
  }
  setJobs([job, ...jobs])

  toast.loading(`קוראים את „${job.title}”...`, {
    id: job.id,
    description: "אפשר להמשיך לעבוד. נעדכן כשהמקור מוכן.",
    duration: Infinity,
  })

  const init: RequestInit =
    opts.body instanceof FormData
      ? { method: "POST", body: opts.body }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts.body),
        }

  void (async () => {
    try {
      const res = await fetch("/api/business-sources", init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        toast.error(`„${job.title}” לא נוסף`, {
          id: job.id,
          description: ERROR_MESSAGE[data.error] ?? data.message ?? "ההוספה נכשלה. נסו שוב.",
          duration: 10_000,
        })
        return
      }
      const source = data.source as BusinessSource | undefined
      if (source) addedListeners.forEach((fn) => fn(source))

      if (data.warning === "summarize_failed" || source?.status === "failed") {
        toast.error(`לא הצלחנו לקרוא את „${job.title}”`, {
          id: job.id,
          description: "נסו למחוק ולהוסיף שוב.",
          duration: 10_000,
        })
      } else if (data.warning) {
        toast.message(`„${job.title}” נשמר`, { id: job.id, description: data.warning, duration: 10_000 })
      } else {
        const count = source?.insights?.length ?? 0
        toast.success(`„${job.title}” מוכן`, {
          id: job.id,
          description: count > 0 ? `נשלפו ${count} תובנות להוקים ולתכנים.` : undefined,
          duration: 6000,
        })
      }
    } catch (err) {
      console.error("[knowledge-source-jobs]", err)
      toast.error(`„${job.title}” לא נוסף`, {
        id: job.id,
        description: "שגיאת רשת. נסו שוב.",
        duration: 10_000,
      })
    } finally {
      setJobs(jobs.filter((j) => j.id !== job.id))
    }
  })()
}
