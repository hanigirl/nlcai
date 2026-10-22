import { redirect } from "next/navigation"

// Media settings live in Settings → מדיה; the sidebar no longer links here.
// Kept as a redirect so old links and bookmarks still land somewhere useful.
export default function MediaPage() {
  redirect("/settings?tab=media")
}
