"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Monitor, Play } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getCurrentUser } from "@/lib/supabase/current-user"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  DriveThumb,
  FORMAT_FOLDER,
  loadDriveFolders,
  refreshDriveFolder,
  useDrivePickStore,
  type DriveMediaItem,
} from "@/components/drive-folder-review"

/**
 * "החלפת תמונה" on a visual-language b-roll (Hani, 2026-11-10, gated):
 * after the first generation, another picture — from her Drive b-roll folder
 * or her computer — takes the photo's place, blended by the same recipe
 * (api/b-roll/swap-photo). The Drive gallery is the one the AI panel's
 * "מגוגל דרייב" uses; pictures only.
 */

/** Phone photos are big; the server needs ~1600px. */
function shrink(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement("canvas")
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL("image/jpeg", 0.88))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

export function BRollPhotoSwapDialog({
  open,
  onOpenChange,
  postId,
  onSwapped,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  postId: string | null
  /** The new clip — the card and the panel show it. */
  onSwapped: (url: string) => void
}) {
  const folder = useDrivePickStore().folders[FORMAT_FOLDER.b_roll]
  const [picked, setPicked] = useState<DriveMediaItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    void loadDriveFolders().then(() => refreshDriveFolder(FORMAT_FOLDER.b_roll))
  }, [open])

  const swap = async (body: { driveId: string; kind: "image" | "video" } | { image: string } | { video: string }) => {
    if (!postId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/b-roll/swap-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, ...body }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string }
      if (!res.ok || !data.url) throw new Error(data.message || "ההחלפה לא הצליחה הפעם. נסו שוב.")
      onSwapped(data.url)
      setPicked(null)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "ההחלפה לא הצליחה הפעם. נסו שוב.")
    } finally {
      setBusy(false)
    }
  }

  const images = folder?.status === "connected" ? folder.items : []

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>החלפת תמונה</DialogTitle>
          <DialogDescription>
            התמונה או הסרטון החדשים ישתלבו בבי-רול באותו אופן. הטקסט, העיצוב והתנועה נשארים.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            if (f.type.startsWith("video/")) {
              // Too big for a request: straight to her storage, then the server takes it.
              void (async () => {
                setBusy(true)
                const supabase = createClient()
                const { data } = await getCurrentUser(supabase)
                const ext = f.name.split(".").pop() || "mp4"
                const path = data.user ? `${data.user.id}/b_roll/upload-${crypto.randomUUID()}.${ext}` : null
                const up = path ? await supabase.storage.from("user-media").upload(path, f, { contentType: f.type }) : null
                if (!path || !up || up.error) {
                  setBusy(false)
                  setError("לא הצלחתי להעלות את הסרטון. נסו סרטון קצר יותר.")
                  return
                }
                await swap({ video: path })
              })()
              return
            }
            void shrink(f).then((image) => (image ? swap({ image }) : setError("לא הצלחתי לקרוא את התמונה. נסו קובץ אחר.")))
          }}
        />

        {busy ? (
          <div className="flex items-center gap-2 rounded-lg bg-bg-surface p-4 text-small text-text-primary-default" role="status">
            <Loader2 className="size-4 animate-spin text-text-neutral-default" />
            משלבת ומרנדרת את הבי-רול. זה לוקח כמה דקות.
          </div>
        ) : !folder || folder.status === "checking" ? (
          <div className="grid grid-cols-3 gap-2" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-gray-95 dark:bg-gray-20" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <p className="rounded-lg bg-bg-surface p-4 text-small text-text-primary-default">
            {folder.status === "connected" ? "תיקיית הבי-רול בדרייב ריקה." : "לא חיברתם תיקיית בי-רול מהדרייב."} אפשר לבחור מהמחשב.
          </p>
        ) : (
          <div className="grid max-h-[50vh] auto-rows-max grid-cols-3 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="קבצים בתיקייה">
            {images.map((item) => {
              const on = picked?.id === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={item.name}
                  onClick={() => setPicked(on ? null : item)}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70",
                    on ? "border-text-primary-default ring-1 ring-text-primary-default" : "border-border-neutral-default hover:border-gray-70",
                  )}
                >
                  <DriveThumb item={item} alt="" className="size-full object-cover" />
                  {item.kind === "video" && (
                    <span className="absolute bottom-1 start-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                      <Play className="size-2.5" />
                      {item.duration ?? "וידאו"}
                    </span>
                  )}
                  {on && (
                    <span className="absolute end-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-text-primary-default text-white dark:text-gray-10">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {error && <p className="text-xs-body text-button-destructive-default">{error}</p>}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" onClick={() => picked && void swap({ driveId: picked.id, kind: picked.kind })} disabled={!picked || busy}>
            החלפה
          </Button>
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy} className="gap-1.5">
            <Monitor className="size-4" />
            מהמחשב
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
