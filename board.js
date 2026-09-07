#!/usr/bin/env node
// agent-board: one JSON file, one CLI, one page. No dependencies.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');

const FILE = process.env.BOARD_FILE || path.join(os.homedir(), '.agent-board', 'board.json');
const LOCK = FILE + '.lock';
const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];

// ---------- storage ----------
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { next_id: 1, tasks: [] }; throw e; }
}
function save(board) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n');
  fs.renameSync(tmp, FILE); // atomic on the same filesystem
}
function lock() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const deadline = Date.now() + 3000;
  for (;;) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.unlinkSync(LOCK); } catch {} // stale
      if (Date.now() > deadline) throw new Error('board is locked by another process (' + LOCK + ')');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function unlock() { try { fs.unlinkSync(LOCK); } catch {} }
// Run fn(board) under the lock and persist the result.
function mutate(fn) {
  lock();
  try { const b = load(); const r = fn(b); save(b); return r; }
  finally { unlock(); }
}

// ---------- domain ----------
function now() { return new Date().toISOString(); }
function find(board, id) {
  const t = board.tasks.find(t => t.id === Number(id));
  if (!t) throw new Error('no task #' + id);
  return t;
}
function record(t, by, type, text) {
  t.history.push({ at: now(), by, type, text });
  t.updated_at = t.history[t.history.length - 1].at;
}
function isReady(board, t) {
  return (t.status === 'todo') &&
    t.deps.every(d => { const x = board.tasks.find(y => y.id === d); return x && x.status === 'done'; });
}

const ops = {
  add(board, by, { title, project, spec = '', deps = [], branch = '' }) {
    if (!title) throw new Error('title required');
    const t = { id: board.next_id++, title, project, status: 'todo', owner: '', branch, spec,
      deps: deps.map(Number), created_at: now(), updated_at: '', history: [] };
    record(t, by, 'create', title);
    board.tasks.push(t);
    return t;
  },
  move(board, by, { id, status, text = '' }) {
    if (!STATUSES.includes(status)) throw new Error('status must be one of ' + STATUSES.join('|'));
    const t = find(board, id);
    record(t, by, 'status', t.status + ' -> ' + status + (text ? ': ' + text : ''));
    t.status = status;
    return t;
  },
  claim(board, by, { id, branch }) {
    const t = find(board, id);
    if (t.owner && t.owner !== by && t.status === 'doing') throw new Error('#' + id + ' is owned by ' + t.owner);
    t.owner = by;
    if (branch) t.branch = branch;
    record(t, by, 'status', t.status + ' -> doing');
    t.status = 'doing';
    return t;
  },
  note(board, by, { id, text }) {
    if (!text) throw new Error('note text required');
    const t = find(board, id);
    record(t, by, 'note', text);
    return t;
  },
  edit(board, by, { id, ...fields }) {
    const t = find(board, id);
    const allowed = ['title', 'project', 'owner', 'branch', 'spec', 'deps'];
    const changed = [];
    for (const k of allowed) if (fields[k] !== undefined) {
      const v = k === 'deps' ? [].concat(fields[k]).map(Number) : fields[k];
      if (JSON.stringify(v) !== JSON.stringify(t[k])) { changed.push(k + '=' + JSON.stringify(v)); t[k] = v; }
    }
    if (changed.length) record(t, by, 'edit', changed.join(' '));
    return t;
  },
  del(board, by, { id }) {
    const i = board.tasks.findIndex(t => t.id === Number(id));
    if (i < 0) throw new Error('no task #' + id);
    return board.tasks.splice(i, 1)[0];
  },
  reorder(board, by, { id, before }) { // move task `id` in front of task `before` (or to end)
    const t = ops.del(board, by, { id });
    const i = before ? board.tasks.findIndex(x => x.id === Number(before)) : -1;
    if (i < 0) board.tasks.push(t); else board.tasks.splice(i, 0, t);
    return t;
  },
};

