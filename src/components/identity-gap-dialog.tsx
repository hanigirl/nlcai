"use client"

import { useState, useMemo, type ReactNode } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  CORE_IDENTITY_FIELDS,
  type CoreIdentityValues,
  type CoreIdentityField,
} from "@/components/core-identity-form"
import {
  AUDIENCE_IDENTITY_GROUPS,
  type AudienceIdentityValues,
} from "@/components/audience-identity-form"

// Shared chrome for both identity dialogs. Three sections:
//   header (sticky top), scroll body, footer (sticky bottom). Description in
//   verify mode is rendered as a red notice box so the user immediately sees
//   that the upload was rejected.
//
// `locked` mode (gaps with critical fields missing): hides the X, blocks
// escape + click-outside, and removes the secondary button entirely. The
// only way forward is the primary "save and continue" button, which is
// itself disabled until every shown field is filled. Closing the tab is
// the only off-ramp — the middleware gate catches that user on the next
// navigation. Without these constraints, users escaped the dialog with
// blank rows and downstream pipelines (hooks/ideas) failed with
// audience_missing.
function DialogShell({
  open,
  onOpenChange,
  mode,
  locked,
  title,
  verifyMessage,
  gapMessage,
  bodyClassName,
  contentMaxWidth,
  body,
  primaryLabel,
  secondaryLabel,
  primaryDisabled,
  saving,
  onPrimary,
  onSecondary,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "gaps" | "verify"
  locked?: boolean
  title: string
  verifyMessage: string
  gapMessage: string
  bodyClassName?: string
  contentMaxWidth: string
  body: ReactNode
  primaryLabel: string
  secondaryLabel: string
  primaryDisabled: boolean
  saving: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <Dialog
      open={open}
      // Locked: swallow programmatic close requests so the only paths out
      // are the primary button (after all required fields are filled) and
      // the explicit secondary "defer to settings" action.
      onOpenChange={locked ? () => {} : onOpenChange}
    >
      <DialogContent
        dir="rtl"
        showCloseButton={!locked}
        onPointerDownOutside={(e) => { if (locked) e.preventDefault() }}
        onEscapeKeyDown={(e) => { if (locked) e.preventDefault() }}
        className={`${contentMaxWidth} max-h-[85vh] p-0 flex flex-col gap-0 overflow-hidden`}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border-neutral-default">
          <DialogTitle>{title}</DialogTitle>
          {mode === "verify" ? (
            <div className="mt-2 flex items-start gap-2 rounded-xl bg-red-95 border border-red-90 px-3 py-2.5">
              <AlertCircle className="size-4 text-button-danger-default shrink-0 mt-0.5" />
              <DialogDescription className="text-button-danger-default text-sm leading-relaxed">
                {verifyMessage}
              </DialogDescription>
            </div>
          ) : (
            <DialogDescription>{gapMessage}</DialogDescription>
          )}
        </DialogHeader>

        <div className={`flex-1 overflow-y-auto px-6 py-4 ${bodyClassName ?? ""}`}>
          {body}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-border-neutral-default bg-bg-surface flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!locked && (
            <Button
              variant="outline"
              onClick={onSecondary}
              disabled={saving}
              className="border-border-neutral-default text-text-neutral-default"
            >
              {secondaryLabel}
            </Button>
          )}
          <Button
            onClick={onPrimary}
            disabled={primaryDisabled || saving}
            className="gap-2"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "שומר..." : primaryLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CoreGapDialogProps {
  open: boolean
  initialValues: CoreIdentityValues
  saving?: boolean
  // "gaps" → show only fields that were empty when opened (default).
  // "verify" → show all fields prefilled, for confirming the existing data
  //   when the uploaded file didn't classify as a style doc.
  mode?: "gaps" | "verify"
  // Explicit list of fields to render in gaps mode. When provided, used
  // instead of detecting empties from initialValues — needed so that fields
  // pre-filled from stale DB data can still appear in the popup for review.
  missingKeys?: Array<keyof CoreIdentityValues>
  // Called when the dialog closes WITHOUT advancing the step (X, outside
  // click, the cancel/secondary button). Receives the current popup values
  // so progress can be persisted before the popup disappears.
  onCancel: (currentValues: CoreIdentityValues) => void
  onSave: (next: CoreIdentityValues) => void | Promise<void>
}

export function CoreIdentityGapDialog({
  open,
  initialValues,
  saving = false,
  mode = "gaps",
  missingKeys,
  onCancel,
  onSave,
}: CoreGapDialogProps) {
  // Snapshot which fields to show. Computed at open so typing into a field
  // doesn't make it disappear from the list mid-session.
  const fieldsToShow = useMemo<CoreIdentityField[]>(() => {
    if (!open) return []
    if (mode === "verify") return CORE_IDENTITY_FIELDS
    if (missingKeys) {
      const set = new Set(missingKeys)
      return CORE_IDENTITY_FIELDS.filter((f) => set.has(f.key))
    }
    return CORE_IDENTITY_FIELDS.filter((f) => !initialValues[f.key].trim())
  }, [open, initialValues, mode, missingKeys])

  const [values, setValues] = useState<CoreIdentityValues>(initialValues)

  const allFilled = fieldsToShow.every((f) => values[f.key].trim().length > 0)

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel(values)
      }}
      mode={mode}
      locked={mode === "gaps"}
      contentMaxWidth="max-w-lg"
      title={mode === "verify" ? "אשרו את פרטי הסגנון" : "השלימו את הפרטים החסרים"}
      verifyMessage="הקובץ שהעליתם לא זוהה כתיאור של סגנון כתיבה. בדקו את הפרטים השמורים ועדכנו במידת הצורך, או סגרו והעלו קובץ אחר."
      gapMessage="הקובץ עלה ונותח, אבל חסרים לנו עוד כמה פרטים חיוניים כדי שהמערכת תוכל לעבוד עבורכם. ההשלמה לוקחת רק דקה."
      body={
        <div className="flex flex-col gap-4">
          {fieldsToShow.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={`core-field-${field.key}`}
                className="text-small-bold text-text-primary-default px-1"
              >
                {field.label}
                <span aria-hidden="true" className="text-button-destructive-default"> *</span>
              </label>
              {field.multiline ? (
                <Textarea
                  id={`core-field-${field.key}`}
                  placeholder={field.placeholder}
                  value={values[field.key]}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  aria-required="true"
                  className="min-h-[88px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none"
                />
              ) : (
                <Input
                  id={`core-field-${field.key}`}
                  placeholder={field.placeholder}
                  value={values[field.key]}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  aria-required="true"
                />
              )}
              {field.hint && (
                <p className="text-xs-body text-text-neutral-default px-1">{field.hint}</p>
              )}
            </div>
          ))}
        </div>
      }
      primaryLabel={mode === "verify" ? "שמירה ידנית" : "שמור והמשך"}
      secondaryLabel={mode === "verify" ? "סגירה והעלאת קובץ אחר" : "אשלים בהגדרות אחר כך"}
      primaryDisabled={!allFilled}
      saving={saving}
      onPrimary={() => void onSave(values)}
      onSecondary={() => onCancel(values)}
    />
  )
}

