'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baseDir } = require('./config');
const gitlib = require('./git');

// One state file per working directory, keyed by the git top level when there is one.
function resolveCwd(cwd) {
  const top = gitlib.topLevel(cwd);
  const root = top || fs.realpathSync(cwd);
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  return { key, root, git: Boolean(top) };
}

function statePath(key) {
  return path.join(baseDir(), 'sessions', `${key}.json`);
}

function readState(key) {
  const p = statePath(key);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeState(key, state) {
  const p = statePath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

function newSprint({ head, baseline, now }) {
  return { started_at: now.toISOString(), head, baseline };
}

function freshState({ root, git, head, baseline, now }) {
  return { cwd: root, git, sprint: newSprint({ head, baseline, now }), turn: null };
}

function realOrSame(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isHomeOrRoot(dir) {
  const r = realOrSame(dir);
  return r === path.parse(r).root || r === realOrSame(os.homedir());
}

const two = (n) => String(n).padStart(2, '0');

function historyName(now, basename) {
  const d = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const t = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${d}-${t}-${basename}.json`;
}

function writeHistory(entry, root, now) {
  const dir = path.join(baseDir(), 'history');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, historyName(now, path.basename(root) || 'root'));
  fs.writeFileSync(p, JSON.stringify(entry, null, 2));
  return p;
}

// Fail-open support: record the error and let the caller exit 0.
function logHookError(hook, err) {
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
    const text = err && err.stack ? err.stack : String(err);
    fs.appendFileSync(path.join(baseDir(), 'hook-errors.log'), `${new Date().toISOString()} ${hook}: ${text}\n`);
  } catch {
    // Nothing else we can do without risking the user's session.
  }
}

module.exports = {
  resolveCwd, statePath, readState, writeState, newSprint, freshState,
  isHomeOrRoot, historyName, writeHistory, logHookError,
};
