// Agent Watcher bridge for OpenCode 2.x (TUI plugin).
// OpenCode 2 runs server plugins in a shared background service, so their
// process chain never reaches a terminal window. A TUI plugin runs inside the
// terminal's own opencode client, so agent-watcher-hook can walk up to the
// window like it does for every other agent.
// `agent-watcher-setup install opencode` copies this file to
// ~/.config/opencode/plugins/agent-watcher-tui/tui.js (with __HOOK_PATH__
// replaced) and lists that directory in ~/.config/opencode/cli.json.
import { spawn } from "node:child_process"

const HOOK = "__HOOK_PATH__"
const HOOK_TIMEOUT_MS = 5000

let queue = Promise.resolve()

function send(event, sessionId, cwd, title) {
  queue = queue
    .then(
      () =>
        new Promise((resolve) => {
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(finish, HOOK_TIMEOUT_MS)
          if (timer.unref) timer.unref()
          try {
            const child = spawn(HOOK, ["opencode", event], { stdio: ["pipe", "ignore", "ignore"] })
            child.on("error", finish)
            child.on("close", finish)
            child.stdin.on("error", () => {})
            child.stdin.end(JSON.stringify({ session_id: sessionId, cwd, title: title || "" }))
          } catch {
            finish()
          }
        }),
    )
    .catch(() => {})
}

// OpenCode 2 TUI plugins export { id, setup }; setup(api) returns a disposer.
// Events arrive through api.data.listen as { details: { type, data } }.
function setup(api) {
  const known = new Map() // root session id -> last reported title
  const children = new Set() // sub-agent sessions: never reported
  const waiting = new Map() // unresolved session id -> retries left
  const cwdOf = (id) => api.data.session.get(id)?.directory || process.cwd()
  const report = (ev, id) => send(ev, id, cwdOf(id), known.get(id) || "")

  // A session's first events can arrive before OpenCode has registered it (and
  // its parentID), so an unknown session is not assumed to be a root: retry
  // shortly, and only report once it is known not to have a parent.
  function track(id) {
    if (typeof id !== "string" || children.has(id)) return false
    const info = api.data.session.get(id)
    if (!info) {
      const left = waiting.has(id) ? waiting.get(id) : 10
      if (left > 0) {
        waiting.set(id, left - 1)
        if (left === 10) {
          const t = setTimeout(() => { waiting.delete(id) }, 6000)
          if (t.unref) t.unref()
        }
      }
      return false
    }
    if (info.parentID) {
      children.add(id)
      return false
    }
    const title = info.title || ""
    if (!known.has(id)) {
      known.set(id, title)
      report("session-start", id)
    } else if (known.get(id) !== title) {
      known.set(id, title)
      report("rename", id)
    }
    return true
  }

  const unsubscribe = api.data.listen(({ details: event }) => {
    try {
      const data = event?.data
      if (data == null) return
      if (event.type === "session.deleted") {
        children.delete(data.sessionID)
        if (known.delete(data.sessionID)) send("session-end", data.sessionID, process.cwd())
        return
      }
      const id = event.type === "form.created" ? data.form?.sessionID : data.sessionID
      if (!track(id)) return
      switch (event.type) {
        case "session.execution.started":
          report("prompt", id)
          break
        case "session.execution.succeeded":
        case "session.execution.interrupted":
          report("done", id)
          break
        case "session.execution.failed":
          report("waiting", id)
          break
        case "permission.asked":
        case "form.created":
          report("waiting", id)
          break
        case "permission.replied":
        case "form.replied":
        case "form.cancelled":
          report("tool-done", id)
          break
        default:
          break
      }
    } catch {}
  })
  return () => unsubscribe()
}

export default { id: "agent-watcher.opencode", setup }
