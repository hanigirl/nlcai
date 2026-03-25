"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"

interface AppShellProps {
  children: React.ReactNode
  idea?: string
  isHome?: boolean
}

export function AppShell({ children, idea, isHome }: AppShellProps) {
  return (
    <SidebarProvider defaultOpen={false} open={false}>
      <AppSidebar />
      <SidebarInset>
        <AppHeader idea={idea} />
        <main className={`flex-1 ${idea ? "overflow-hidden bg-bg-surface" : isHome ? "overflow-y-auto bg-bg-surface pt-[72px] px-6 pb-6" : "overflow-y-auto bg-white pt-[72px] px-6 pb-6"}`}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
