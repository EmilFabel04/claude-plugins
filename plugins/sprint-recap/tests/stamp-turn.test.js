'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initRepo, tmpDir, makeHome, write, run } = require('./helpers');
const state = require('../scripts/lib/state');
const g = require('../scripts/lib/git');

function stamp(cwd, home, extraEnv = {}) {
  return run('stamp-turn.js', { input: JSON.stringify({ cwd, hook_event_name: 'UserPromptSubmit' }), env: { SPRINT_RECAP_HOME: home, ...extraEnv } });
}

test('git repo: creates state with sprint and turn baselines', () => {
  const home = makeHome();
  const repo = initRepo();
  write(repo, 'new.txt', 'a\nb\n');
  const r = stamp(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(repo).key);
  assert.equal(st.cwd, repo);
  assert.equal(st.git, true);
  assert.equal(st.sprint.head, g.head(repo));
  assert.deepEqual(st.sprint.baseline['new.txt'], [2, 0]);
  assert.deepEqual(st.turn.baseline['new.txt'], [2, 0]);
  assert.equal(st.turn.head, g.head(repo));
  assert.equal(st.turn.recap_rendered_at, null);
  assert.equal(st.turn.skip, undefined);
  assert.ok(Date.parse(st.turn.started_at) > Date.now() - 10_000);
});

test('plain directory: git false and empty baselines', () => {
  const home = makeHome();
  const dir = tmpDir();
  assert.equal(stamp(dir, home).status, 0);
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(dir).key);
  assert.equal(st.git, false);
  assert.equal(st.turn.head, null);
  assert.deepEqual(st.turn.baseline, {});
});

test('home directory: turn.skip is set', () => {
  const home = makeHome();
  const fakeHome = tmpDir();
  assert.equal(stamp(fakeHome, home, { HOME: fakeHome }).status, 0);
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(fakeHome).key);
  assert.equal(st.turn.skip, true);
});

test('home directory that is a git repo is not scanned', () => {
  const home = makeHome();
  const fakeHome = initRepo();
  write(fakeHome, 'big.txt', Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n');
  const r = stamp(fakeHome, home, { HOME: fakeHome });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  process.env.SPRINT_RECAP_HOME = home;
  const st = state.readState(state.resolveCwd(fakeHome).key);
  assert.equal(st.turn.skip, true);
  assert.deepEqual(st.turn.baseline, {});
  assert.equal(st.turn.head, null);
});

test('a second prompt keeps the sprint and resets recap_rendered_at', () => {
  const home = makeHome();
  const repo = initRepo();
  stamp(repo, home);
  process.env.SPRINT_RECAP_HOME = home;
  const key = state.resolveCwd(repo).key;
  const st = state.readState(key);
  const sprintStart = st.sprint.started_at;
  st.turn.recap_rendered_at = '2026-09-12T09:00:00.000Z';
  state.writeState(key, st);
  write(repo, 'later.txt', 'x\n');
  stamp(repo, home);
  const again = state.readState(key);
  assert.equal(again.sprint.started_at, sprintStart);
  assert.equal(again.turn.recap_rendered_at, null);
  assert.deepEqual(again.turn.baseline['later.txt'], [1, 0]);
});

test('corrupt state is logged and replaced', () => {
  const home = makeHome();
  const repo = initRepo();
  process.env.SPRINT_RECAP_HOME = home;
  const key = state.resolveCwd(repo).key;
  fs.mkdirSync(path.dirname(state.statePath(key)), { recursive: true });
  fs.writeFileSync(state.statePath(key), '{ broken');
  const r = stamp(repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(state.readState(key).turn);
  assert.match(fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8'), /stamp-turn/);
});

test('garbage stdin still exits 0 silently', () => {
  const r = run('stamp-turn.js', { input: 'not json', env: { SPRINT_RECAP_HOME: makeHome() }, cwd: tmpDir() });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
