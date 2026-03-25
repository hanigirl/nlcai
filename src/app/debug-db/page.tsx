"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function DebugDbPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setData({ error: "Not logged in" })
        return
      }

      const [core, audience, products] = await Promise.all([
        supabase.from("core_identities").select("*").eq("user_id", user.id).single(),
        supabase.from("audience_identities").select("*").eq("user_id", user.id).single(),
        supabase.from("products").select("*").eq("user_id", user.id),
      ])

      setData({
        user: { id: user.id, email: user.email, metadata: user.user_metadata },
        core_identity: core.data ?? core.error,
        audience_identity: audience.data ?? audience.error,
        products: products.data ?? products.error,
      })
    }
    load()
  }, [])

  return (
    <div dir="ltr" className="p-8 font-mono text-sm">
      <h1 className="text-xl font-bold mb-4">Debug DB</h1>
      <pre className="bg-gray-100 p-4 rounded-lg overflow-auto max-h-[80vh] whitespace-pre-wrap">
        {data ? JSON.stringify(data, null, 2) : "Loading..."}
      </pre>
    </div>
  )
}
