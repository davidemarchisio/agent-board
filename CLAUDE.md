# task board

All work is tracked with the `board` CLI (run `board` with no arguments for usage).
The board is one file, `~/.agent-board/board.json`, shared by every project and every agent.
Your project is detected from the git root of the current directory.

Identify yourself on every command with `--by <your name>` (claude, opencode, codex, ...).

- **Start of session:** run `board list` and `board ready`. Work only on tasks that exist on the board. If the user asks for something new, `board add "title"` first.
- **Pick work in this order:** `when` is `now`, then `next`, then `later`; inside a horizon, board order is priority. Only the user sets `when`; if a new task needs one, ask instead of guessing.
- **Before starting a task:** `board claim <id> --branch <branch>`.
- **When you stop, get blocked, or hand off:** `board note <id> "what is done, what is next, where to look"`, then one of `board block <id> "why"`, `board move <id> review`, `board move <id> merge`, or `board done <id>`.
- **Never** change priorities, titles, or other agents' tasks unless asked. Order on the board is priority.
