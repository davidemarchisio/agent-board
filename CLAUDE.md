# task board

All work is tracked with the `board` CLI (run `board` with no arguments for usage).
The board is one file, `~/.agent-board/board.json`, shared by every project and every agent.
Your project is detected from the git root of the current directory.

Identify yourself on every command with `--by <your name>` (claude, opencode, codex, ...).
`board.js` refuses to run write commands (add/claim/move/done/block/note/edit/rm) without an identity.
Claude Code and OpenCode set `BOARD_AGENT` automatically (see `.claude/settings.json` and
the `board-session.js` OpenCode plugin) — codex has no equivalent hook, so it must pass `--by codex`
on every write command, or its launch shell must `export BOARD_AGENT=codex` before starting codex.

- **Start of session:** run `board list` and `board ready`. Work only on tasks that exist on the board. If the user asks for something new, `board add "title"` first.
- **Pick work in this order:** `when` is `now`, then `next`, then `later`; inside a horizon, board order is priority. Only the user sets `when`; if a new task needs one, ask instead of guessing.
- **Before starting a task:** `board claim <id> --branch <branch>`.
- **When you stop, get blocked, or hand off:** `board note <id> "what is done, what is next, where to look"`, then one of:
  - `board block <id> "why"` — you need a human's input or decision before you can keep going.
  - `board move <id> review --pr <pr url>` — the work is done and ready for someone to review. Moving to review or merge fails without a PR link.
  - `board move <id> merge` — the PR is reviewed and ready to merge, and a human needs to merge it. Agents never merge PRs themselves.
  - `board done <id>` — fully finished (already merged, or no PR involved).
- **Never** change priorities, titles, or other agents' tasks unless asked. Order on the board is priority.
