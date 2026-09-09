// OpenCode plugin: give board.js a per-session identity, the same way Claude Code's
// CLAUDE_CODE_SESSION_ID does. Without it every OpenCode window claims tasks as plain
// "opencode" and they cannot be told apart.
// Install: add this file's directory to the "plugin" array in opencode.json,
// or copy it into .opencode/plugin/ in your project.
export const BoardSession = async () => ({
  "shell.env": async (input, output) => {
    if (input.sessionID) output.env.BOARD_SESSION = input.sessionID;
  },
});
