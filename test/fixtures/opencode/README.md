Hook input as Revive's own plugin (`mods/revive/opencode/tui.js`) sent it to
`revive.mjs hook --agent opencode` from opencode 2.2.7 on Linux, byte for byte
except `cwd` (set to `/w`). OpenCode has no hooks of its own, so these are what
the plugin built from the route and the sessions that version showed it.
`session-start.json` and `session-end-exit.json` are one session, started with
`opencode --standalone` and ended with Ctrl+C. `session-start-auto.json` is a
session started with `opencode --standalone --auto`, and
`session-start-resumed.json` the same session after Revive's shell block
resumed it, which left `--auto` out. Sent SIGTERM or SIGHUP, the plugin sent no
end at all, so there is no fixture for that.
