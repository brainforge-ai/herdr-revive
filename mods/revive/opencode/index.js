// herdr-revive: OpenCode plugin, the server's half. It does nothing: Revive's
// work is in ./tui.js, in the terminal interface. OpenCode's server also reads
// every folder in its plugins folder, and reports one without a server entry
// as a plugin that failed to load (checked with opencode 2.2.7).

export default {
  id: "herdr-revive",
  setup() {},
};
