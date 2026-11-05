"use client"

import { useEffect, useRef, useState } from "react"
import { Check, HardDrive, ImagePlus, Loader2, Monitor, Play } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipLabel } from "@/components/ui/tooltip"
import { MAX_REFERENCES } from "@/lib/ai-edit-references"
import { cn } from "@/lib/utils"
import type { ReferenceImages } from "@/components/ai-edit-reference"
import { onDrivePickerRequest, takeDrivePickerRequest, type AsIsItem } from "@/lib/as-is-upload"
import {
  DriveThumb,
  FORMAT_FOLDER,
  loadDriveFolders,
  refreshDriveFolder,
  useDrivePickStore,
  type DriveMediaItem,
} from "@/components/drive-folder-review"

/**
 * The AI panel's add-image button, as a menu (Hani, 2026-11-06):
 * "מהמחשב" — her computer, as before; "מגוגל דרייב" — a gallery of the Drive
 * folder linked to THIS format in Settings (the same listing "מדיה מוכנה מ
 * Google Drive" uses). What she picks is attached exactly like a file from
 * her computer, and from there every existing rule applies.
 *
 * A video becomes ONE picture: Drive's own preview frame of the clip
 * (api/media/drive-reference) — the AI panel works with pictures. The panel
 * says so under the attachments.
 */

const ICON_BUTTON =
  "shrink-0 rounded-full text-text-neutral-default hover:bg-gray-95 hover:text-text-neutral-default dark:hover:bg-gray-20"

const FOLDER_NAME: Record<string, string> = {
  b_roll: "בי-רול",
  talking_head: "דיבור למצלמה",
  image_post: "פוסט תמונה",
  story: "סטורי",
  carousel: "קרוסלה",
}

/**
 * A video from her computer, as a picture the AI panel can use: its first
 * moment, drawn in the browser. The video itself is kept for "להעלות כמו שזה".
 */
function videoFrame(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement("video")
    v.muted = true
    v.playsInline = true
    v.preload = "auto"
    const done = (f: File | null) => {
      URL.revokeObjectURL(url)
      resolve(f)
    }
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 4)
    }
    v.onseeked = () => {
      const c = document.createElement("canvas")
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext("2d")?.drawImage(v, 0, 0)
      c.toBlob((b) => done(b ? new File([b], `${file.name}.jpg`, { type: "image/jpeg" }) : null), "image/jpeg", 0.88)
    }
    v.onerror = () => done(null)
    v.src = url
  })
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const [head, b64] = dataUrl.split(",")
  const type = head.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg"
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type })
}

/** The menu on the add-image icon. `onFrames`: how many videos came in as a frame. */
export function ReferenceAddMenu({
  r,
  format,
  disabled,
  onFrames,
}: {
  r: ReferenceImages
  format: string
  disabled?: boolean
  onFrames?: (count: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Opened straight on Drive by the media panel's "מדיה מוכנה מ Google Drive".
  const [driveOpen, setDriveOpen] = useState(() => takeDrivePickerRequest(format))
  useEffect(
    () =>
      onDrivePickerRequest(() => {
        if (takeDrivePickerRequest(format)) setDriveOpen(true)
      }),
    [format],
  )
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        // Videos too (2026-11-06): one goes in as-is with "להעלות כמו שזה";
        // for the AI it is a picture of its first moment.
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).filter(
            (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
          )
          e.target.value = ""
          void (async () => {
            const files: File[] = []
            const origins: AsIsItem[] = []
            let frames = 0
            for (const f of picked) {
              if (f.type.startsWith("video/")) {
                const frame = await videoFrame(f)
                if (!frame) continue
                files.push(frame)
                origins.push({ kind: "video", file: f })
                frames++
              } else {
                files.push(f)
                origins.push({ kind: "image", file: f })
              }
            }
            await r.add(files, { origins })
            if (frames) onFrames?.(frames)
          })()
        }}
      />
      <DropdownMenu dir="rtl">
        <TooltipLabel label="הוספת תמונה">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || r.full}
              aria-label="הוספת תמונה"
              className={ICON_BUTTON}
            >
              <ImagePlus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipLabel>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuItem className="cursor-pointer focus:bg-gray-95 dark:focus:bg-gray-20" onSelect={() => inputRef.current?.click()}>
            <Monitor className="text-text-neutral-default" />
            מהמחשב
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer focus:bg-gray-95 dark:focus:bg-gray-20" onSelect={() => setDriveOpen(true)}>
            <HardDrive className="text-text-neutral-default" />
            מגוגל דרייב
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DriveReferenceDialog open={driveOpen} onOpenChange={setDriveOpen} r={r} format={format} onFrames={onFrames} />
    </>
  )
}

