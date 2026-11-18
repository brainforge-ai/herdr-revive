// OpenCode: recognized, its flags carried, its sessions resumed, and its plugin
// against a fake OpenCode and a fake engine that logs what it is sent. The
// plugin's view of OpenCode (the route, the sessions) is as opencode 2.2.7 gives it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  agentKey, carriedFlags, attendedFlags, command, canFork, endAction, isOneShot, needsOf, needsHint, readRecord, shouldResume, resumeLine, resumeScript,
} from "../mods/revive/lib/core.js";
import { findSession } from "../mods/revive/lib/sessions.js";

const ID = "ses_e11b76617ffeyzHDQ0LidWfV5F";
const CHILD = "ses_e11b7a2c4ffeQ0pLk3VnWm8sTz";
const OTHER = "ses_e11c00d55ffe9aXbYcZdWeVfUg";

test("opencode is known by its command line and its report, and never as an argument", () => {
  assert.equal(agentKey("opencode"), "opencode");
  assert.equal(agentKey(null, ["opencode"]), "opencode");
  assert.equal(agentKey(null, ["/home/me/.opencode/bin/opencode", "--session", ID]), "opencode");
  // npm's launcher runs it under an interpreter.
  assert.equal(agentKey(null, ["node", "/usr/local/lib/node_modules/opencode-ai/bin/opencode"]), "opencode");
  assert.equal(agentKey(null, ["C:\\Users\\me\\.opencode\\bin\\opencode.exe"]), "opencode");
  // It is also what people call the folder they keep it in.
  assert.equal(agentKey(null, ["ls", "opencode"]), null);
  assert.equal(agentKey(null, ["vim", "/src/opencode"]), null);
});

test("opencode resumes with --session, keeps its flags, and has no fork", () => {
  assert.deepEqual(command({ agent: "opencode", session: ID, flags: ["--standalone"] }), ["opencode", "--standalone", "--session", ID]);
  assert.equal(command({ agent: "opencode", session: ID, flags: [] }, "fork"), null);
  assert.equal(canFork("opencode"), false);
  assert.equal(command({ agent: "opencode", session: "ses_x; rm -rf ~" }), null, "an id that isn't one is refused");
  assert.deepEqual(
    carriedFlags("opencode", ["opencode", "--standalone", "--auto", "--continue", "--session", "ses_old", "--prompt", "fix it", "--server", "http://10.0.0.5:4096", "--log-level", "debug", "/w"]),
    ["--standalone", "--auto"],
  );
  assert.deepEqual(carriedFlags("opencode", ["opencode", "constructor"]), []);
});

