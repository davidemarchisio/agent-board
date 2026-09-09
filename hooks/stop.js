#!/usr/bin/env node
// Claude Code Stop hook: refuse to end the turn while a task claimed by THIS session
// sits in "doing" with no board activity in the last 10 minutes.
// Exit 2 + stderr = Claude gets the message and keeps working. Exit 0 = stop allowed.
const { load } = require('../board.js');
let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  let j = {}; try { j = JSON.parse(input); } catch {}
  if (j.stop_hook_active) return; // already nagged once this stop; do not loop
  if (!j.session_id) return; // cannot tell our tasks from another session's; stay quiet
  const agent = process.env.BOARD_AGENT || 'claude';
  const me = agent + ':' + j.session_id.slice(0, 8); // matches the owner board.js writes
  const cutoff = Date.now() - 10 * 60 * 1000;
  const stale = load().tasks.filter(t => t.status === 'doing' && t.owner === me && new Date(t.updated_at) < cutoff);
  if (!stale.length) return;
  console.error(`board: ${stale.map(t => '#' + t.id + ' ' + t.title).join(', ')} still in doing with no update. ` +
    `Run: board note <id> "what is done, what is next" --by ${agent}, then block/move/done it (or leave it in doing if you are continuing).`);
  process.exit(2);
});
