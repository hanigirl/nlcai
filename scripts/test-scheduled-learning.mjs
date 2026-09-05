import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import ts from "typescript"

const require = createRequire(import.meta.url)
const code = ts.transpileModule(readFileSync(new URL("../src/lib/scheduled-learning.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function setup() {
  const requests = []
  const state = {
    scheduled_posts: [{ user_id: "u", core_post_id: "p", format: "b_roll" }],
    core_posts: [{ user_id: "u", id: "p", hook_text: "Latest hook" }],
    format_variants: [{ core_post_id: "p", format: "b_roll", body: "Final caption" }],
    learning_logs: [],
  }
  const db = { from(table) {
    const filters = []
    return {
      select() { return this },
      eq(key, value) { filters.push((r) => r[key] === value); return this },
      in(key, values) { filters.push((r) => values.includes(r[key])); return this },
      then(resolve) { return Promise.resolve({ data: state[table].filter((r) => filters.every((f) => f(r))), error: null }).then(resolve) },
      async upsert(row) {
        const old = state[table].find((r) => r.user_id === row.user_id && r.scheduled_core_post_id === row.scheduled_core_post_id && r.content_type === row.content_type)
        if (old) Object.assign(old, row)
        else state[table].push(row)
        return { error: null }
      },
    }
  } }
  class Anthropic {
    messages = { create: async (request) => {
      requests.push(request)
      return { content: [{ type: "text", text: "מעדיף פתיחה ישירה וניסוח יומיומי." }] }
    } }
  }
  const module = { exports: {} }
  const mocks = {
    "@anthropic-ai/sdk": Anthropic,
    "@/lib/api-keys": { getUserApiKey: async () => "test-key" },
    "@/lib/learning-insights": { sanitizeInsight: (text) => ({ insight: text }) },
  }
  new Function("require", "module", "exports", code)((id) => mocks[id] ?? require(id), module, module.exports)
  return { state, requests, run: (limit) => module.exports.learnFromScheduledPosts(db, "u", ["p"], limit) }
}

test("scheduling stores accepted insights for hook and final caption", async () => {
  const { run, state, requests } = setup()
  await run()
  assert.equal(state.learning_logs.length, 2)
  assert.ok(state.learning_logs.every((l) => l.source === "scheduled_post" && l.outcome === "accepted"))
  assert.ok(requests[1].messages[0].content.includes("Final caption"))
})

test("rescheduling does not duplicate; new formats strengthen existing insights", async () => {
  const { run, state, requests } = setup()
  await run(); await run()
  assert.equal(requests.length, 2)
  state.scheduled_posts.push({ user_id: "u", core_post_id: "p", format: "story" })
  await run()
  assert.equal(state.learning_logs.length, 2)
  assert.ok(state.learning_logs.every((l) => l.approval_weight === 2))
})

test("saved edits replace the insight; forgotten insights stay forgotten", async () => {
  const { run, state, requests } = setup()
  await run()
  state.learning_logs[0].dismissed_at = "2026-09-06"
  state.format_variants[0].body = "Edited final caption"
  await run()
  assert.equal(requests.length, 3)
  assert.ok(state.learning_logs[1].edited_text.includes("Edited final caption"))
})

test("backfill resumes without extracting the same insight twice", async () => {
  const { run, requests } = setup()
  assert.deepEqual(await run(1), { remaining: true })
  assert.deepEqual(await run(1), { remaining: false })
  assert.equal(requests.length, 2)
})

test("unscheduled posts and other users never become learning material", async () => {
  const { run, state, requests } = setup()
  state.scheduled_posts[0].user_id = "someone-else"
  await run()
  assert.equal(requests.length, 0)
})
