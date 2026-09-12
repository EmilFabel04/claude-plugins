'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

// Real path matters: macOS puts tmp under /var which is a symlink to /private/var.
function tmpDir(prefix = 'sprint-recap-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A fresh, isolated SPRINT_RECAP_HOME.
function makeHome() {
  return tmpDir('sprint-recap-home-');
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// Temp git repo with one commit containing README.md.
function initRepo() {
  const dir = tmpDir('sprint-recap-repo-');
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, 'README.md', 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

// Run one of the plugin scripts as a child process.
function run(script, { input = '', cwd = process.cwd(), env = {}, args = [] } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    input,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

module.exports = { SCRIPTS, tmpDir, makeHome, git, write, initRepo, run };
