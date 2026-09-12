'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRepo, tmpDir, makeHome, write } = require('./helpers');
const state = require('../scripts/lib/state');

test('resolveCwd keys by git top level, or by the directory itself outside git', () => {
  const repo = initRepo();
  fs.mkdirSync(path.join(repo, 'sub'));
  const a = state.resolveCwd(repo);
  const b = state.resolveCwd(path.join(repo, 'sub'));
  assert.equal(a.key, b.key);
  assert.match(a.key, /^[0-9a-f]{12}$/);
  assert.equal(a.root, repo);
  assert.equal(a.git, true);
  const plain = tmpDir();
  const c = state.resolveCwd(plain);
  assert.equal(c.git, false);
  assert.equal(c.root, plain);
  assert.notEqual(c.key, a.key);
});

test('readState returns null when missing, round-trips writes, throws on corrupt JSON', () => {
  process.env.SPRINT_RECAP_HOME = makeHome();
  assert.equal(state.readState('abc'), null);
  const s = state.freshState({ root: '/x', git: false, head: null, baseline: {}, now: new Date('2026-09-12T08:00:00Z') });
  state.writeState('abc', s);
  assert.deepEqual(state.readState('abc'), { cwd: '/x', git: false, sprint: { started_at: '2026-09-12T08:00:00.000Z', head: null, baseline: {} }, turn: null });
  fs.writeFileSync(state.statePath('abc'), '{ nope');
  assert.throws(() => state.readState('abc'), SyntaxError);
});

test('isHomeOrRoot', () => {
  assert.equal(state.isHomeOrRoot(os.homedir()), true);
  assert.equal(state.isHomeOrRoot(path.parse(process.cwd()).root), true);
  assert.equal(state.isHomeOrRoot(tmpDir()), false);
});

test('historyName formats local time and basename', () => {
  const now = new Date(2026, 8, 12, 9, 5, 7);
  assert.equal(state.historyName(now, 'pallisade'), '2026-09-12-090507-pallisade.json');
});

test('writeHistory writes under history/ and returns the path', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  const p = state.writeHistory({ recap: { title: 't' }, card: 'x' }, '/Users/me/proj', new Date(2026, 8, 12, 9, 5, 7));
  assert.equal(p, path.join(home, 'history', '2026-09-12-090507-proj.json'));
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).card, 'x');
});

test('logHookError appends a timestamped line and never throws', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  state.logHookError('check-recap', new Error('boom'));
  const log = fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8');
  assert.match(log, /^\d{4}-\d{2}-\d{2}T.* check-recap: Error: boom/);
  process.env.SPRINT_RECAP_HOME = path.join(write(home, 'file', 'x'), 'not-a-dir');
  assert.doesNotThrow(() => state.logHookError('x', new Error('y')));
});
