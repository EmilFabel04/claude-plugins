'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { makeHome, write } = require('./helpers');
const { baseDir, loadConfig } = require('../scripts/lib/config');

test('baseDir honours SPRINT_RECAP_HOME', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  assert.equal(baseDir(), home);
  delete process.env.SPRINT_RECAP_HOME;
  assert.ok(baseDir().endsWith(path.join('.claude', 'sprint-recap')));
});

test('loadConfig returns shipped defaults when no user file exists', () => {
  process.env.SPRINT_RECAP_HOME = makeHome();
  assert.deepEqual(loadConfig(), { minFiles: 2, minLines: 20, width: 70, maxRows: 30, questions: 2 });
});

test('loadConfig merges user overrides over defaults', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  write(home, 'config.json', JSON.stringify({ minLines: 5, questions: 3 }));
  const c = loadConfig();
  assert.equal(c.minLines, 5);
  assert.equal(c.questions, 3);
  assert.equal(c.minFiles, 2);
});

test('loadConfig throws on a corrupt user file', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  write(home, 'config.json', '{ not json');
  assert.throws(() => loadConfig(), (e) => /^config\.json: /.test(e.message));
});

test('loadConfig rejects a non-integer value', () => {
  const home = makeHome();
  process.env.SPRINT_RECAP_HOME = home;
  write(home, 'config.json', JSON.stringify({ width: '70' }));
  assert.throws(() => loadConfig(), (e) => /config\.json: width must be a positive integer/.test(e.message));
});
