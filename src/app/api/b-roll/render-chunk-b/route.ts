import type { NextRequest } from "next/server"
import { handleRenderChunk } from "@/lib/broll-animation/render-chunk-handler"

// One of four separate functions for the distributed b-roll render
// (lib/broll-animation/render-chunk-handler). The differing maxDuration keeps
// them from being bundled into one function.
export const maxDuration = 299

export function POST(req: NextRequest) {
  return handleRenderChunk(req)
}
