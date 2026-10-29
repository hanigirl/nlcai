import React, { useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const CARD_CHIP_FORMATS = ["instagram", "facebook", "twitter", "linkedin"] as const;
type ChipFormat = (typeof CARD_CHIP_FORMATS)[number];

export type FormatReadiness =
  | "published"
  | "scheduled"
  | "approved"
  | "missing";

interface FormatStatus {
  format: ChipFormat;
  readiness: FormatReadiness;
}

// ---------------------------------------------------------------------------
// Stub helpers – replace with real imports when timing-storage is wired
// ---------------------------------------------------------------------------

function getFormatReadiness(
  corePostId: string,
  format: string,
  formatsWithMedia: string[],
  hasBody: boolean
): "published" | "scheduled" | "missing" {
  // TODO: replace with real import from timing-storage
  void corePostId;
  void format;
  void formatsWithMedia;
  void hasBody;
  return "missing";
}

function isFormatApproved(corePostId: string, format: string): boolean {
  // TODO: replace with real import from page logic
  void corePostId;
  void format;
  return false;
}

// ---------------------------------------------------------------------------
// Color map
// ---------------------------------------------------------------------------

const STATE_COLOR: Record<FormatReadiness, string> = {
  published: "#22c55e",  // green-500
  scheduled: "#3b82f6",  // blue-500
  approved: "#a3e635",   // lime-400 (yellow-green)
  missing: "#9ca3af",    // gray-400
};

const STATE_LABEL_HE: Record<FormatReadiness, string> = {
  published: "פורסם",
  scheduled: "מתוזמן",
  approved: "מאושר",
  missing: "חסר",
};

// ---------------------------------------------------------------------------
// SVG donut helpers
// ---------------------------------------------------------------------------

const SIZE = 40;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;
const GAP = 2; // px gap between arcs (in dasharray units)

interface Arc {
  color: string;
  dash: number;
  offset: number;
}

function buildArcs(stateCounts: Record<FormatReadiness, number>): Arc[] {
  const total = CARD_CHIP_FORMATS.length; // always 4
  const order: FormatReadiness[] = ["published", "scheduled", "approved", "missing"];

  const arcs: Arc[] = [];
  let currentOffset = 0;

  for (const state of order) {
    const count = stateCounts[state];
    if (count === 0) continue;

    const segmentLength = (count / total) * CIRCUMFERENCE;
    const dash = Math.max(0, segmentLength - GAP);
    const gap = CIRCUMFERENCE - dash;

    arcs.push({
      color: STATE_COLOR[state],
      dash,
      // SVG stroke-dashoffset: offset shifts starting point clockwise
      // We start from the top (−CIRCUMFERENCE/4 is 12 o'clock)
      offset: -(currentOffset - CIRCUMFERENCE / 4),
    });

    currentOffset += segmentLength;
  }

  return arcs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FormatProgressRingProps {
  corePostId: string;
  formats: string[];
  formatsWithMedia: string[];
  hasBody: boolean;
  onClick?: () => void;
}

export function FormatProgressRing({
  corePostId,
  formats,
  formatsWithMedia,
  hasBody,
  onClick,
}: FormatProgressRingProps) {
  const [open, setOpen] = useState(false);

  // Compute per-format status
  const statuses: FormatStatus[] = CARD_CHIP_FORMATS.map((format) => {
    const inFormats = formats.includes(format);

    if (!inFormats) {
      return { format, readiness: "missing" };
    }

    const rawReadiness = getFormatReadiness(
      corePostId,
      format,
      formatsWithMedia,
      hasBody
    );

    if (rawReadiness === "published") return { format, readiness: "published" };
    if (rawReadiness === "scheduled") return { format, readiness: "scheduled" };

    // Not published / scheduled — check approval
    if (isFormatApproved(corePostId, format)) {
      return { format, readiness: "approved" };
    }

    if (rawReadiness === "missing") return { format, readiness: "missing" };

    return { format, readiness: "missing" };
  });

  // Aggregate counts
  const stateCounts: Record<FormatReadiness, number> = {
    published: 0,
    scheduled: 0,
    approved: 0,
    missing: 0,
  };
  for (const s of statuses) {
    stateCounts[s.readiness]++;
  }

  const arcs = buildArcs(stateCounts);

  // Tooltip content
  const tooltipLines = (
    ["published", "scheduled", "approved", "missing"] as FormatReadiness[]
  )
    .filter((state) => stateCounts[state] > 0)
    .map((state) => (
      <div key={state} className="flex items-center gap-1.5 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: STATE_COLOR[state] }}
        />
        <span>
          {STATE_LABEL_HE[state]}: {stateCounts[state]}
        </span>
      </div>
    ));

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="סטטוס פורמטים"
            data-no-pan
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            className="absolute right-2 top-2 z-10 flex cursor-pointer items-center justify-center rounded-full p-0 focus:outline-none"
            style={{ width: SIZE, height: SIZE }}
          >
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              aria-hidden
              style={{ display: "block" }}
            >
              {/* Background track */}
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={STROKE}
              />

              {/* Colored arcs */}
              {arcs.map((arc, i) => (
                <circle
                  key={i}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeLinecap="butt"
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={arc.offset}
                  style={{ transition: "stroke-dasharray 0.4s ease" }}
                />
              ))}
            </svg>
          </button>
        </TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="left"
            sideOffset={6}
            className="z-50 rounded-md bg-popover px-3 py-2 shadow-md text-popover-foreground"
            dir="rtl"
          >
            <div className="flex flex-col gap-1">{tooltipLines}</div>
            <TooltipPrimitive.Arrow className="fill-popover" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}