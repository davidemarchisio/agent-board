// one runnable check: CLI round trip on a temp board, plus parallel writers under the lock.
const { execFileSync, spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
const env = { ...process.env, BOARD_FILE: path.join(dir, 'b.json') };
delete env.BOARD_SESSION; delete env.CLAUDE_CODE_SESSION_ID; // keep identities bare unless a test sets one
const run = (...a) => execFileSync('node', [path.join(__dirname, 'board.js'), ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

run('add', 'write spec', '--project', 'p', '--by', 'pingu');
run('add', 'implement', '--project', 'p', '--dep', '1', '--by', 'pingu', '--when', 'now');
assert.match(run('list', '--all', '--when', 'now'), /#2 \[todo now\]/); assert.doesNotMatch(run('list', '--all', '--when', 'now'), /#1/);
assert.throws(() => run('edit', '2', '--when', 'someday'), /when must be/);
assert.match(run('ready', '--all'), /#1/); assert.doesNotMatch(run('ready', '--all'), /#2/);
run('claim', '1', '--by', 'claude', '--branch', 'feat/spec');
assert.throws(() => run('claim', '1', '--by', 'opencode'), /owned by claude/);
run('note', '1', 'half done, see spec.md', '--by', 'claude');
run('done', '1', '--by', 'claude');
assert.match(run('ready', '--all'), /#2/);
run('block', '2', 'waiting on review', '--by', 'opencode');
const t2 = JSON.parse(run('show', '2', '--json'));
assert.strictEqual(t2.status, 'blocked');
assert.strictEqual(t2.history.at(-1).text, 'todo -> blocked: waiting on review');
assert.match(run('show', '1'), /claude note: half done/);

// two sessions of the same agent get distinct owners and cannot claim each other's work.
const runIn = (sid, ...a) => execFileSync('node', [path.join(__dirname, 'board.js'), ...a],
  { env: { ...env, BOARD_SESSION: sid }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
runIn('aaaaaaaa11', 'add', 'session scoped', '--project', 'p', '--by', 'claude');
assert.strictEqual(JSON.parse(runIn('aaaaaaaa11', 'claim', '3', '--by', 'claude', '--json')).owner, 'claude:aaaaaaaa');
assert.throws(() => runIn('bbbbbbbb22', 'claim', '3', '--by', 'claude'), /owned by claude:aaaaaaaa/);
assert.strictEqual(JSON.parse(run('show', '3', '--json')).history.at(-1).by, 'claude:aaaaaaaa');

// 20 parallel adds must all land (lock + atomic write).
Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((res, rej) => {
  const p = spawn('node', [path.join(__dirname, 'board.js'), 'add', 'par ' + i, '--project', 'p'], { env });
  p.on('exit', c => c === 0 ? res() : rej(new Error('exit ' + c)));
}))).then(() => {
  const b = JSON.parse(fs.readFileSync(env.BOARD_FILE, 'utf8'));
  assert.strictEqual(b.tasks.length, 23);
  assert.strictEqual(new Set(b.tasks.map(t => t.id)).size, 23);
  assert.ok(!fs.existsSync(env.BOARD_FILE + '.lock'));
  fs.rmSync(dir, { recursive: true });
  console.log('ok');
});