interface AudienceGapDialogProps {
  open: boolean
  initialValues: AudienceIdentityValues
  saving?: boolean
  mode?: "gaps" | "verify"
  // See CoreIdentityGapDialog — explicit list of keys to render in gaps mode.
  missingKeys?: Array<keyof AudienceIdentityValues>
  onCancel: (currentValues: AudienceIdentityValues) => void
  onSave: (next: AudienceIdentityValues) => void | Promise<void>
}

export function AudienceIdentityGapDialog({
  open,
  initialValues,
  saving = false,
  mode = "gaps",
  missingKeys,
  onCancel,
  onSave,
}: AudienceGapDialogProps) {
  const groupsToShow = useMemo(() => {
    if (!open) return []
    if (mode === "verify") return AUDIENCE_IDENTITY_GROUPS
    if (missingKeys) {
      const set = new Set(missingKeys)
      return AUDIENCE_IDENTITY_GROUPS.map((g) => ({
        title: g.title,
        fields: g.fields.filter((f) => set.has(f.key)),
      })).filter((g) => g.fields.length > 0)
    }
    return AUDIENCE_IDENTITY_GROUPS.map((g) => ({
      title: g.title,
      fields: g.fields.filter((f) => !initialValues[f.key].trim()),
    })).filter((g) => g.fields.length > 0)
  }, [open, initialValues, mode, missingKeys])

  const [values, setValues] = useState<AudienceIdentityValues>(initialValues)

  const allFilled = groupsToShow.every((g) =>
    g.fields.every((f) => values[f.key].trim().length > 0),
  )

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel(values)
      }}
      mode={mode}
      locked={mode === "gaps"}
      contentMaxWidth="max-w-xl"
      title={mode === "verify" ? "אשרו את פרטי הקהל" : "השלימו את פרטי הקהל החסרים"}
      verifyMessage="הקובץ שהעליתם לא זוהה כניתוח קהל יעד. בדקו את הפרטים השמורים ועדכנו במידת הצורך, או סגרו והעלו קובץ אחר."
      gapMessage="הקובץ עלה ונותח, אבל חסרים לנו עוד כמה פרטים חיוניים כדי שהמערכת תוכל לדבר בדיוק לקהל שלכם. ההשלמה לוקחת רק דקה."
      body={
        <div className="flex flex-col gap-6">
          {groupsToShow.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <h4 className="text-small-bold text-text-primary-default border-b border-border-neutral-default pb-1.5">
                {group.title}
              </h4>
              <div className="flex flex-col gap-3">
                {group.fields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`aud-field-${field.key}`}
                      className="text-xs-body text-text-primary-default px-1"
                    >
                      {field.label}
                      <span aria-hidden="true" className="text-button-destructive-default"> *</span>
                    </label>
                    {field.multiline ? (
                      <Textarea
                        id={`aud-field-${field.key}`}
                        placeholder={field.placeholder}
                        value={values[field.key]}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                        aria-required="true"
                        className="min-h-[72px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none"
                      />
                    ) : (
                      <Input
                        id={`aud-field-${field.key}`}
                        placeholder={field.placeholder}
                        value={values[field.key]}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                        aria-required="true"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      }
      primaryLabel={mode === "verify" ? "שמירה ידנית" : "שמור והמשך"}
      secondaryLabel={mode === "verify" ? "סגירה והעלאת קובץ אחר" : "אשלים בהגדרות אחר כך"}
      primaryDisabled={!allFilled}
      saving={saving}
      onPrimary={() => void onSave(values)}
      onSecondary={() => onCancel(values)}
    />
  )
}
