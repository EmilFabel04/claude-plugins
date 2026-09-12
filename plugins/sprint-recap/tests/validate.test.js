'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecap, ValidationError } = require('../scripts/lib/validate');

const example = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'example.json'), 'utf8'));

function fieldOf(fn) {
  try { fn(); } catch (e) { assert.ok(e instanceof ValidationError, `expected ValidationError, got ${e}`); return e.field; }
  assert.fail('expected a ValidationError');
}

test('accepts the spec example and normalises optional fields', () => {
  const r = validateRecap(example());
  assert.equal(r.title, 'Artefacts registry v1');
  assert.equal(r.components.length, 3);
  assert.deepEqual(r.edges, [['ui', 'api'], ['api', 'db']]);
  assert.equal(r.verification[1].detail, '');
  assert.equal(r.decisions[0].why, 'single list query');
});

test('minimal recap needs only title and questions', () => {
  const r = validateRecap({ title: 'x', questions: [{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }] });
  assert.deepEqual(r.components, []);
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.decisions, []);
  assert.deepEqual(r.verification, []);
});

test('title length limits', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), title: '' })), 'title');
  assert.equal(fieldOf(() => validateRecap({ ...example(), title: 'x'.repeat(29) })), 'title');
  assert.equal(validateRecap({ ...example(), title: 'x'.repeat(28) }).title.length, 28);
});

test('component limits and duplicate ids', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, label: 'l' }));
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: seven, edges: [] })), 'components');
  const dup = [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }];
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: dup, edges: [] })), 'components[1].id');
  const long = [{ id: 'a', label: 'x'.repeat(23) }];
  assert.equal(fieldOf(() => validateRecap({ ...example(), components: long, edges: [] })), 'components[0].label');
});

test('edges must reference known ids and be pairs', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), edges: [['ui', 'nope']] })), 'edges[0]');
  assert.equal(fieldOf(() => validateRecap({ ...example(), edges: [['ui']] })), 'edges[0]');
});

test('decision limits', () => {
  const six = Array.from({ length: 6 }, () => ({ chose: 'a', over: 'b' }));
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: six })), 'decisions');
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: [{ chose: 'x'.repeat(21), over: 'b' }] })), 'decisions[0].chose');
  assert.equal(fieldOf(() => validateRecap({ ...example(), decisions: [{ chose: 'a', over: 'b', why: 'x'.repeat(51) }] })), 'decisions[0].why');
});

test('verification limits and result enum', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'a', result: 'ok' }] })), 'verification[0].result');
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'x'.repeat(29), result: 'pass' }] })), 'verification[0].check');
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: [{ check: 'a', result: 'pass', detail: 'x'.repeat(21) }] })), 'verification[0].detail');
  const six = Array.from({ length: 6 }, () => ({ check: 'a', result: 'pass' }));
  assert.equal(fieldOf(() => validateRecap({ ...example(), verification: six })), 'verification');
});

test('questions must match the configured count', () => {
  assert.equal(fieldOf(() => validateRecap({ ...example(), questions: [{ q: 'a?', a: 'b' }] })), 'questions');
  const three = [{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }, { q: 'e?', a: 'f' }];
  assert.equal(validateRecap({ ...example(), questions: three }, { questions: 3 }).questions.length, 3);
  assert.equal(fieldOf(() => validateRecap({ ...example(), questions: [{ q: 'x'.repeat(99), a: 'b' }, { q: 'c?', a: 'd' }] })), 'questions[0].q');
  assert.equal(fieldOf(() => validateRecap({ ...example(), questions: [{ q: 'a?', a: 'x'.repeat(201) }, { q: 'c?', a: 'd' }] })), 'questions[0].a');
});

test('strings are sanitized so wide characters become ?', () => {
  const r = validateRecap({ ...example(), title: '日本 test' });
  assert.equal(r.title, '?? test');
});

test('non-object input is rejected', () => {
  assert.equal(fieldOf(() => validateRecap([])), 'recap');
  assert.equal(fieldOf(() => validateRecap(null)), 'recap');
});
