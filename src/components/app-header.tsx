"use client"

import { LogOut, User, ChevronDown, ArrowLeft } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

interface AppHeaderProps {
  idea?: string
}

export function AppHeader({ idea }: AppHeaderProps) {
  const router = useRouter()
  const [userName, setUserName] = useState("")
  const [userEmail, setUserEmail] = useState("")

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email ?? "")
        const { data: profile } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", data.user.id)
          .single<{ full_name: string | null }>()
        setUserName(
          profile?.full_name ||
            data.user.user_metadata?.full_name ||
            data.user.email?.split("@")[0] ||
            ""
        )
      }
    })
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <header
      dir="rtl"
      className="sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between border-b border-border-neutral-default bg-white dark:bg-gray-10 px-4"
    >
      {/* Right side (RTL start): idea title + back arrow, or empty spacer */}
      <div className="flex items-center gap-3">
        {idea && (
          <>
            <button
              onClick={() => router.push("/")}
              className="flex items-center justify-center rounded-lg p-2 hover:bg-bg-surface transition-colors"
            >
              <ArrowLeft className="size-4 text-text-primary-default rotate-180" />
            </button>
            <div className="flex flex-col min-w-0">
              <span className="text-small text-text-neutral-default">רעיון לתוכן</span>
              <span className="text-p-bold text-text-primary-default truncate">{idea}</span>
            </div>
          </>
        )}
      </div>

      {/* Left side (RTL end): theme toggle + avatar + dropdown */}
      <div className="flex items-center gap-2">
      <ThemeToggle />
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-surface outline-none transition-colors">
          <Avatar size="default">
            <AvatarImage src="" alt={userName} />
            <AvatarFallback className="bg-yellow-50 text-yellow-10 text-xs">
              {initials || "U"}
            </AvatarFallback>
          </Avatar>
          <span className="text-small text-text-primary-default hidden sm:block">
            {userName}
          </span>
          <ChevronDown className="size-4 text-text-neutral-default" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-small-bold text-text-primary-default">{userName}</p>
            <p className="text-xs-body text-text-neutral-default">{userEmail}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <User className="size-4" />
            <span>הגדרות</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="size-4" />
            <span>התנתקות</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  )
}
