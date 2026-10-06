// one runnable check: CLI round trip on a temp board, plus parallel writers under the lock.
const { execFileSync, spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
const env = { ...process.env, BOARD_FILE: path.join(dir, 'b.json') };
delete env.BOARD_SESSION; delete env.CLAUDE_CODE_SESSION_ID; delete env.BOARD_AGENT; // keep identities bare unless a test sets one
const run = (...a) => execFileSync('node', [path.join(__dirname, 'board.js'), ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

assert.throws(() => run('add', 'no identity', '--project', 'p'), /no identity/);
run('add', 'write spec', '--project', 'p', '--by', 'pingu');
run('add', 'implement', '--project', 'p', '--dep', '1', '--by', 'pingu', '--when', 'now');
assert.match(run('list', '--all', '--when', 'now'), /#2 \[todo now\]/); assert.doesNotMatch(run('list', '--all', '--when', 'now'), /#1/);
assert.throws(() => run('edit', '2', '--when', 'someday', '--by', 'pingu'), /when must be/);
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
assert.throws(() => run('move', '2', 'review', '--by', 'claude'), /pr required for review/);
assert.throws(() => run('move', '2', 'review', '--pr', 'javascript:alert(1)', '--by', 'claude'), /pr must be a PR url/);
assert.match(run('move', '2', 'review', '--pr', 'https://github.com/o/r/pull/42', '--by', 'claude'), /pull\/42/);
run('move', '2', 'merge', '--by', 'claude'); // pr already on the card

// two sessions of the same agent get distinct owners and cannot claim each other's work.
const runIn = (sid, ...a) => execFileSync('node', [path.join(__dirname, 'board.js'), ...a],
  { env: { ...env, BOARD_SESSION: sid }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
runIn('aaaaaaaa11', 'add', 'session scoped', '--project', 'p', '--by', 'claude');
assert.strictEqual(JSON.parse(runIn('aaaaaaaa11', 'claim', '3', '--by', 'claude', '--json')).owner, 'claude:aaaaaaaa');
assert.throws(() => runIn('bbbbbbbb22', 'claim', '3', '--by', 'claude'), /owned by claude:aaaaaaaa/);
assert.strictEqual(JSON.parse(run('show', '3', '--json')).history.at(-1).by, 'claude:aaaaaaaa');

// index.html, static accessibility check: every control has a name, color tokens meet WCAG AA contrast.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), markup = html.split('<script>')[0];
for (const re of [/<html lang="en">/, /<meta name="viewport"/, /id="err"[^>]*role="alert"/, /id="derr"[^>]*role="alert"/,
  /<dialog[^>]*aria-label="/, /<select name="status"/, /<input name="pr"/, /<button class="title"/]) assert.match(html, re);
for (const [tag] of markup.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
  const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
  assert.ok(tag.includes('aria-label="') || markup.includes(`<label for="${id}">`) || markup.includes('<label>' + tag), 'no accessible name: ' + tag);
}
for (const [, id] of markup.matchAll(/<label for="([^"]+)"/g)) assert.ok(markup.includes(`id="${id}"`), 'label points nowhere: ' + id);
assert.doesNotMatch(markup, /<label>[^<]/); // a label that wraps no control
const lum = h => {
  if (h.length === 4) h = '#' + [...h.slice(1)].map(c => c + c).join('');
  const [r, g, b] = [1, 3, 5].map(i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const vars = css => Object.fromEntries([...css.matchAll(/--([\w-]+):(#[0-9a-f]+)/g)].map(m => [m[1], m[2]]));
const [lightCss, darkCss] = html.match(/:root \{[^}]*\}/g);
const themes = { light: vars(lightCss), dark: { ...vars(lightCss), ...vars(darkCss) } };
for (const [name, t] of Object.entries(themes)) {
  for (const fg of ['ink', 'mute', 'acc-text', 'err']) for (const bg of ['bg', 'card'])
    assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name} --${fg} on --${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
  assert.ok(ratio(t.border, t.card) >= 3, `${name} --border on --card: ${ratio(t.border, t.card).toFixed(2)}`);
  assert.ok(ratio('#fff', t.acc) >= 4.5, name + ' white on --acc');
}
const badges = [...html.matchAll(/\.when\.\w+ \{ background:(#[0-9a-f]+); color:#fff/g)];
assert.strictEqual(badges.length, 2);
for (const [, bg] of badges) assert.ok(ratio('#fff', bg) >= 4.5, 'white on badge ' + bg);

// index.html script on a stub DOM: the poll clears only its own message, never an action's error.
const vm = require('vm'), els = {}, el = s => els[s] ??= { value: '', textContent: '', innerHTML: '' };
let online = true, slow = null, isNew = false;
const posts = [];
const page = vm.createContext({ document: { querySelector: el, querySelectorAll: () => [], activeElement: null }, dlg: { open: false, showModal() {}, close() {}, classList: { add() { isNew = true; }, remove() { isNew = false; } } }, localStorage: {}, setInterval() {},
  fetch: async (url, o) => {
    if (!online) throw new Error('down');
    if (!o) return { ok: true, json: async () => ({ tasks: [{ id: 1, status: 'todo', title: 't', deps: [], history: [{ at: '2026-01-01T00:00:00', by: 'a', type: 'note', text: 'a note' }] },
      { id: 2, status: 'blocked', title: 'b', deps: [], history: [{ at: '2026-01-01T00:00:00', by: 'a', type: 'status', text: 'todo -> blocked: why' }, { at: '2026-01-01T00:00:00', by: 'a', type: 'note', text: 'later note' }] }] }) };
    const body = JSON.parse(o.body); posts.push([url, body]); await slow;
    if (url === '/api/add' && !body.title) return { ok: false, json: async () => ({ error: 'title required' }) };
    if (body.pr === 'bad') return { ok: false, json: async () => ({ error: 'pr must be a PR url' }) };
    return { ok: true, json: async () => ({ id: 7, status: 'todo' }) };
  } });
for (const k of ['title', 'project', 'status', 'when', 'owner', 'branch', 'pr', 'spec', 'deps']) el('#fields')[k] = { value: '' };
vm.runInContext(html.split('<script>')[1].split('</script>')[0], page);
const pageCheck = (async () => {
  const err = el('#err');
  err.textContent = 'pr required for review'; await page.refresh();
  assert.strictEqual(err.textContent, 'pr required for review');
  online = false; await page.refresh(); assert.strictEqual(err.textContent, 'server unreachable');
  online = true; await page.refresh(); assert.strictEqual(err.textContent, '');
  // each action clears the previous error itself
  err.textContent = 'old'; page.drag({ target: { closest: () => ({ dataset: { id: '1' } }) }, dataTransfer: {} });
  await page.drop({ preventDefault() {}, currentTarget: { classList: { remove() {} }, dataset: { status: 'todo' } }, target: { closest: () => null } });
  assert.strictEqual(err.textContent, '');
  err.textContent = 'old'; page.openTask(1); assert.strictEqual(err.textContent, '');
  // the card face shows no notes, only the block reason of a blocked card
  assert.doesNotMatch(el('#board').innerHTML, /a note|later note/);
  assert.match(el('#board').innerHTML, /blocked: why/);
  // the done column is hidden until "show done" is ticked
  assert.match(markup, /id="showDone"> show done</);
  assert.doesNotMatch(el('#board').innerHTML, /data-status="done"/);
  el('#showDone').checked = true; el('#showDone').onchange();
  assert.match(el('#board').innerHTML, /data-status="done"/);
  // + task opens the dialog and posts nothing; save creates the task, then edits it under the new id
  const f = el('#fields'), derr = el('#derr');
  el('#project').value = 'p'; f.title.value = 'stale'; err.textContent = 'old'; posts.length = 0; page.openAdd();
  assert.deepStrictEqual([err.textContent, posts.length, f.title.value, f.project.value, f.status.value, f.when.value], ['', 0, '', 'p', 'todo', 'later']);
  await page.saveEdit(); assert.strictEqual(derr.textContent, 'title required');
  f.title.value = 'new one'; f.owner.value = 'me'; f.status.value = 'doing'; posts.length = 0;
  let release; slow = new Promise(r => release = r);
  const first = page.saveEdit(), second = page.saveEdit(); release(); await first; await second; // double click: one task
  assert.deepStrictEqual(posts.map(p => p[0]), ['/api/add', '/api/edit', '/api/move']);
  assert.deepStrictEqual([posts[0][1].title, posts[0][1].project, posts[1][1].id, posts[1][1].owner, posts[2][1]], ['new one', 'p', 7, 'me', { id: 7, status: 'doing' }]);
  // a refused edit after the create: the dialog is a normal card on the new task, and a second save does not create it again
  el('#hist').innerHTML = 'old history'; page.openAdd(); assert.deepStrictEqual([isNew, el('#hist').innerHTML], [true, '']);
  f.title.value = 'two'; f.pr.value = 'bad'; posts.length = 0; await page.saveEdit();
  assert.deepStrictEqual([isNew, derr.textContent, el('#f_id').textContent], [false, 'pr must be a PR url', '#7']);
  f.pr.value = ''; await page.saveEdit();
  assert.deepStrictEqual([posts.map(p => p[0]), derr.textContent], [['/api/add', '/api/edit', '/api/edit'], '']);
  page.openAdd(); page.openTask(1); assert.strictEqual(isNew, false); // opening a card leaves the "new" state
})();

// 20 parallel adds must all land (lock + atomic write).
Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((res, rej) => {
  const p = spawn('node', [path.join(__dirname, 'board.js'), 'add', 'par ' + i, '--project', 'p', '--by', 'pingu'], { env });
  p.on('exit', c => c === 0 ? res() : rej(new Error('exit ' + c)));
}))).then(async () => {
  await pageCheck;
  const b = JSON.parse(fs.readFileSync(env.BOARD_FILE, 'utf8'));
  assert.strictEqual(b.tasks.length, 23);
  assert.strictEqual(new Set(b.tasks.map(t => t.id)).size, 23);
  assert.ok(!fs.existsSync(env.BOARD_FILE + '.lock'));
  fs.rmSync(dir, { recursive: true });
  console.log('ok');
});
