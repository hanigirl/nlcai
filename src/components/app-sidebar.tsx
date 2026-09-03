"use client"

import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { Home, FileText, Image, Settings, Anchor, Lightbulb, CalendarDays, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  prefetch?: boolean
}

const navItems: NavItem[] = [
  {
    label: "בית",
    href: "/",
    icon: Home,
  },
  {
    label: "פוסטי ליבה",
    href: "/core_posts",
    icon: FileText,
  },
  {
    label: "רעיונות",
    href: "/ideas",
    icon: Lightbulb,
  },
  {
    label: "מחסן הוקים",
    href: "/hooks",
    icon: Anchor,
  },
  {
    label: "מדיה",
    href: "/media",
    icon: Image,
  },
  {
    label: "תזמון",
    href: "/calendar",
    icon: CalendarDays,
    // Route not yet deployed — disable prefetch to avoid 404s in production console.
    prefetch: false,
  },
  {
    label: "הגדרות",
    href: "/settings",
    icon: Settings,
  },
]

// How long a click may sit with no page before we stop trusting the client
// router and load the page the old-fashioned way.
const NAVIGATION_STALL_MS = 8000

/**
 * The inside of a nav link. Lives in its own component because
 * `useLinkStatus` only works underneath the <Link> it reports on.
 *
 * Two jobs, both born from "I click the menu and nothing happens until I
 * refresh" (Hani, 2026-09-03):
 *
 * 1. Feedback. Every page here is a client component with no loading.tsx,
 *    so between the click and the server's answer the screen did not change
 *    at all — and that answer sits behind the auth middleware, which on a
 *    cold click is several hundred ms, or longer when Supabase is slow. The
 *    icon becomes a spinner the moment the router starts working, delayed
 *    150ms so a prefetched (instant) navigation never flashes it.
 *
 * 2. Rescue. If the router is still pending after NAVIGATION_STALL_MS the
 *    navigation has effectively hung (a dropped RSC fetch, a stale build after
 *    a tab sat open past skew protection's 12h window, a wedged router). A
 *    refresh is what the user was doing by hand; do it for them, straight to
 *    the page they asked for.
 */
function NavLinkBody({ item }: { item: NavItem }) {
  const { pending } = useLinkStatus()

  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => {
      window.location.assign(item.href)
    }, NAVIGATION_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [pending, item.href])

  return (
    <>
      {pending ? (
        <Loader2
          className="size-5 animate-spin opacity-0 animate-in fade-in fill-mode-forwards delay-150 duration-200"
          aria-label="טוען"
        />
      ) : (
        <item.icon className="size-5" />
      )}
      <span className="text-small">{item.label}</span>
    </>
  )
}

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar side="right" collapsible="icon" className="border-l border-border-neutral-default bg-white dark:bg-gray-10">
      <SidebarHeader className="flex items-center justify-center p-4 group-data-[collapsible=icon]:p-2">
        <Link href="/">
          <img src="/logo-new-minimise.png" alt="Logo" className="size-8 shrink-0" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={item.label}
                  >
                    <Link href={item.href} prefetch={item.prefetch}>
                      <NavLinkBody item={item} />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

    </Sidebar>
  )
}
