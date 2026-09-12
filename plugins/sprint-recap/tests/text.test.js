'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, width, fit, padStart, wrapWords } = require('../scripts/lib/text');

test('sanitize keeps ASCII and Latin letters, replaces wide and emoji with ?', () => {
  assert.equal(sanitize('héllo øre café'), 'héllo øre café');
  assert.equal(sanitize('日本 x'), '?? x');
  assert.equal(sanitize('go 🚀'), 'go ?');
  assert.equal(sanitize('tab\there'), 'tab?here');
  assert.equal(sanitize('soft­hyphen'), 'soft?hyphen');
});

test('sanitize normalises decomposed accents before checking', () => {
  assert.equal(sanitize('é'), 'é');
});

test('width counts code points', () => {
  assert.equal(width('╭─●…'), 4);
  assert.equal(width(''), 0);
});

test('fit pads short strings and cuts long ones with an ellipsis', () => {
  assert.equal(fit('abc', 5), 'abc  ');
  assert.equal(fit('abcdef', 5), 'abcd…');
  assert.equal(fit('abcde', 5), 'abcde');
  assert.equal(fit('', 2), '  ');
});

test('padStart right-aligns', () => {
  assert.equal(padStart('+12', 6), '   +12');
  assert.equal(padStart('+1234567', 6), '+1234567');
});

test('wrapWords wraps at word boundaries within the limit', () => {
  assert.deepEqual(wrapWords('the quick brown fox jumps', 10, 3), ['the quick', 'brown fox', 'jumps']);
});

test('wrapWords breaks words longer than the width', () => {
  assert.deepEqual(wrapWords('abcdefghijkl end', 5, 4), ['abcde', 'fghij', 'kl', 'end']);
});

test('wrapWords cuts overflow past maxLines with an ellipsis', () => {
  const lines = wrapWords('one two three four five six', 9, 2);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'one two');
  assert.ok(lines[1].endsWith('…'));
  assert.ok(width(lines[1]) <= 9);
});

test('wrapWords returns one empty line for empty input', () => {
  assert.deepEqual(wrapWords('', 10, 2), ['']);
});
