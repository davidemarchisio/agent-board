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

function parseArgs(argv) {
  const opts = { scope: null, dir: process.cwd(), agents: ['claude'] };
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
--agents defaults to "claude".`);
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
// Never overwrites: writes the file if missing, otherwise appends the block
// (unless it's already there). Existing content in the file is untouched.
function installRules(file, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const block = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let existing = '';
  try { existing = fs.readFileSync(dest, 'utf8'); } catch {}
  if (existing.includes(RULES_MARKER)) { console.log(`skip ${dest} (already has the board rules)`); return; }
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

main();
