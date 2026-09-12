'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { initRepo, tmpDir, git, write } = require('./helpers');
const g = require('../scripts/lib/git');

test('topLevel and head in and outside a repo', () => {
  const repo = initRepo();
  assert.equal(g.topLevel(path.join(repo)), repo);
  assert.match(g.head(repo), /^[0-9a-f]{7,}$/);
  const plain = tmpDir();
  assert.equal(g.topLevel(plain), null);
  assert.equal(g.head(plain), null);
});

test('head is null in a repo with no commits and snapshot still counts staged files', () => {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  assert.equal(g.head(dir), null);
  write(dir, 'a.txt', 'one\ntwo\n');
  git(dir, ['add', 'a.txt']);
  assert.deepEqual(g.snapshot(dir, null), { 'a.txt': [2, 0] });
});

test('refExists', () => {
  const repo = initRepo();
  assert.equal(g.refExists(repo, g.head(repo)), true);
  assert.equal(g.refExists(repo, 'deadbeef'), false);
  assert.equal(g.refExists(repo, null), false);
});

test('numstat reports working tree versus ref, binary as zeros', () => {
  const repo = initRepo();
  write(repo, 'README.md', 'hello\nworld\n');
  write(repo, 'bin.dat', Buffer.from([0, 1, 2]));
  git(repo, ['add', 'bin.dat']);
  const n = g.numstat(repo, g.head(repo));
  assert.deepEqual(n['README.md'], [1, 0]);
  assert.deepEqual(n['bin.dat'], [0, 0]);
});

test('numstat delta against a baseline survives a commit in between', () => {
  const repo = initRepo();
  const start = g.head(repo);
  write(repo, 'src/x.ts', 'a\nb\nc\n');
  const baseline = g.snapshot(repo, start);
  assert.deepEqual(baseline['src/x.ts'], [3, 0]);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'mid']);
  write(repo, 'src/x.ts', 'a\nb\nc\nd\ne\n');
  write(repo, 'README.md', 'changed\n');
  const current = g.snapshot(repo, start);
  const d = g.delta(current, baseline);
  assert.deepEqual(d['src/x.ts'], [2, 0]);
  assert.deepEqual(d['README.md'], [1, 1]);
});

test('untracked counts lines, including a final line without newline, and skips node_modules', () => {
  const repo = initRepo();
  write(repo, 'notes.txt', 'a\nb\nc');
  write(repo, 'empty.txt', '');
  write(repo, 'node_modules/pkg/index.js', 'x\n');
  const u = g.untracked(repo);
  assert.deepEqual(u['notes.txt'], [3, 0]);
  assert.deepEqual(u['empty.txt'], [0, 0]);
  assert.equal(u['node_modules/pkg/index.js'], undefined);
});

test('delta clamps at zero and drops unchanged files', () => {
  const d = g.delta({ a: [5, 2], b: [1, 1], c: [0, 3] }, { a: [5, 2], b: [4, 4] });
  assert.deepEqual(d, { c: [0, 3] });
});

test('groupName uses the first two directory segments or the root file name', () => {
  assert.equal(g.groupName('src/app/page.tsx'), 'src/app');
  assert.equal(g.groupName('src/app/deep/er/file.ts'), 'src/app');
  assert.equal(g.groupName('prisma/schema.prisma'), 'prisma');
  assert.equal(g.groupName('tests/a.test.js'), 'tests');
  assert.equal(g.groupName('package.json'), 'package.json');
});

test('groupChanges sums per group and sorts by total lines descending', () => {
  const groups = g.groupChanges({
    'src/app/a.ts': [10, 0],
    'src/app/b.ts': [5, 5],
    'prisma/schema.prisma': [30, 1],
    'README.md': [1, 0],
  });
  assert.deepEqual(groups.map((x) => x.name), ['prisma', 'src/app', 'README.md']);
  assert.deepEqual(groups[1], { name: 'src/app', files: 2, added: 15, removed: 5 });
});
