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

## Who owns a task

`--by claude` says which tool claimed a task. It does not say which window. Run four Claude sessions on four different tasks and every one of them owns tasks as `claude`, which makes "is this mine?" unanswerable.

So the CLI appends a session suffix when it can find one: owners come out as `claude:db0f1516`, `opencode:9f2a1c04`. It reads `BOARD_SESSION` first, then `CLAUDE_CODE_SESSION_ID`, and falls back to the bare name if neither is set. Agents keep passing `--by claude`; the suffix is added for them.

| agent | where the session id comes from |
| --- | --- |
| Claude Code | `CLAUDE_CODE_SESSION_ID`, already in the environment |
| OpenCode | `hooks/opencode-board-session.js`, a plugin using the `shell.env` hook |
| Codex | nothing automatic; launch it as `BOARD_SESSION=$(uuidgen) codex` |

One consequence: a second session of the same agent can no longer claim a task the first left in doing. That is usually what you want. `board edit <id> --owner ""` takes it over anyway.

## Installing in your agent

Two pieces per agent. The rules block tells the agent the board exists. The hook is the part that does not rely on the agent remembering.

`hooks/stop.js` refuses to end a turn while a task **this session** claimed sits in doing with no board activity for 10 minutes. The agent gets the message and is told to add a note or move the task. Claude Code and Codex send the same JSON on stdin and both read exit 2 plus stderr as "keep going", so one script covers both. It nags at most once a minute per session and never about another session's tasks.

### Claude Code

Rules: paste the block into `~/.claude/CLAUDE.md`, or drop `CLAUDE.md` in a project root.

Hook: `~/.claude/settings.json` for every project, or `<project>/.claude/settings.json` for one. This repo's own `.claude/settings.json` is a working copy.

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

Nothing else to do: Claude Code already puts `CLAUDE_CODE_SESSION_ID` in the environment, so owners come out session-tagged on their own.

### Codex

Rules: paste the block into `~/.codex/AGENTS.md`, or drop `AGENTS.md` in a project root.

Hook: copy `hooks/codex-hooks.json` to `~/.codex/hooks.json` (or `<project>/.codex/hooks.json`) and fix the path in it. Same script, same exit-2 contract. Codex reviews unmanaged hooks before it will run them, so expect a trust prompt the first time.

Codex does not hand tools a session id, so start it with one:

```
BOARD_SESSION=$(uuidgen) codex
```

Without that, every Codex window owns tasks as plain `codex` and the hook stays quiet rather than nagging the wrong window.

### OpenCode

Rules: paste the block into `~/.config/opencode/AGENTS.md`, or drop `AGENTS.md` in a project root.

Session id: copy or symlink `hooks/opencode-board-session.js` into `~/.config/opencode/plugins/` (or `.opencode/plugins/` for one project). Everything in those directories loads at startup. The `plugin` array in `opencode.json` is for npm package names, not file paths.

```
ln -s "$PWD/hooks/opencode-board-session.js" ~/.config/opencode/plugins/board-session.js
```

No stop hook. OpenCode has a `session.idle` event, but a plugin is told the turn ended rather than asked, so it cannot refuse one the way exit 2 does. OpenCode gets session-tagged owners and the rules block, not enforcement.

### Another agent

The hook needs two things from its host: the session id on stdin as `session_id`, and exit 2 meaning "keep working". If your agent has both, point it at `hooks/stop.js` with `BOARD_AGENT` set to its name. If it can only inject environment variables, set `BOARD_SESSION` and you still get correct ownership without the nag.

## Test

```
npm test
```

Runs a CLI round trip and 20 parallel writers against a temporary board.

## Layout

```
board.js      CLI, storage, and the web server. Everything.
index.html    the page
hooks/stop.js                    stop hook for Claude Code and Codex
hooks/codex-hooks.json           Codex hooks.json to copy
hooks/opencode-board-session.js  OpenCode plugin: session id -> BOARD_SESSION
test.js       the check
AGENTS.md     rules block for agents
CLAUDE.md     same block, for Claude-only setups
```

## License

MIT
