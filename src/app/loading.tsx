"use client"

import { usePathname } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * What the user sees between clicking a menu item and the page arriving.
 *
 * Every page is a client component that renders its own AppShell, and until
 * now nothing at all rendered while the route's payload was in flight — the
 * old screen simply sat there, which read as "the menu doesn't work" (Hani,
 * 2026-09-03). Next prefetches this boundary with the route, so it paints the
 * moment the click lands, and the page's own skeletons take over once it
 * mounts.
 *
 * It wraps itself in the same AppShell so the sidebar and header stay on
 * screen; usePathname already points at the destination here, so the sidebar
 * highlights the item that was clicked. Auth pages (/login, /onboarding,
 * /welcome, /auth/*) have no shell, so they get a bare, centred skeleton.
 */
const SHELL_LESS = ["/login", "/onboarding", "/welcome", "/auth"]

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border-neutral-default bg-white p-5 dark:bg-gray-10">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-5/6 rounded" />
        <Skeleton className="h-3 w-4/6 rounded" />
        <Skeleton className="h-3 w-3/6 rounded" />
      </div>
      <div className="mt-8 flex justify-between">
        <Skeleton className="h-3 w-6 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div dir="rtl" className="mx-auto w-full max-w-6xl" aria-busy="true" aria-label="טוען">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-7 w-48 rounded-md" />
        <Skeleton className="h-4 w-80 max-w-full rounded" />
      </div>
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-9 w-16 rounded-full" />
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-4 w-20 rounded" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export default function Loading() {
  const pathname = usePathname()

  if (SHELL_LESS.some((p) => pathname.startsWith(p))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-10">
        <Skeleton className="size-10 rounded-full" />
      </div>
    )
  }

  return (
    <AppShell isHome={pathname === "/"}>
      <PageSkeleton />
    </AppShell>
  )
}
