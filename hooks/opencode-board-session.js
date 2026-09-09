// OpenCode plugin: give board.js a per-session identity, the same way Claude Code's
// CLAUDE_CODE_SESSION_ID does. Without it every OpenCode window claims tasks as plain
// "opencode" and they cannot be told apart.
//
// Install: copy or symlink into ~/.config/opencode/plugins/ (global) or
// .opencode/plugins/ (one project). Files there load at startup.
export const BoardSession = async () => ({
  "shell.env": async (input, output) => {
    if (input.sessionID) output.env.BOARD_SESSION = input.sessionID;
  },
});
