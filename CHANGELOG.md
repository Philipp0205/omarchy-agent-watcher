# Changelog

## 0.2.0 — 2026-11-12

Fixes found by running real Claude Code, Codex and OpenCode sessions side by
side in separate terminal windows.

### Fixed

- **Codex sessions pinned to the wrong window.** Codex 0.16x runs every
  session's hooks inside one shared `codex app-server` daemon, so every Codex
  row pointed at the terminal that happened to start the daemon (and clicking
  a row focused that terminal). The hook now finds each session's own Codex
  TUI: the one started in the session's directory, the focused one when
  several qualify, or the one not already showing another session.
- **Codex sessions that never went away.** Codex sends no `SessionEnd` when a
  TUI quits; sessions were tied to the long-lived daemon and stayed listed
  forever. They are now tied to their TUI process and vanish with it.
- **Rows stuck in "working" or "waiting".** Pressing Esc, denying a
  permission, approving one (the hook only reports after the tool finishes)
  and API errors fire no hook. The bar now follows the agent's own window
  title when it has disagreed with the hook state for a few seconds (Claude
  Code `◐`/`✳`, Codex spinner and `[ ! ] Action Required`, Gemini CLI
  `◇ Ready` / `✋ Action Required`), and reads Claude Code's transcript, which
  records a denied permission immediately. The next real hook event takes
  over again.
- **`/compact` and resume reset a session to idle** (Claude Code fires
  `SessionStart` again, possibly mid-turn), which also re-armed the blink of
  an already acknowledged "done". A repeated `SessionStart` from the same
  process is now ignored.
- **Old conversations left behind by `/clear`, `/new` and `/resume`.** A new
  session in a terminal now replaces that terminal's previous one (OpenCode,
  which serves several sessions per process, is left alone).
- **Row names:** OpenCode's placeholder `New session - <date>` and status-only
  titles (`Ready (…)`, `Action Required`) no longer become the row name;
  Codex's ` | <project>` title suffix is dropped (the path is shown below).
- A session title containing a line break no longer corrupts the other
  fields of its state file.

### Known limitations

- OpenCode 2.x (the `opencode serve` generation) uses a new plugin API and is
  not supported yet.
- Codex sessions appear with their first prompt, and two Codex TUIs started in
  the same directory are told apart by focus.

## 0.1.0 — 2026-08-19

First release: one bar pill for every Claude Code, Codex, Gemini CLI and
OpenCode session, grouped by workspace, with click-to-focus, an attention
blink and per-agent hook setup from the panel.
