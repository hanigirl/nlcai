"use client"

import { useState, useMemo, type ReactNode } from "react"
import { Loader2, AlertCircle, ChevronDown } from "lucide-react"
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
  CRITICAL_CORE_FIELDS,
  type CoreIdentityValues,
  type CoreIdentityField,
} from "@/components/core-identity-form"
import {
  AUDIENCE_IDENTITY_GROUPS,
  CRITICAL_AUDIENCE_FIELDS,
  type AudienceIdentityValues,
  type AudienceFieldGroup,
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
  // Snapshot which fields to show, then split into required (critical) vs
  // optional (everything else). Only required fields gate the save button —
  // optional ones appear under a collapsible section so users who care can
  // fill them, but users who just want to finish don't have to. Computed
  // at open so typing doesn't make fields jump in/out.
  const { requiredFields, optionalFields } = useMemo<{
    requiredFields: CoreIdentityField[]
    optionalFields: CoreIdentityField[]
  }>(() => {
    if (!open) return { requiredFields: [], optionalFields: [] }
    const shown: CoreIdentityField[] =
      mode === "verify"
        ? CORE_IDENTITY_FIELDS
        : missingKeys
          ? CORE_IDENTITY_FIELDS.filter((f) => new Set(missingKeys).has(f.key))
          : CORE_IDENTITY_FIELDS.filter((f) => !initialValues[f.key].trim())
    const criticalSet = new Set<keyof CoreIdentityValues>(CRITICAL_CORE_FIELDS)
    return {
      requiredFields: shown.filter((f) => criticalSet.has(f.key)),
      optionalFields: shown.filter((f) => !criticalSet.has(f.key)),
    }
  }, [open, initialValues, mode, missingKeys])

  const [values, setValues] = useState<CoreIdentityValues>(initialValues)
  const [optionalOpen, setOptionalOpen] = useState(false)

  // Verify mode treats EVERY shown field as required — the user is
  // confirming/correcting the whole identity, not filling pure gaps. In gaps
  // mode, only the critical fields gate the button so the user can finish
  // fast without filling optional supportive fields.
  const allRequiredFilled =
    mode === "verify"
      ? [...requiredFields, ...optionalFields].every(
          (f) => values[f.key].trim().length > 0,
        )
      : requiredFields.every((f) => values[f.key].trim().length > 0)

  const renderField = (field: CoreIdentityField) => (
    <div key={field.key} className="flex flex-col gap-1.5">
      <label
        htmlFor={`core-field-${field.key}`}
        className="text-small-bold text-text-primary-default px-1"
      >
        {field.label}
        {(mode === "verify" || CRITICAL_CORE_FIELDS.includes(field.key)) && (
          <span aria-hidden="true" className="text-button-destructive-default"> *</span>
        )}
      </label>
      {field.multiline ? (
        <Textarea
          id={`core-field-${field.key}`}
          placeholder={field.placeholder}
          value={values[field.key]}
          onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
          aria-required={CRITICAL_CORE_FIELDS.includes(field.key) ? "true" : undefined}
          className="min-h-[88px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none"
        />
      ) : (
        <Input
          id={`core-field-${field.key}`}
          placeholder={field.placeholder}
          value={values[field.key]}
          onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
          aria-required={CRITICAL_CORE_FIELDS.includes(field.key) ? "true" : undefined}
        />
      )}
      {field.hint && (
        <p className="text-xs-body text-text-neutral-default px-1">{field.hint}</p>
      )}
    </div>
  )

  // In verify mode keep the old "show everything together" layout, since
  // the user is reviewing the full identity. In gaps mode split required
  // up top from optional in a collapsible section.
  const showSplit = mode === "gaps" && optionalFields.length > 0

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
        showSplit ? (
          <div className="flex flex-col gap-4">
            {requiredFields.map(renderField)}
            <button
              type="button"
              onClick={() => setOptionalOpen((v) => !v)}
              className="flex items-center justify-between gap-2 rounded-xl border border-border-neutral-default px-3 py-2 text-small-bold text-text-primary-default hover:bg-bg-surface-hover"
              aria-expanded={optionalOpen}
            >
              <span>אופציונלי — להעשרת הניתוח ({optionalFields.length})</span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform ${optionalOpen ? "rotate-180" : ""}`}
              />
            </button>
            {optionalOpen && (
              <div className="flex flex-col gap-4 pt-1">
                {optionalFields.map(renderField)}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {[...requiredFields, ...optionalFields].map(renderField)}
          </div>
        )
      }
      primaryLabel={mode === "verify" ? "שמירה ידנית" : "שמור והמשך"}
      secondaryLabel={mode === "verify" ? "סגירה והעלאת קובץ אחר" : "אשלים בהגדרות אחר כך"}
      primaryDisabled={!allRequiredFilled}
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
  // Split shown fields into critical (required) vs supportive (optional). In
  // gaps mode only the 5 critical pain/fear/desire fields gate the save —
  // others appear under a collapsible "אופציונלי" section so the dialog
  // doesn't feel like a 21-field gauntlet for users who just want to finish.
  // In verify mode every field is treated as required (the user is reviewing
  // the full identity, not filling gaps).
  const { requiredGroups, optionalGroups } = useMemo(() => {
    if (!open) return { requiredGroups: [], optionalGroups: [] }
    const baseGroups =
      mode === "verify"
        ? AUDIENCE_IDENTITY_GROUPS
        : missingKeys
          ? AUDIENCE_IDENTITY_GROUPS.map((g) => ({
              title: g.title,
              fields: g.fields.filter((f) => new Set(missingKeys).has(f.key)),
            })).filter((g) => g.fields.length > 0)
          : AUDIENCE_IDENTITY_GROUPS.map((g) => ({
              title: g.title,
              fields: g.fields.filter((f) => !initialValues[f.key].trim()),
            })).filter((g) => g.fields.length > 0)
    const criticalSet = new Set<keyof AudienceIdentityValues>(CRITICAL_AUDIENCE_FIELDS)
    const required = baseGroups
      .map((g) => ({
        title: g.title,
        fields: g.fields.filter((f) => criticalSet.has(f.key)),
      }))
      .filter((g) => g.fields.length > 0)
    const optional = baseGroups
      .map((g) => ({
        title: g.title,
        fields: g.fields.filter((f) => !criticalSet.has(f.key)),
      }))
      .filter((g) => g.fields.length > 0)
    return { requiredGroups: required, optionalGroups: optional }
  }, [open, initialValues, mode, missingKeys])

  const [values, setValues] = useState<AudienceIdentityValues>(initialValues)
  const [optionalOpen, setOptionalOpen] = useState(false)

  const optionalFieldCount = optionalGroups.reduce((n, g) => n + g.fields.length, 0)

  const allRequiredFilled =
    mode === "verify"
      ? [...requiredGroups, ...optionalGroups].every((g) =>
          g.fields.every((f) => values[f.key].trim().length > 0),
        )
      : requiredGroups.every((g) =>
          g.fields.every((f) => values[f.key].trim().length > 0),
        )

  const renderGroup = (
    group: { title: string; fields: AudienceFieldGroup["fields"] },
    showStar: boolean,
  ) => (
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
              {showStar && (
                <span aria-hidden="true" className="text-button-destructive-default"> *</span>
              )}
            </label>
            {field.multiline ? (
              <Textarea
                id={`aud-field-${field.key}`}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                aria-required={showStar ? "true" : undefined}
                className="min-h-[72px] rounded-2xl border-none bg-bg-surface px-4 py-3 text-base shadow-none placeholder:text-text-neutral-default resize-none"
              />
            ) : (
              <Input
                id={`aud-field-${field.key}`}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                aria-required={showStar ? "true" : undefined}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const showSplit = mode === "gaps" && optionalFieldCount > 0

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
      gapMessage="הקובץ עלה ונותח. השלימו את השדות החיוניים למטה כדי שהמערכת תוכל לדבר בדיוק לקהל שלכם."
      body={
        showSplit ? (
          <div className="flex flex-col gap-6">
            {requiredGroups.map((g) => renderGroup(g, true))}
            <button
              type="button"
              onClick={() => setOptionalOpen((v) => !v)}
              className="flex items-center justify-between gap-2 rounded-xl border border-border-neutral-default px-3 py-2 text-small-bold text-text-primary-default hover:bg-bg-surface-hover"
              aria-expanded={optionalOpen}
            >
              <span>אופציונלי — להעשרת הניתוח ({optionalFieldCount})</span>
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform ${optionalOpen ? "rotate-180" : ""}`}
              />
            </button>
            {optionalOpen && (
              <div className="flex flex-col gap-6 pt-1">
                {optionalGroups.map((g) => renderGroup(g, false))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {[...requiredGroups, ...optionalGroups].map((g) => renderGroup(g, true))}
          </div>
        )
      }
      primaryLabel={mode === "verify" ? "שמירה ידנית" : "שמור והמשך"}
      secondaryLabel={mode === "verify" ? "סגירה והעלאת קובץ אחר" : "אשלים בהגדרות אחר כך"}
      primaryDisabled={!allRequiredFilled}
      saving={saving}
      onPrimary={() => void onSave(values)}
      onSecondary={() => onCancel(values)}
    />
  )
}
