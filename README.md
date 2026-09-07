# agent-board

A task board shared by you and your coding agents. Claude Code, OpenCode, Codex, anything that can run a shell command.

One JSON file. One CLI. One web page. No dependencies beyond Node.

## Why

Markdown backlogs go stale and are hard to read. Agents forget to record what they did, or record it in a file nobody reads. One wrong prompt and an agent reprioritises everything. Handing a half-finished task from one agent to another loses the context.

agent-board fixes this with a single file every agent must go through:

- **One board for all projects.** Each task carries a project name. One page shows everything.
- **Status lives in one place.** A task has one `status` field. Columns are just filters.
- **Every change is logged.** Who did what, when. You see who moved a task and why.
- **Handoff is a note.** An agent that stops writes what is done and what is next. The next agent reads it.
- **Claims are visible.** A claimed task shows its owner. Another agent trying to claim it gets refused.
- **You set priority.** Order on the board is priority. A `when` tag (now, next, later) tells agents where to look first. Agents are told not to change either.

## Install

```
git clone https://github.com/davidemarchisio/agent-board.git
cd agent-board
npm link
```

You now have a `board` command everywhere Node is on your PATH.

```
board add "write the spec"
board serve            # opens http://localhost:4444
```

The board file is `~/.agent-board/board.json`. Override with `BOARD_FILE=/path/to/file`.

## The page

`board serve [port]` runs a tiny local server on 127.0.0.1 and serves the board.

- Six columns: todo, doing, blocked, review, merge, done.
- Drag a card between columns to change status. Drag within a column to reorder.
- Click a card to edit title, project, when, owner, branch, spec, deps, and to read the history or add a note.
- Filter by project and by when. Hide the done column.
- Cards show owner, branch, unmet dependencies in bold, and the last note. A card in doing with no update for 24 hours gets an amber edge.
- Refreshes every 2 seconds, so agent changes appear as they happen.

## The CLI

```
board add "title" [--when now|next|later] [--spec path] [--dep id]... [--branch b]
board list [--status s] [--when w] [--all]
board ready [--all]                       todo tasks whose deps are all done
board show <id>                           full task with history
board claim <id> [--branch b]             owner = you, status = doing
board move <id> todo|doing|blocked|review|merge|done
board done <id>                           same as move done
board block <id> "why"                    move to blocked and record why
board note <id> "text"                    append a note (handoff message)
board edit <id> [--title t] [--when w] [--owner o] [--branch b] [--spec p] [--project p] [--dep id]...
board rm <id>
board serve [port]                        default 4444
board file                                print the board path
```

Flags that work on every command:

- `--by <name>` says who is acting. Default is `BOARD_AGENT` from the environment, then your username. Agents pass `--by claude`, `--by opencode`, and so on.
- `--project <name>` overrides the project. Default is the name of the git root of the current directory, or the current directory name. `list` and `ready` show only the current project unless `--all`.
- `--json` prints raw JSON instead of the one-line format.

## The file

```json
{
  "next_id": 3,
  "tasks": [
    {
      "id": 1,
      "title": "write the spec",
      "project": "agent-board",
      "status": "doing",
      "when": "now",
      "owner": "claude",
      "branch": "feat/spec",
      "spec": "docs/spec.md",
      "deps": [],
      "created_at": "2026-09-07T20:49:17.138Z",
      "updated_at": "2026-09-07T21:02:40.512Z",
      "history": [
        { "at": "2026-09-07T20:49:17.138Z", "by": "pingu",  "type": "create", "text": "write the spec" },
        { "at": "2026-09-07T20:55:01.004Z", "by": "claude", "type": "status", "text": "todo -> doing" },
        { "at": "2026-09-07T21:02:40.512Z", "by": "claude", "type": "note",   "text": "schema done, page next" }
      ]
    }
  ]
}
```

Array order is priority. `status` is the only place status is stored. `history` is append-only. You can edit the file by hand; the CLI and the page pick it up.

Writes go through a lock file and an atomic rename, so two agents writing at the same time do not lose each other's changes.

## Telling agents about the board

Agents only know the board exists if their instructions say so. `AGENTS.md` in this repo holds the rules block. `CLAUDE.md` is an identical copy for setups that only use Claude Code. Copy either into a project root, or paste the block into `~/.claude/CLAUDE.md` once to cover every project.

The block:

```
# task board

All work is tracked with the `board` CLI (run `board` with no arguments for usage).
The board is one file, `~/.agent-board/board.json`, shared by every project and every agent.
Your project is detected from the git root of the current directory.

Identify yourself on every command with `--by <your name>` (claude, opencode, codex, ...).

- Start of session: run `board list` and `board ready`. Work only on tasks that exist on the board. If the user asks for something new, `board add "title"` first.
- Pick work in this order: `when` is `now`, then `next`, then `later`; inside a horizon, board order is priority. Only the user sets `when`; if a new task needs one, ask instead of guessing.
- Before starting a task: `board claim <id> --branch <branch>`.
- When you stop, get blocked, or hand off: `board note <id> "what is done, what is next, where to look"`, then one of `board block <id> "why"`, `board move <id> review`, `board move <id> merge`, or `board done <id>`.
- Never change priorities, titles, or other agents' tasks unless asked. Order on the board is priority.
```

## Claude Code stop hook (optional)

Rules are suggestions. `hooks/stop.js` adds one piece of enforcement for Claude Code: it refuses to let Claude end its turn while a task Claude claimed sits in doing with no board activity for 10 minutes. Claude receives the message and is told to add a note or move the task. It nags once per stop, not in a loop.

Register it in `~/.claude/settings.json` for every project, or in `<project>/.claude/settings.json` for one:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 10,
            "command": "BOARD_AGENT=claude node /path/to/agent-board/hooks/stop.js"
          }
        ]
      }
    ]
  }
}
```

OpenCode and Codex have no hooks. They rely on the rules block alone.

## Test

```
npm test
```

Runs a CLI round trip and 20 parallel writers against a temporary board.

## Layout

```
board.js      CLI, storage, and the web server. Everything.
index.html    the page
hooks/stop.js Claude Code stop hook
test.js       the check
AGENTS.md     rules block for agents
CLAUDE.md     same block, for Claude-only setups
```

## License

MIT