test("an automatic resume leaves out every spelling of OpenCode's auto-approve", () => {
  const flags = ["--standalone", "--auto", "--yolo", "--dangerously-skip-permissions"];
  assert.deepEqual(carriedFlags("opencode", ["opencode", ...flags]), flags);
  assert.deepEqual(attendedFlags("opencode", flags), { kept: ["--standalone"], dropped: ["--auto", "--yolo", "--dangerously-skip-permissions"] });
  const rec = { agent: "opencode", session: ID, cwd: "/w", flags };
  assert.deepEqual(command(rec), ["opencode", ...flags, "--session", ID], "by hand, from the dialog, they stay");
  assert.deepEqual(command(rec, "resume", { unattended: true }), ["opencode", "--standalone", "--session", ID]);
  const line = resumeLine(rec, { unattended: true });
  assert.ok(line.endsWith(`opencode --standalone --session ${ID}`), line);
  // The flags stay on record for a later resume by hand; none is on the command line.
  assert.equal(line.replace(/REVIVE_RESUME='[^']*' /, ""), `cd -- /w && opencode --standalone --session ${ID}`);
  const script = resumeScript(rec, "/mods/revive/revive.mjs");
  assert.match(script, /resuming.*OpenCode.*session ses_e11b/);
  assert.match(script, /without --auto, --yolo, --dangerously-skip-permissions \(only a resume from the Revive dialog keeps them\)/);
});

test("opencode's subcommands are not sessions to bring back", () => {
  for (const argv of [["opencode", "run", "fix it"], ["opencode", "serve", "--service"], ["opencode", "--print-logs", "run", "hi"],
    ["opencode", "--log-level", "debug", "serve"], ["opencode", "session", "list"], ["opencode", "upgrade"], ["opencode", "acp"]]) {
    assert.equal(isOneShot("opencode", argv), true, argv.join(" "));
  }
  for (const argv of [["opencode"], ["opencode", "--continue"], ["opencode", "--session", "run"], ["opencode", "--prompt", "serve", "--auto"],
    ["opencode", "/work/run"], ["/home/me/.opencode/bin/opencode", "-s", ID]]) {
    assert.equal(isOneShot("opencode", argv), false, argv.join(" "));
  }
});

test("a session on another server, or in another data folder, is never resumed by itself", () => {
  assert.deepEqual(needsOf("opencode", ["opencode", "--server", "http://10.0.0.5:4096"], { HOME: "/h" }), ["--server"]);
  assert.deepEqual(needsOf("opencode", ["opencode", "--server=http://10.0.0.5:4096"], { XDG_DATA_HOME: "/d", OPENCODE_DB: "work.db" }), ["OPENCODE_DB", "XDG_DATA_HOME", "--server"]);
  assert.deepEqual(needsOf("opencode", ["opencode", "--auto"], {}), []);
  const remote = readRecord({ "revive.agent": "opencode", "revive.session": ID, "revive.needs": '["--server"]', "revive.shell": "1", "revive.cwd": "/w" });
  const v = shouldResume(remote, { pid: 2, shellPid: 2, env: {} });
  assert.deepEqual([v.go, v.hint], [false, true]);
  assert.match(v.why, /--server/);
  assert.equal(needsHint(remote), `Fill in --server, then run: cd -- /w && opencode --server <url> --session ${ID}`);
  const data = readRecord({ "revive.agent": "opencode", "revive.session": ID, "revive.needs": '["XDG_DATA_HOME"]', "revive.shell": "1" });
  assert.equal(shouldResume(data, { pid: 2, shellPid: 2, env: {} }).go, false);
  assert.equal(shouldResume(data, { pid: 2, shellPid: 2, env: { XDG_DATA_HOME: "/d" } }).go, true, "the shell sets it itself");
});

test("opencode's end is always settled by whether the terminal outlived it, and no running session is found from files", () => {
  for (const reason of ["exit", "other", "prompt_input_exit", null, undefined]) assert.equal(endAction("opencode", reason), "settle", String(reason));
  assert.equal(findSession("opencode", { pid: 1, cwd: "/w" }), null);
});

// ── the plugin ──────────────────────────────────────────────────────────────

/**
 * The plugin and its helper in a mod folder of its own, set up in a fake
 * OpenCode whose route and sessions the test moves. `tick` is one look at the
 * route, as the plugin takes every second.
 */
async function load(t, { route = { type: "home" }, sessions = {}, env = { HC_TERMINAL_ID: "t1" } } = {}) {
  const mod = mkdtempSync(join(tmpdir(), "revive-opencode-"));
  mkdirSync(join(mod, "opencode"));
  mkdirSync(join(mod, "lib"));
  copyFileSync("mods/revive/lib/extension.js", join(mod, "lib", "extension.js"));
  copyFileSync("mods/revive/opencode/tui.js", join(mod, "opencode", "tui.js"));
  writeFileSync(join(mod, "package.json"), '{ "type": "module" }\n');
  // The fake engine: one line per hook.
  writeFileSync(join(mod, "revive.mjs"), `import fs from "node:fs";
let text = ""; for await (const c of process.stdin) text += c;
fs.appendFileSync(${JSON.stringify(join(mod, "log"))}, JSON.stringify([process.argv.slice(2), JSON.parse(text)]) + "\\n");
`);
  const state = { route, sessions };
  const api = {
    ui: { router: { current: () => state.route } },
    data: {
      session: {
        get: (id) => state.sessions[id],
        root: (id) => { while (state.sessions[id]?.parentID) id = state.sessions[id].parentID; return id; },
      },
    },
  };
  t.mock.timers.enable({ apis: ["setInterval"] });
  const saved = process.env.HC_TERMINAL_ID;
  process.env.HC_TERMINAL_ID = env.HC_TERMINAL_ID ?? "";
  let cleanup;
  try {
    const plugin = (await import(pathToFileURL(join(mod, "opencode", "tui.js")))).default;
    cleanup = await plugin.setup(api);
  } finally {
    if (saved === undefined) delete process.env.HC_TERMINAL_ID; else process.env.HC_TERMINAL_ID = saved;
  }
  const log = () => (existsSync(join(mod, "log")) ? readFileSync(join(mod, "log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { state, cleanup, log, tick: () => t.mock.timers.tick(1000) };
}

const session = (id, parentID) => ({ id, ...(parentID ? { parentID } : {}) });
const open = (id) => ({ type: "session", sessionID: id });

test("the plugin is a terminal one with a server half that does nothing", async () => {
  const tui = (await import("../mods/revive/opencode/tui.js")).default;
  const server = (await import("../mods/revive/opencode/index.js")).default;
  assert.equal(tui.id, "herdr-revive");
  assert.equal(typeof tui.setup, "function");
  assert.equal(server.id, "herdr-revive");
  assert.equal(server.setup(), undefined);
});

test("opencode's open session and its exit reach the engine as Claude-shaped hooks", async (t) => {
  const oc = await load(t, { route: open(ID), sessions: { [ID]: session(ID) } });
  await oc.cleanup();
  const [[args, start], [, end]] = oc.log();
  assert.deepEqual(args, ["hook", "--agent", "opencode"]);
  assert.equal(start.hook_event_name, "SessionStart");
  assert.equal(start.session_id, ID);
  assert.equal(start.cwd, process.cwd());
  assert.equal(start.argv[0], "opencode");
  const { source, ...rest } = start;
  assert.equal(source, "startup");
  assert.deepEqual(end, { ...rest, hook_event_name: "SessionEnd", reason: "exit" });
});

test("a session opened later, or loaded after --continue's placeholder, is recorded when it is there", async (t) => {
  // `opencode --continue` opens on the id "dummy" until the last session is loaded.
  const oc = await load(t, { route: open("dummy") });
  oc.tick();
  assert.deepEqual(oc.log(), []);
  oc.state.route = open(ID);
  oc.tick();
  assert.deepEqual(oc.log(), [], "not one OpenCode knows yet");
  oc.state.sessions[ID] = session(ID);
  oc.tick();
  oc.tick();
  await oc.cleanup();
  assert.deepEqual(oc.log().map(([, p]) => [p.hook_event_name, p.session_id]), [["SessionStart", ID], ["SessionEnd", ID]]);
});

test("a subagent's session is recorded as the one that started it, and another session as a switch", async (t) => {
  const oc = await load(t, { route: open(ID), sessions: { [ID]: session(ID), [CHILD]: session(CHILD, ID), [OTHER]: session(OTHER) } });
  oc.state.route = open(CHILD);
  oc.tick();
  oc.state.route = open(OTHER);
  oc.tick();
  // The home screen, or another plugin's page: the last session stays on record.
  oc.state.route = { type: "home" };
  oc.tick();
  oc.state.route = { type: "plugin", id: "opencode.stats", name: "stats" };
  oc.tick();
  await oc.cleanup();
  const events = oc.log().map(([, p]) => [p.hook_event_name, p.session_id, p.source ?? p.reason]);
  assert.deepEqual(events, [["SessionStart", ID, "startup"], ["SessionStart", OTHER, "switch"], ["SessionEnd", OTHER, "exit"]]);
});

test("opencode ended by a signal keeps its session", async (t) => {
  for (const signal of ["SIGTERM", "SIGHUP"]) {
    const oc = await load(t, { route: open(ID), sessions: { [ID]: session(ID) } });
    // OpenCode's own handler starts the teardown; Revive's listener runs right after it.
    const done = oc.cleanup();
    process.emit(signal, signal);
    await done;
    assert.deepEqual(oc.log().map(([, p]) => p.hook_event_name), ["SessionStart"], signal);
    t.mock.timers.reset();
  }
});

test("opencode listens for SIGTERM and SIGHUP only while the plugin is set up", async (t) => {
  const count = () => ["SIGTERM", "SIGHUP"].map((s) => process.listenerCount(s));
  const before = count();
  const oc = await load(t, { route: open(ID), sessions: { [ID]: session(ID) } });
  assert.deepEqual(count(), before.map((n) => n + 1));
  await oc.cleanup();
  assert.deepEqual(count(), before);
  // Once cleaned up (a reload of the plugins), it looks at the route no more.
  oc.state.route = open(OTHER);
  oc.state.sessions[OTHER] = session(OTHER);
  oc.tick();
  assert.deepEqual(oc.log().map(([, p]) => p.hook_event_name), ["SessionStart", "SessionEnd"]);
});

test("opencode outside a herdr terminal, or with no session open, sends nothing", async (t) => {
  const outside = await load(t, { route: open(ID), sessions: { [ID]: session(ID) }, env: { HC_TERMINAL_ID: "" } });
  assert.equal(outside.cleanup, undefined);
  assert.deepEqual(outside.log(), []);
  t.mock.timers.reset();
  const home = await load(t);
  home.tick();
  await home.cleanup();
  assert.deepEqual(home.log(), []);
});

test("a route or a session store the plugin can't read records nothing and breaks nothing", async (t) => {
  const oc = await load(t, { route: open(ID), sessions: { [ID]: session(ID) } });
  oc.state.sessions = null;
  oc.state.route = open(OTHER);
  oc.tick();
  oc.state.route = null;
  oc.tick();
  oc.state.route = { type: "session" };
  oc.tick();
  await oc.cleanup();
  assert.deepEqual(oc.log().map(([, p]) => [p.hook_event_name, p.session_id]), [["SessionStart", ID], ["SessionEnd", ID]]);
});
