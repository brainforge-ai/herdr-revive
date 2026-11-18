// herdr-revive: OpenCode plugin. OpenCode has no hooks file, so this runs Revive's
// engine the way Claude Code's SessionStart and SessionEnd hooks do, with the same
// payload. `revive.mjs install` links this folder into OpenCode's plugins folder
// (~/.config/opencode/plugins/herdr-revive). What it shares with pi's and omp's
// extensions is in ../lib/extension.js.
//
// It is a plugin for the terminal interface, not for the server: by default every
// OpenCode on the machine talks to one background server, which can't tell which
// terminal a session is in. All of this was read off opencode 2.2.7:
// - There is no session event to hook for "this terminal shows that session", so the
//   route is looked at once a second. `--continue` opens on a placeholder id until
//   the session is loaded; only a session OpenCode knows is recorded.
// - A subagent's session is shown under the one that started it: the root is recorded.
// - The cleanup `setup` returns runs when OpenCode exits, and also when it reloads
//   its plugins. It carries no reason, and SIGTERM and SIGHUP (a reboot, a core
//   restart, a closed terminal) run the same teardown as a person's exit. After a
//   signal nothing is sent; otherwise the engine settles it by whether the terminal
//   outlived OpenCode (`settle` in ../lib/core.js).

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The helper is in the mod folder above this file; OpenCode loads this file through a link.
const HELPER = pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "lib", "extension.js")).href;
const EVERY_MS = 1000;

/** The session on screen, as its root's id, or null: the home screen, another plugin's page, a session still loading. */
function shown(api) {
  const route = api.ui.router.current();
  if (route?.type !== "session" || typeof route.sessionID !== "string") return null;
  if (!api.data.session.get(route.sessionID)) return null;
  const root = api.data.session.root(route.sessionID);
  return typeof root === "string" && root ? root : route.sessionID;
}

export default {
  id: "herdr-revive",
  async setup(api) {
    if (!process.env.HC_TERMINAL_ID) return;
    const { revive } = await import(HELPER);
    const engine = revive({ agent: "opencode", args: ["--agent", "opencode"] });
    let recorded = null;

    const look = () => {
      let session = null;
      // OpenCode's data may not be there yet, or its shape may have changed: record nothing.
      try { session = shown(api); } catch { return; }
      if (!session || session === recorded) return;
      const source = recorded ? "switch" : "startup";
      recorded = session;
      // Not awaited: OpenCode goes on while the engine records it.
      void engine.post({ hook_event_name: "SessionStart", session_id: session, cwd: process.cwd(), source });
    };

    engine.listen();
    look();
    const timer = setInterval(look, EVERY_MS);
    timer.unref?.();

    return async () => {
      clearInterval(timer);
      // A signal handler registered after OpenCode's own runs after it: let it run first.
      // A reboot, a core restart or a kill (Claude Code's reason "other") keeps the record.
      if (await engine.ended() || !recorded) return engine.queue;
      // /exit, Ctrl+C, Ctrl+D, or a reload of the plugins: the engine tells which.
      return engine.post({ hook_event_name: "SessionEnd", session_id: recorded, cwd: process.cwd(), reason: "exit" });
    };
  },
};
