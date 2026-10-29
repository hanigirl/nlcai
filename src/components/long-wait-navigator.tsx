"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { registerLongWaitNavigator } from "@/lib/long-wait"

/**
 * Lets a long job's success toast open the post with the app's own router, so
 * following the link doesn't reload the page and cut other jobs short.
 * Mounted once in the root layout; renders nothing.
 */
export function LongWaitNavigator() {
  const router = useRouter()
  useEffect(() => registerLongWaitNavigator((href) => router.push(href)), [router])
  return null
}
