#!/usr/bin/env node
// Stop hook for Claude Code and Codex. Both send the same JSON on stdin and both
// treat "exit 2 + stderr" as "do not end the turn, here is why".
//
// Refuses to end the turn while a task claimed by THIS session sits in "doing"
// with no board activity in the last 10 minutes. Exit 0 = stop allowed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('../board.js');

const STALE_MS = 10 * 60 * 1000;
const NAG_EVERY_MS = 60 * 1000; // brake: never nag the same session twice in a minute

let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  let j = {}; try { j = JSON.parse(input); } catch {}
  if (j.stop_hook_active) return; // Claude Code: already nagged once this stop
  if (!j.session_id) return; // cannot tell our tasks from another session's; stay quiet

  const agent = process.env.BOARD_AGENT || 'claude';
  const me = agent + ':' + j.session_id.slice(0, 8); // matches the owner board.js writes
  const stale = load().tasks.filter(t =>
    t.status === 'doing' && t.owner === me && new Date(t.updated_at) < Date.now() - STALE_MS);
  if (!stale.length) return;

  // Codex has no stop_hook_active, and a blocked stop becomes a fresh prompt, so the
  // marker is what stops a stubborn agent from bouncing off this hook forever.
  const mark = path.join(os.tmpdir(), 'board-nag-' + j.session_id.replace(/[^\w-]/g, '') + '.mark');
  try { if (Date.now() - fs.statSync(mark).mtimeMs < NAG_EVERY_MS) return; } catch {}
  try { fs.writeFileSync(mark, ''); } catch {}

  console.error(`board: ${stale.map(t => '#' + t.id + ' ' + t.title).join(', ')} still in doing with no update. ` +
    `Run: board note <id> "what is done, what is next" --by ${agent}, then block/move/done it (or leave it in doing if you are continuing).`);
  process.exit(2);
});
