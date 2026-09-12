'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// git's well-known empty tree: lets us diff a repo that has no commits yet.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target']);
const MAX_COUNT_BYTES = 2 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function topLevel(cwd) {
  try { return fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim()); }
  catch { return null; }
}

function head(cwd) {
  try { return git(cwd, ['rev-parse', '--short', 'HEAD']).trim(); }
  catch { return null; }
}

function refExists(cwd, ref) {
  if (!ref) return false;
  try { git(cwd, ['cat-file', '-e', `${ref}^{commit}`]); return true; }
  catch { return false; }
}

function numstat(cwd, ref) {
  const out = git(cwd, ['diff', '--numstat', '--no-renames', ref, '--']);
  const result = {};
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [a, r, ...rest] = line.split('\t');
    result[rest.join('\t')] = [a === '-' ? 0 : Number(a), r === '-' ? 0 : Number(r)];
  }
  return result;
}

function countLines(file) {
  let st;
  try { st = fs.statSync(file); } catch { return 0; }
  if (!st.isFile() || st.size === 0 || st.size > MAX_COUNT_BYTES) return 0;
  const buf = fs.readFileSync(file);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf[buf.length - 1] !== 10) n++;
  return n;
}

function inSkippedDir(rel) {
  return rel.split('/').slice(0, -1).some((seg) => SKIP_DIRS.has(seg));
}

function untracked(cwd) {
  const out = git(cwd, ['ls-files', '--others', '--exclude-standard']);
  const result = {};
  for (const file of out.split('\n')) {
    if (!file || inSkippedDir(file)) continue;
    result[file] = [countLines(path.join(cwd, file)), 0];
  }
  return result;
}

function snapshot(cwd, headRef) {
  return { ...numstat(cwd, headRef || EMPTY_TREE), ...untracked(cwd) };
}

function delta(current, baseline) {
  const out = {};
  for (const [file, [a, r]] of Object.entries(current)) {
    const [ba, br] = baseline[file] || [0, 0];
    const da = Math.max(0, a - ba);
    const dr = Math.max(0, r - br);
    if (da + dr > 0) out[file] = [da, dr];
  }
  return out;
}

function groupName(file) {
  const parts = file.split('/');
  const dirs = parts.slice(0, -1);
  return dirs.length ? dirs.slice(0, 2).join('/') : parts[0];
}

function groupChanges(files) {
  const groups = new Map();
  for (const [file, [a, r]] of Object.entries(files)) {
    const name = groupName(file);
    const x = groups.get(name) || { name, files: 0, added: 0, removed: 0 };
    x.files += 1;
    x.added += a;
    x.removed += r;
    groups.set(name, x);
  }
  return [...groups.values()].sort(
    (p, q) => (q.added + q.removed) - (p.added + p.removed) || p.name.localeCompare(q.name),
  );
}

module.exports = {
  EMPTY_TREE, SKIP_DIRS,
  topLevel, head, refExists, numstat, untracked, snapshot, delta, groupName, groupChanges,
};