/** The gallery of this format's Drive folder; picks are attached like computer files. */
export function DriveReferenceDialog({
  open,
  onOpenChange,
  r,
  format,
  onFrames,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  r: ReferenceImages
  format: string
  onFrames?: (count: number) => void
}) {
  const key = FORMAT_FOLDER[format]
  const folder = useDrivePickStore().folders[key]
  const [picked, setPicked] = useState<DriveMediaItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const room = MAX_REFERENCES - r.refs.length

  // What's in Drive NOW, each time the gallery opens.
  useEffect(() => {
    if (!open || !key) return
    void loadDriveFolders().then(() => refreshDriveFolder(key))
  }, [open, key])

  const toggle = (item: DriveMediaItem) => {
    setError(null)
    setPicked((prev) =>
      prev.some((p) => p.id === item.id)
        ? prev.filter((p) => p.id !== item.id)
        : prev.length < room
          ? [...prev, item]
          : prev,
    )
  }

  const attach = async () => {
    setBusy(true)
    setError(null)
    try {
      const files: File[] = []
      const origins: AsIsItem[] = []
      let frames = 0
      for (const item of picked) {
        const res = await fetch("/api/media/drive-reference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, kind: item.kind }),
        })
        const data = (await res.json().catch(() => ({}))) as { image?: string; frame?: boolean; message?: string }
        if (!res.ok || !data.image) throw new Error(data.message || "לא הצלחתי להביא את הקובץ מהדרייב.")
        if (data.frame) frames++
        files.push(await dataUrlToFile(data.image, item.name))
        // "להעלות כמו שזה" uses the Drive file itself — a video stays the video.
        origins.push({ kind: item.kind, drive: item.src })
      }
      await r.add(files, { origins })
      if (frames) onFrames?.(frames)
      setPicked([])
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "לא הצלחתי להביא את הקובץ מהדרייב.")
    } finally {
      setBusy(false)
    }
  }

  const label = FOLDER_NAME[format] ?? "הפורמט"
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked([])
        onOpenChange(o)
      }}
    >
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>מגוגל דרייב</DialogTitle>
          <DialogDescription>
            {folder?.status === "connected" && folder.name
              ? `התיקייה "${folder.name}" שחיברתם ל${label}. אפשר לבחור עד ${room === 1 ? "קובץ אחד" : `${room} קבצים`}.`
              : `התיקייה שחיברתם ל${label} בהגדרות.`}
          </DialogDescription>
        </DialogHeader>

        {!folder || folder.status === "checking" ? (
          <div className="grid grid-cols-3 gap-2" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-gray-95 dark:bg-gray-20" />
            ))}
          </div>
        ) : folder.status === "unset" ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-bg-surface p-4 text-small text-text-primary-default">
            <span>עוד לא חיברתם תיקייה מהדרייב ל{label}.</span>
            <Link href="/settings?tab=media" className="text-small underline underline-offset-4 hover:text-text-neutral-default">
              לחיבור תיקייה בהגדרות ← מדיה
            </Link>
          </div>
        ) : folder.status === "error" ? (
          <p className="rounded-lg bg-bg-surface p-4 text-small text-text-primary-default">
            התיקייה לא פתוחה לצפייה. שתפו אותה בדרייב לכל מי שיש לו את הקישור, ונסו שוב.
          </p>
        ) : folder.items.length === 0 ? (
          <p className="rounded-lg bg-bg-surface p-4 text-small text-text-primary-default">התיקייה ריקה. העלו אליה תמונות או סרטונים בדרייב.</p>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto p-0.5" role="group" aria-label="קבצים בתיקייה">
            {folder.items.map((item) => {
              const on = picked.some((p) => p.id === item.id)
              const full = !on && picked.length >= room
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={item.name}
                  disabled={full}
                  onClick={() => toggle(item)}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-70 disabled:cursor-not-allowed disabled:opacity-40",
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

        {picked.some((p) => p.kind === "video") && (
          <p className="text-xs-body text-text-neutral-default">מסרטון נצרפת תמונה אחת ממנו (פריים) לבקשה מה-AI. ״להעלות כמו שזה״ מעלה את הסרטון עצמו.</p>
        )}
        {error && <p className="text-xs-body text-button-destructive-default">{error}</p>}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" onClick={() => void attach()} disabled={!picked.length || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {picked.length > 1 ? `צירוף ${picked.length} קבצים` : "צירוף"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
