# agent-board

Task board shared by you and your coding agents (Claude Code, OpenCode, anything with a shell).
One JSON file, one CLI, one page. No dependencies.

- data: `~/.agent-board/board.json` (override with `BOARD_FILE`)
- tasks carry a `project`, so every project shares one board and one page
- every change is appended to the task's `history` with who did it and when

## install

```
npm link          # gives you the `board` command
board serve       # http://localhost:4444
```

## cli

```
board add "title" [--spec path] [--dep id]... [--branch b]
board list [--status s] [--all]     board ready [--all]     board show <id>
board claim <id> [--branch b]       board move <id> todo|doing|blocked|review|merge|done
board done <id>   board block <id> "why"   board note <id> "text"
board edit <id> [--title t] [--owner o] [--branch b] [--spec p] [--project p] [--dep id]...
board rm <id>     board file
```

`--by <name>` or `BOARD_AGENT=<name>` sets who is acting (default: your username).
`--project` defaults to the git root name of the current directory; `list` and `ready` show only that project unless `--all`.
`--json` on any command prints raw JSON.

## agent rules

Paste into `CLAUDE.md` / `AGENTS.md` (global or per project):

```
## task board
All work is tracked with the `board` CLI (run `board` for usage). Identify yourself with `--by claude` (or opencode, etc).
- Start of session: `board list` and `board ready`. Work only on tasks that exist on the board; if the user asks for something new, `board add` it first.
- Before starting a task: `board claim <id> --branch <branch>`.
- When you stop, get blocked, or hand off: `board note <id> "what is done, what is next, where to look"`. Then `board block <id> "why"` or `board move <id> review` or `board done <id>`.
- Never change priorities, titles, or other tasks unless asked. Order on the board is priority.
```

## test

```
npm test
```

## agent rules in this repo

`AGENTS.md` holds the rules block (OpenCode, Codex, and others read it). `CLAUDE.md` is one line, `@AGENTS.md`, so Claude Code reads the same file. Copy both into any project, or paste the block into `~/.claude/CLAUDE.md` once for every project.

## claude code stop hook (optional enforcement)

`hooks/stop.js` refuses to let Claude end its turn while a task it claimed sits in `doing` with no board update in 10 minutes. Claude gets the message and is told to add a note or move the task. It nags once per stop, not in a loop. Add to `~/.claude/settings.json`:

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "timeout": 10,
  "command": "BOARD_AGENT=claude node /home/pingu/projects/agent-board/agent-board/hooks/stop.js" } ] } ] } }
```

OpenCode has no hooks; it relies on `AGENTS.md` only.
