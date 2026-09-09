// OpenCode plugin: give board.js an identity and a per-session id, the same way
// Claude Code's BOARD_AGENT/CLAUDE_CODE_SESSION_ID do. Without BOARD_AGENT, board.js
// refuses to run mutating commands unless every one passes --by explicitly. Without
// BOARD_SESSION, every OpenCode window claims tasks as plain "opencode" and they
// cannot be told apart.
//
// Install: copy or symlink into ~/.config/opencode/plugins/ (global) or
// .opencode/plugins/ (one project). Files there load at startup.
export const BoardSession = async () => ({
  "shell.env": async (input, output) => {
    output.env.BOARD_AGENT = "opencode";
    if (input.sessionID) output.env.BOARD_SESSION = input.sessionID;
  },
});
