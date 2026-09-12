'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, tmpDir, git, write } = require('./helpers');
const g = require('../scripts/lib/git');
const { scanMtime, measure } = require('../scripts/lib/measure');

function touchOld(file) {
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(file, old, old);
}

test('scanMtime lists files newer than since, skipping hidden and excluded dirs and deep paths', () => {
  const dir = tmpDir();
  const since = Date.now() - 60_000;
  write(dir, 'notes/a.md', 'x');
  write(dir, 'node_modules/p/i.js', 'x');
  write(dir, '.hidden/h.txt', 'x');
  write(dir, 'a/b/c/d/e.txt', 'x');          // depth 5, excluded
  write(dir, 'a/b/c/d.txt', 'x');            // depth 4, included
  touchOld(write(dir, 'old.txt', 'x'));
  const { files, capped } = scanMtime(dir, since);
  assert.deepEqual(Object.keys(files).sort(), ['a/b/c/d.txt', 'notes/a.md']);
  assert.equal(capped, false);
});

test('scanMtime reports capped past maxEntries', () => {
  const dir = tmpDir();
  for (let i = 0; i < 20; i++) write(dir, `f${i}.txt`, 'x');
  const { capped } = scanMtime(dir, 0, { maxEntries: 5 });
  assert.equal(capped, true);
});

test('measure in git returns grouped delta since the baseline', () => {
  const repo = initRepo();
  const head = g.head(repo);
  write(repo, 'src/a.ts', 'one\n');
  const baseline = g.snapshot(repo, head);
  write(repo, 'src/a.ts', 'one\ntwo\nthree\n');
  write(repo, 'prisma/schema.prisma', 'model X {}\n');
  const m = measure(repo, { git: true, head, baseline, started_at: new Date().toISOString() });
  assert.equal(m.git, true);
  assert.equal(m.files, 2);
  assert.equal(m.added, 3);
  assert.equal(m.removed, 0);
  assert.deepEqual(m.groups.map((x) => x.name), ['src', 'prisma']);
  assert.equal(m.baselineLost, false);
});

test('measure marks baselineLost when the recorded head vanished and diffs against HEAD', () => {
  const repo = initRepo();
  write(repo, 'README.md', 'hello\nmore\n');
  const m = measure(repo, { git: true, head: 'deadbeef', baseline: { 'README.md': [99, 99] }, started_at: new Date().toISOString() });
  assert.equal(m.baselineLost, true);
  assert.equal(m.files, 1);
  assert.equal(m.added, 1);
});

test('measure in a repo with no commits counts staged and untracked files', () => {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  write(dir, 'a.txt', 'one\ntwo\n');
  write(dir, 'b.txt', 'x\n');
  git(dir, ['add', 'a.txt']);
  const m = measure(dir, { git: true, head: null, baseline: {}, started_at: new Date().toISOString() });
  assert.equal(m.baselineLost, false);
  assert.equal(m.files, 2);
  assert.equal(m.added, 3);
});

test('measure outside git counts files by mtime with no line numbers', () => {
  const dir = tmpDir();
  const started = new Date(Date.now() - 60_000).toISOString();
  write(dir, 'docs/a.md', 'x');
  write(dir, 'docs/b.md', 'x');
  write(dir, 'todo.md', 'x');
  const m = measure(dir, { git: false, head: null, baseline: {}, started_at: started });
  assert.equal(m.git, false);
  assert.equal(m.files, 3);
  assert.equal(m.added, 0);
  assert.deepEqual(m.groups.map((x) => [x.name, x.files]), [['docs', 2], ['todo.md', 1]]);
});
