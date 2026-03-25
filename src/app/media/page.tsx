"use client"

import { useState } from "react"
import { Download, Image as ImageIcon } from "lucide-react"
import { AppShell } from "@/components/app-shell"

type MediaTab = "covers" | "stories" | "carousels"

export default function MediaPage() {
  const [activeTab, setActiveTab] = useState<MediaTab>("covers")

  // TODO: load generated media from DB (media_assets)
  const generatedCovers: string[] = []
  const generatedStories: string[] = []
  const generatedCarousels: string[] = []

  const getItems = () => {
    switch (activeTab) {
      case "covers": return generatedCovers
      case "stories": return generatedStories
      case "carousels": return generatedCarousels
    }
  }

  const handleDownload = (base64: string, index: number) => {
    const a = document.createElement("a")
    a.href = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`
    a.download = `${activeTab}-${index + 1}.png`
    a.click()
  }

  const items = getItems()

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
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-2xl bg-bg-surface p-6">
              <ImageIcon className="size-10 text-text-neutral-default mx-auto mb-3" />
              <p className="text-p text-text-neutral-default">
                {activeTab === "covers" && "עדיין אין קאברים"}
                {activeTab === "stories" && "עדיין אין סטוריז"}
                {activeTab === "carousels" && "עדיין אין קרוסלות"}
              </p>
              <p className="text-small text-text-primary-disabled mt-1">
                כשתיצרי תוכן, התמונות שנוצרו יופיעו כאן
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item, i) => (
              <div key={i} className="group relative aspect-[9/16] rounded-xl overflow-hidden bg-gray-95">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.startsWith("data:") ? item : `data:image/png;base64,${item}`}
                  alt={`${activeTab} ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => handleDownload(item, i)}
                  className="absolute bottom-2 end-2 flex items-center justify-center size-8 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Download className="size-4 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
