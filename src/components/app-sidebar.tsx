"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, FileText, Image, Settings, Anchor, Lightbulb } from "lucide-react"
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
    label: "הגדרות",
    href: "/settings",
    icon: Settings,
  },
]

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
                    <Link href={item.href}>
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
