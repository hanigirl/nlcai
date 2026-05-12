"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, FileText, Image, Settings, Anchor, Lightbulb, CalendarDays } from "lucide-react"
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
import { createClient } from "@/lib/supabase/client"
import { isOwner } from "@/lib/owner"

const navItems = [
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

export function AppSidebar() {
  const pathname = usePathname()
  // Hide the "תזמון" tab from everyone except the owner. We default to
  // false (hidden) and flip to true ONLY once the user lookup confirms
  // it's the owner — so a slow auth fetch never leaks the tab to other
  // users by accident.
  const [ownerView, setOwnerView] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isOwner(user?.email)) setOwnerView(true)
    })
  }, [])

  const visibleItems = ownerView ? navItems : navItems.filter((i) => i.href !== "/calendar")

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
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={item.label}
                  >
                    <Link href={item.href} prefetch={item.prefetch}>
                      <item.icon className="size-5" />
                      <span className="text-small">{item.label}</span>
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
