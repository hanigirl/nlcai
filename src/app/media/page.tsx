"use client"

import { useState } from "react"
import { AppShell } from "@/components/app-shell"
import { ComingSoon } from "@/components/coming-soon"

type MediaTab = "covers" | "stories" | "carousels"

export default function MediaPage() {
  const [activeTab, setActiveTab] = useState<MediaTab>("covers")

  const TABS: { id: MediaTab; label: string }[] = [
    { id: "covers", label: "קאברים" },
    { id: "stories", label: "סטורי" },
    { id: "carousels", label: "קרוסלות" },
  ]

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto" dir="rtl">
        <h2 className="text-text-primary-default mb-6">מדיה</h2>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border-neutral-default mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-p transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "text-text-primary-default border-b-2 border-text-primary-default font-semibold"
                  : "text-text-neutral-default hover:text-text-primary-default"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <ComingSoon />
      </div>
    </AppShell>
  )
}
