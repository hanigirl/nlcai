import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types"

// Service-role client — bypasses RLS. Server-only. Never expose to the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error("missing_service_role_env")
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const ADMIN_EMAILS = new Set([
  "hanigirl@gmail.com",
  "hani@uxtra.co.il",
  "yahavrubin1@gmail.com",
  "nataliya@nataliyarey.com",
  "etel1108@gmail.com",
  "avishagnextlevel@gmail.com", // Avishag
  "ynmarketlink@gmail.com", // Tamar
  "roy.palkovitch@gmail.com", // Roy
])

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase())
}
