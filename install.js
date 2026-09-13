#!/usr/bin/env node
// Installs agent-board into a project or globally: links the `board` CLI,
// drops the rules block (CLAUDE.md/AGENTS.md), and wires the stop hook /
// session plugin for whichever agents are selected.
//
// Usage:
//   node install.js --local [dir] [--agents claude,codex,opencode]
//   node install.js --global      [--agents claude,codex,opencode]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = __dirname; // this agent-board checkout
const RULES_MARKER = 'All work is tracked with the `board` CLI';
const START = '<!-- agent-board rules start -->', END = '<!-- agent-board rules end -->';

function parseArgs(argv) {
  const opts = { scope: null, dir: process.cwd(), agents: ['claude', 'codex', 'opencode'] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') { opts.scope = 'local'; if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.dir = path.resolve(argv[++i]); }
    else if (a === '--global') opts.scope = 'global';
    else if (a === '--agents') opts.agents = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else { console.error('unknown argument: ' + a); process.exit(1); }
  }
  if (!opts.scope) { usage(); process.exit(1); }
  for (const a of opts.agents) {
    if (!['claude', 'codex', 'opencode'].includes(a)) { console.error('unknown agent: ' + a); process.exit(1); }
  }
  return opts;
}

function usage() {
  console.error(`usage:
  node install.js --local [dir] [--agents claude,codex,opencode]
  node install.js --global      [--agents claude,codex,opencode]

--local installs into a project (default: current directory).
--global installs into your home config, covering every project.
--agents defaults to all three: claude,codex,opencode.`);
}

function ensureBoardCli() {
  try {
    execSync('npm link', { cwd: ROOT, stdio: 'ignore' });
    console.log('board CLI linked (npm link)');
  } catch (e) {
    console.warn('warn: npm link failed, `board` command may not be on your PATH:', e.message);
  }
}

// ---- rules block (CLAUDE.md / AGENTS.md) ----
// The block is written between START and END, so any later version can find
// and replace or remove it exactly. Installs from before the markers hold the
// exact v0.1.0 text, kept in hooks/rules-v0.1.0.md so they are found too.
function findRules(text) {
  const s = text.indexOf(START), e = text.indexOf(END, s);
  if (s >= 0 && e >= 0) return [s, e + END.length + (text[e + END.length] === '\n' ? 1 : 0)];
  const old = fs.readFileSync(path.join(ROOT, 'hooks', 'rules-v0.1.0.md'), 'utf8'), i = text.indexOf(old);
  return i >= 0 ? [i, i + old.length] : null;
}

// Writes the file if missing, replaces our block if it's there, otherwise
// appends it. Content outside the block is untouched.
function installRules(file, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const block = START + '\n' + fs.readFileSync(path.join(ROOT, file), 'utf8') + END + '\n';
  let existing = '';
  try { existing = fs.readFileSync(dest, 'utf8'); } catch {}
  const range = findRules(existing);
  if (range) {
    const next = existing.slice(0, range[0]) + block + existing.slice(range[1]);
    if (next === existing) { console.log(`skip ${dest} (board rules up to date)`); return; }
    fs.writeFileSync(dest, next);
    console.log(`updated board rules in ${dest}`); return;
  }
  if (existing.includes(RULES_MARKER)) { console.log(`skip ${dest} (has board rules install.js did not write, update by hand)`); return; }
  const sep = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
  fs.writeFileSync(dest, existing + sep + block);
  console.log(existing ? `appended board rules to ${dest}` : `wrote ${dest}`);
}

// ---- JSON hook files (Claude settings.json / Codex hooks.json) ----
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
function stopHookEntry(agent) {
  const stopJs = path.join(ROOT, 'hooks', 'stop.js');
  return { hooks: [{ type: 'command', timeout: 10, command: `BOARD_AGENT=${agent} node "${stopJs}"` }] };
}
function hasStopHook(list) {
  const stopJs = path.join(ROOT, 'hooks', 'stop.js');
  return (list || []).some(g => (g.hooks || []).some(h => h.command && h.command.includes(stopJs)));
}

function installClaudeSettings(file) {
  const settings = readJson(file);
  settings.env = settings.env || {};
  if (!settings.env.BOARD_AGENT) settings.env.BOARD_AGENT = 'claude';
  settings.hooks = settings.hooks || {};
  settings.hooks.Stop = settings.hooks.Stop || [];
  if (hasStopHook(settings.hooks.Stop)) { console.log(`skip ${file} (stop hook already present)`); }
  else { settings.hooks.Stop.push(stopHookEntry('claude')); console.log(`wired stop hook into ${file}`); }
  writeJson(file, settings);
}

function installCodexHooks(file) {
  const hooks = readJson(file);
  hooks.hooks = hooks.hooks || {};
  hooks.hooks.Stop = hooks.hooks.Stop || [];
  if (hasStopHook(hooks.hooks.Stop)) { console.log(`skip ${file} (stop hook already present)`); }
  else { hooks.hooks.Stop.push(stopHookEntry('codex')); console.log(`wired stop hook into ${file}`); }
  writeJson(file, hooks);
}

// ---- OpenCode plugin ----
function installOpencodePlugin(pluginsDir) {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const dest = path.join(pluginsDir, 'board-session.js');
  const src = path.join(ROOT, 'hooks', 'opencode-board-session.js');
  if (fs.existsSync(dest)) { console.log(`skip ${dest} (already installed)`); return; }
  fs.symlinkSync(src, dest);
  console.log(`symlinked ${dest} -> ${src}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureBoardCli();

  const rulesFileFor = { claude: 'CLAUDE.md', codex: 'AGENTS.md', opencode: 'AGENTS.md' };
  const doneRulesFiles = new Set();

  for (const agent of opts.agents) {
    const rulesFile = rulesFileFor[agent];
    const dest = opts.scope === 'local'
      ? path.join(opts.dir, rulesFile)
      : agent === 'claude' ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
      : agent === 'codex' ? path.join(os.homedir(), '.codex', 'AGENTS.md')
      : path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
    if (!doneRulesFiles.has(dest)) { installRules(rulesFile, dest); doneRulesFiles.add(dest); }

    if (agent === 'claude') {
      const settingsFile = opts.scope === 'local'
        ? path.join(opts.dir, '.claude', 'settings.json')
        : path.join(os.homedir(), '.claude', 'settings.json');
      installClaudeSettings(settingsFile);
    } else if (agent === 'codex') {
      const hooksFile = opts.scope === 'local'
        ? path.join(opts.dir, '.codex', 'hooks.json')
        : path.join(os.homedir(), '.codex', 'hooks.json');
      installCodexHooks(hooksFile);
    } else if (agent === 'opencode') {
      const pluginsDir = opts.scope === 'local'
        ? path.join(opts.dir, '.opencode', 'plugins')
        : path.join(os.homedir(), '.config', 'opencode', 'plugins');
      installOpencodePlugin(pluginsDir);
    }
  }

  console.log(`\ndone (${opts.scope}${opts.scope === 'local' ? ': ' + opts.dir : ''}, agents: ${opts.agents.join(', ')})`);
}

if (require.main === module) main();
module.exports = { findRules };
