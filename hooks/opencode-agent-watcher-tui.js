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

async function tui(api) {
  const dirs = new Map() // root session id -> directory
  const titles = new Map() // root session id -> title
  const children = new Set() // sub-agent sessions: ignored
  const busy = new Set()
  const cwdOf = (id) => dirs.get(id) || process.cwd()
  const titleOf = (id) => titles.get(id) || ""
  const report = (ev, id) => send(ev, id, cwdOf(id), titleOf(id))

  const handlers = {
    "session.created": (p) => {
      if (!p.info) return
      if (p.info.parentID) return void children.add(p.info.id)
      dirs.set(p.info.id, p.info.directory || process.cwd())
      titles.set(p.info.id, p.info.title || "")
      report("session-start", p.info.id)
    },
    "session.updated": (p) => {
      if (!p.info || children.has(p.info.id)) return
      if (p.info.parentID) return void children.add(p.info.id)
      if (!dirs.has(p.info.id)) dirs.set(p.info.id, p.info.directory || process.cwd())
      if ((p.info.title || "") !== titleOf(p.info.id)) {
        titles.set(p.info.id, p.info.title || "")
        report("rename", p.info.id)
      }
    },
    "session.status": (p) => {
      if (children.has(p.sessionID)) return
      if (p.status?.type === "busy") {
        if (busy.has(p.sessionID)) return
        busy.add(p.sessionID)
        report("prompt", p.sessionID)
      } else if (p.status?.type === "idle") {
        busy.delete(p.sessionID)
        report("done", p.sessionID)
      }
    },
    "session.idle": (p) => {
      busy.delete(p.sessionID)
      if (!children.has(p.sessionID)) report("done", p.sessionID)
    },
    "permission.asked": (p) => {
      if (!children.has(p.sessionID)) report("waiting", p.sessionID)
    },
    "question.asked": (p) => {
      if (!children.has(p.sessionID)) report("waiting", p.sessionID)
    },
    "permission.replied": (p) => {
      if (!children.has(p.sessionID)) report("tool-done", p.sessionID)
    },
    "question.replied": (p) => {
      if (!children.has(p.sessionID)) report("tool-done", p.sessionID)
    },
    "session.deleted": (p) => {
      if (!p.info || children.has(p.info.id)) return
      send("session-end", p.info.id, cwdOf(p.info.id))
      dirs.delete(p.info.id)
      titles.delete(p.info.id)
      busy.delete(p.info.id)
    },
  }

  const off = Object.entries(handlers).map(([type, fn]) =>
    api.event.on(type, (event) => {
      try {
        fn(event?.properties || {})
      } catch {}
    }),
  )
  api.lifecycle.onDispose(() => {
    for (const unsubscribe of off) unsubscribe()
  })

  // Sessions already open when the TUI starts: register the one on screen.
  const route = api.route.current
  if (route?.name === "session" && route.params?.sessionID) {
    const id = route.params.sessionID
    const s = api.state?.session?.get?.(id)
    if (s && !s.parentID) {
      dirs.set(id, s.directory || process.cwd())
      titles.set(id, s.title || "")
      report("session-start", id)
    }
  }
}

export default { id: "agent-watcher.opencode", tui }
