// Regression test for long-form dictation. Run with: npx tsx src/lib/speech-dictation.test.mts
//
// There is no test runner in this project yet, so this is a standalone script.
// It exists because the "recording stops after 30-60 seconds and drops the rest
// of the speech" bug was written twice, independently, in two components — both
// times by treating a pause in speech as the user having finished. The fake
// engine below reproduces exactly what Chrome does: a "no-speech" error on a
// pause, and an unprompted `onend` when the session times out.

import { startDictation } from "./speech-dictation"

let inst: any
class FakeRecognition {
  lang = ""; continuous = false; interimResults = false
  onresult: any = null; onerror: any = null; onend: any = null
  started = 0; stopped = 0
  constructor() { inst = this }
  start() { this.started++ }
  stop() { this.stopped++ }
  // helpers
  say(text: string) {
    this.onresult({ resultIndex: 0, results: Object.assign([[{ transcript: text }]], { 0: Object.assign([{ transcript: text }], { isFinal: true }) }) })
  }
  err(code: string) { this.onerror({ error: code }) }
  end() { this.onend() }
}
;(globalThis as any).window = { SpeechRecognition: FakeRecognition }

const said: string[] = []
let fatal: string | null = null
const h = startDictation({ onFinalText: (t) => said.push(t), onFatalError: (m) => { fatal = m } })!

const check = (label: string, ok: boolean) => console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)

check("session started", inst.started === 1)
check("continuous mode on", inst.continuous === true)

inst.say("המשפט הראשון")

// The exact reported bug: user pauses to think -> Chrome fires no-speech, then ends.
inst.err("no-speech")
check("a pause does NOT end dictation", fatal === null)
inst.end()
check("session auto-restarted after the pause", inst.started === 2)

// Speech after the restart must still be captured AND not lose what came before.
inst.say("המשפט שאחרי ההפסקה")
check("speech after the restart is captured", said.length === 2)
check("nothing earlier was dropped", said[0] === "המשפט הראשון")

// Chrome's own ~60s session timeout: plain onend, no error at all.
inst.end()
check("restarts after the browser's own timeout", inst.started === 3)

// A denied mic is real and must surface, not loop.
inst.err("not-allowed")
check("denied microphone surfaces to the user", typeof fatal === "string")
check("denied microphone stops the session", inst.stopped >= 1)

// Explicit stop really stops.
const said2 = said.length
const before = inst.started
inst.end()
check("no restart after a fatal error", inst.started === before)

console.log("\n--- second session, explicit user stop ---")
fatal = null
const h2 = startDictation({ onFinalText: (t) => said.push(t), onFatalError: (m) => { fatal = m } })!
const s2 = inst
h2.stop()
check("user stop calls stop() on the engine", s2.stopped >= 1)
s2.end()
check("no restart after the user stopped", s2.started === 1)
check("user stop is not reported as an error", fatal === null)