// ---------- CLI ----------
function who() { return process.env.BOARD_AGENT || os.userInfo().username; }
function projectHere() {
  try { return path.basename(execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); }
  catch { return path.basename(process.cwd()); }
}
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (k === 'dep') (opt.deps = opt.deps || []).push(v); else opt[k] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}
function fmt(t) {
  const last = t.history.filter(h => h.type === 'note').pop();
  return `#${t.id} [${t.status}] ${t.title}` +
    (t.project ? `  (${t.project})` : '') + (t.owner ? `  @${t.owner}` : '') + (t.branch ? `  ${t.branch}` : '') +
    (t.deps.length ? `  deps:${t.deps.join(',')}` : '') + (last ? `\n    ${last.by}: ${last.text}` : '');
}
const HELP = `usage: board <cmd> [args] [--by agent] [--project name] [--all] [--json]
  add "title" [--spec path] [--dep id]... [--branch b]
  list [--status s] [--all]     ready [--all]      show <id>
  claim <id> [--branch b]       move <id> <status>  (${STATUSES.join('|')})
  done <id>  block <id> "why"   note <id> "text"
  edit <id> [--title t] [--owner o] [--branch b] [--spec p] [--project p] [--dep id]...
  rm <id>    serve [port]       file
identity: --by <name> or BOARD_AGENT env (default: $USER). project: --project or git root name.`;

function cli(argv) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, a, b] = pos;
  const by = opt.by || who();
  const project = opt.project || projectHere();
  const out = t => console.log(opt.json ? JSON.stringify(t, null, 2) : fmt(t));
  const list = (pred) => {
    const ts = load().tasks.filter(t => (opt.all || t.project === project) && pred(t));
    if (opt.json) return console.log(JSON.stringify(ts, null, 2));
    if (!ts.length) return console.log('(none)');
    ts.forEach(t => console.log(fmt(t)));
  };
  switch (cmd) {
    case 'add': return out(mutate(bd => ops.add(bd, by, { title: a, project, spec: opt.spec, deps: opt.deps, branch: opt.branch })));
    case 'list': return list(t => !opt.status || t.status === opt.status);
    case 'ready': { const bd = load(); return list(t => isReady(bd, t)); }
    case 'show': { const t = find(load(), a); if (opt.json) return out(t); console.log(fmt(t));
      if (t.spec) console.log('    spec: ' + t.spec);
      t.history.forEach(h => console.log(`    ${h.at.slice(0, 16)} ${h.by} ${h.type}: ${h.text}`)); return; }
    case 'claim': return out(mutate(bd => ops.claim(bd, by, { id: a, branch: opt.branch })));
    case 'move': return out(mutate(bd => ops.move(bd, by, { id: a, status: b })));
    case 'done': return out(mutate(bd => ops.move(bd, by, { id: a, status: 'done' })));
    case 'block': return out(mutate(bd => ops.move(bd, by, { id: a, status: 'blocked', text: b })));
    case 'note': return out(mutate(bd => ops.note(bd, by, { id: a, text: b })));
    case 'edit': return out(mutate(bd => ops.edit(bd, by, { id: a, ...opt })));
    case 'rm': return out(mutate(bd => ops.del(bd, by, { id: a })));
    case 'serve': return serve(Number(a) || 4444);
    case 'file': return console.log(FILE);
    default: console.log(HELP); process.exitCode = cmd ? 1 : 0;
  }
}

// ---------- web ----------
function serve(port) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'));
  http.createServer((req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.method === 'GET' && req.url === '/') return send(200, html, 'text/html');
    if (req.method === 'GET' && req.url === '/api/board') return send(200, JSON.stringify(load()));
    if (req.method === 'POST' && req.url.startsWith('/api/')) {
      const op = ops[req.url.slice(5)];
      if (!op) return send(404, '{"error":"unknown op"}');
      let body = '';
      req.on('data', c => body += c).on('end', () => {
        try { send(200, JSON.stringify(mutate(bd => op(bd, who(), JSON.parse(body || '{}'))))); }
        catch (e) { send(400, JSON.stringify({ error: e.message })); }
      });
      return;
    }
    send(404, '{"error":"not found"}');
  }).listen(port, '127.0.0.1', () => console.log(`board: http://localhost:${port}  file: ${FILE}`));
}

module.exports = { ops, load, mutate, isReady, STATUSES };
if (require.main === module) {
  try { cli(process.argv.slice(2)); }
  catch (e) { console.error('error: ' + e.message); process.exitCode = 1; }
}
