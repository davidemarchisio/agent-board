#!/usr/bin/env node
// Reverses install.js: removes the board rules block, the stop hook entry,
// and the OpenCode plugin symlink for whichever agents are selected. Leaves
// everything else in the target files untouched — unrelated hooks, env
// vars, and any content a rules file had before install.js touched it.
//
// Usage:
//   node uninstall.js --local [dir] [--agents claude,codex,opencode] [--unlink-cli]
//   node uninstall.js --global      [--agents claude,codex,opencode] [--unlink-cli]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = __dirname;

function parseArgs(argv) {
  const opts = { scope: null, dir: process.cwd(), agents: ['claude', 'codex', 'opencode'], unlinkCli: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') { opts.scope = 'local'; if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.dir = path.resolve(argv[++i]); }
    else if (a === '--global') opts.scope = 'global';
    else if (a === '--agents') opts.agents = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--unlink-cli') opts.unlinkCli = true;
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
  node uninstall.js --local [dir] [--agents claude,codex,opencode] [--unlink-cli]
  node uninstall.js --global      [--agents claude,codex,opencode] [--unlink-cli]

--local removes from a project (default: current directory).
--global removes from your home config.
--agents defaults to all three: claude,codex,opencode.
--unlink-cli also runs npm unlink for the board command (off by default,
  since other projects may still be using it).`);
}

// ---- rules block (CLAUDE.md / AGENTS.md) ----
// Removes exactly the block install.js appended. If that leaves nothing,
// deletes the file (it existed only because install.js created it).
// If the block isn't found, leaves the file alone.
function uninstallRules(file, dest) {
  if (!fs.existsSync(dest)) { console.log(`skip ${dest} (not present)`); return; }
  const block = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const existing = fs.readFileSync(dest, 'utf8');
  const idx = existing.indexOf(block);
  if (idx === -1) { console.log(`skip ${dest} (board rules not found, left alone)`); return; }
  const before = existing.slice(0, idx).replace(/\n+$/, '');
  const after = existing.slice(idx + block.length).replace(/^\n+/, '');
  if (!before && !after) { fs.unlinkSync(dest); console.log(`removed ${dest} (it only had the board rules)`); return; }
  fs.writeFileSync(dest, before + (before && after ? '\n\n' : '') + after + '\n');
  console.log(`removed board rules from ${dest}`);
}

// ---- JSON hook files (Claude settings.json / Codex hooks.json) ----
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
// Drops our command from each hook group, dropping the whole group if that
// empties it. A group holding other hooks alongside ours keeps the rest.
function stripStopHook(list) {
  const stopJs = path.join(ROOT, 'hooks', 'stop.js');
  return (list || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !(h.command && h.command.includes(stopJs))) }))
    .filter(g => g.hooks.length > 0);
}

function uninstallClaudeSettings(file) {
  if (!fs.existsSync(file)) { console.log(`skip ${file} (not present)`); return; }
  const settings = readJson(file);
  let changed = false;

  if (settings.hooks && settings.hooks.Stop) {
    const before = JSON.stringify(settings.hooks.Stop);
    settings.hooks.Stop = stripStopHook(settings.hooks.Stop);
    if (JSON.stringify(settings.hooks.Stop) !== before) changed = true;
    if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  if (settings.env && settings.env.BOARD_AGENT === 'claude') {
    delete settings.env.BOARD_AGENT;
    changed = true;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }

  if (!changed) { console.log(`skip ${file} (nothing of ours found)`); return; }
  if (Object.keys(settings).length === 0) { fs.unlinkSync(file); console.log(`removed ${file} (it only had board settings)`); }
  else { writeJson(file, settings); console.log(`removed board wiring from ${file}`); }
}

function uninstallCodexHooks(file) {
  if (!fs.existsSync(file)) { console.log(`skip ${file} (not present)`); return; }
  const hooks = readJson(file);
  if (!hooks.hooks || !hooks.hooks.Stop) { console.log(`skip ${file} (nothing of ours found)`); return; }
  const before = JSON.stringify(hooks.hooks.Stop);
  hooks.hooks.Stop = stripStopHook(hooks.hooks.Stop);
  if (JSON.stringify(hooks.hooks.Stop) === before) { console.log(`skip ${file} (nothing of ours found)`); return; }
  if (hooks.hooks.Stop.length === 0) delete hooks.hooks.Stop;
  if (Object.keys(hooks.hooks).length === 0) delete hooks.hooks;
  if (Object.keys(hooks).length === 0) { fs.unlinkSync(file); console.log(`removed ${file} (it only had board hooks)`); }
  else { writeJson(file, hooks); console.log(`removed board wiring from ${file}`); }
}

// ---- OpenCode plugin ----
function uninstallOpencodePlugin(pluginsDir) {
  const dest = path.join(pluginsDir, 'board-session.js');
  const src = path.join(ROOT, 'hooks', 'opencode-board-session.js');
  let stat;
  try { stat = fs.lstatSync(dest); } catch { console.log(`skip ${dest} (not present)`); return; }
  if (stat.isSymbolicLink() && fs.readlinkSync(dest) === src) { fs.unlinkSync(dest); console.log(`removed ${dest}`); }
  else console.warn(`warn: ${dest} isn't the symlink install.js created, leaving it alone`);
}

// Removes dir and its now-empty ancestors, stopping at (and never touching) stopAt.
function rmEmptyDirs(dir, stopAt) {
  while (dir !== stopAt && dir !== path.dirname(dir)) {
    try {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
    } catch { break; }
    dir = path.dirname(dir);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const rulesFileFor = { claude: 'CLAUDE.md', codex: 'AGENTS.md', opencode: 'AGENTS.md' };
  const doneRulesFiles = new Set();

  for (const agent of opts.agents) {
    const rulesFile = rulesFileFor[agent];
    const dest = opts.scope === 'local'
      ? path.join(opts.dir, rulesFile)
      : agent === 'claude' ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
      : agent === 'codex' ? path.join(os.homedir(), '.codex', 'AGENTS.md')
      : path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
    if (!doneRulesFiles.has(dest)) { uninstallRules(rulesFile, dest); doneRulesFiles.add(dest); }

    const stopAt = opts.scope === 'local' ? opts.dir
      : agent === 'opencode' ? path.join(os.homedir(), '.config')
      : os.homedir();

    if (agent === 'claude') {
      const settingsFile = opts.scope === 'local'
        ? path.join(opts.dir, '.claude', 'settings.json')
        : path.join(os.homedir(), '.claude', 'settings.json');
      uninstallClaudeSettings(settingsFile);
      rmEmptyDirs(path.dirname(settingsFile), stopAt);
    } else if (agent === 'codex') {
      const hooksFile = opts.scope === 'local'
        ? path.join(opts.dir, '.codex', 'hooks.json')
        : path.join(os.homedir(), '.codex', 'hooks.json');
      uninstallCodexHooks(hooksFile);
      rmEmptyDirs(path.dirname(hooksFile), stopAt);
    } else if (agent === 'opencode') {
      const pluginsDir = opts.scope === 'local'
        ? path.join(opts.dir, '.opencode', 'plugins')
        : path.join(os.homedir(), '.config', 'opencode', 'plugins');
      uninstallOpencodePlugin(pluginsDir);
      rmEmptyDirs(pluginsDir, stopAt);
    }
  }

  if (opts.unlinkCli) {
    try { execSync('npm rm --global agent-board', { cwd: ROOT, stdio: 'ignore' }); console.log('board CLI unlinked (npm rm --global agent-board)'); }
    catch (e) { console.warn('warn: npm unlink failed:', e.message); }
  } else {
    console.log('\nboard CLI is still linked globally. Remove it too with: npm rm --global agent-board (or re-run with --unlink-cli)');
  }

  console.log(`\ndone (${opts.scope}${opts.scope === 'local' ? ': ' + opts.dir : ''}, agents: ${opts.agents.join(', ')})`);
}

main();
