'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecap } = require('../scripts/lib/validate');
const { layoutCard, flowRows, LayoutError } = require('../scripts/lib/layout');
const { width } = require('../scripts/lib/text');

const FIX = path.join(__dirname, 'fixtures');
const load = (name) => validateRecap(JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')));
const meta = { elapsed: '12m', files: 4 };

function groups(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `src/dir${i}`, files: 2, added: 100 - i * 10, removed: i }));
}
const eightGroups = { git: true, groups: groups(8) };

function bodies(rows, label) {
  // Body text of the rows belonging to one section, identified by its gutter label.
  const start = rows.findIndex((r) => r.startsWith("│") && r.slice(3, 15).trim() === label);
  if (start < 0) return [];
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (i > start && (r.trim() === '│' + ' '.repeat(68) + '│' || r.startsWith('╰'))) break;
    if (i > start && r.slice(3, 15).trim() !== '' && r.slice(3, 15).trim() !== 'YOURSELF') break;
    out.push(r.slice(15, 67).trimEnd());
  }
  return out;
}

test('every fixture renders rows of exactly 70 code points and at most 30 rows', () => {
  for (const file of fs.readdirSync(FIX)) {
    const rows = layoutCard({ recap: load(file), changes: eightGroups, meta });
    assert.ok(rows.length <= 30, `${file}: ${rows.length} rows`);
    for (const r of rows) assert.equal(width(r), 70, `${file}: "${r}"`);
  }
});

test('header carries title, elapsed and file count; footer closes the box', () => {
  const rows = layoutCard({ recap: load('example.json'), changes: null, meta });
  assert.ok(rows[0].startsWith('╭─ Sprint recap · Artefacts registry v1 ─'));
  assert.ok(rows[0].endsWith(' 12m · 4 files ─╮'));
  assert.equal(rows.at(-1), '╰' + '─'.repeat(68) + '╯');
});

test('a long title is cut with an ellipsis when the header is crowded', () => {
  const recap = load('max.json');
  const rows = layoutCard({ recap, changes: null, meta: { elapsed: 'baseline lost', files: 12 } });
  assert.ok(rows[0].includes('…'));
  assert.equal(width(rows[0]), 70);
});

test('sections appear in order with one blank row before each and correct labels', () => {
  const rows = layoutCard({ recap: load('example.json'), changes: eightGroups, meta });
  const labels = rows.filter((r) => r.startsWith("│")).map((r) => r.slice(3, 15).trim()).filter(Boolean);
  assert.deepEqual(labels, ['CHANGED', 'FLOW', 'DECIDED', 'VERIFIED', 'CHECK', 'YOURSELF']);
  const blankIdx = rows.map((r, i) => (r === '│' + ' '.repeat(68) + '│' ? i : -1)).filter((i) => i >= 0);
  assert.equal(blankIdx.length, 5);
});

test('empty sections are omitted', () => {
  const rows = layoutCard({ recap: load('minimal.json'), changes: null, meta });
  const labels = rows.filter((r) => r.startsWith("│")).map((r) => r.slice(3, 15).trim()).filter(Boolean);
  assert.deepEqual(labels, ['CHECK', 'YOURSELF']);
});

test('CHANGED rows: path 18, bar 16 scaled to the largest, +added in 6, -removed in 5', () => {
  const changes = { git: true, groups: [
    { name: 'src/app', files: 3, added: 160, removed: 8 },
    { name: 'prisma', files: 1, added: 20, removed: 1 },
    { name: 'a-very-long-directory/name', files: 1, added: 1, removed: 0 },
  ] };
  const b = bodies(layoutCard({ recap: load('minimal.json'), changes, meta }), 'CHANGED');
  assert.equal(b[0], 'src/app            ' + '█'.repeat(16) + '   +160   -8');
  assert.equal(b[1], 'prisma             ' + '██' + ' '.repeat(14) + '    +20   -1');
  assert.ok(b[2].startsWith('a-very-long-direc…'));
  assert.equal(b[2].slice(19, 20), '█');
});

test('CHANGED outside git shows file counts instead of bars', () => {
  const changes = { git: false, groups: [{ name: 'notes', files: 3, added: 0, removed: 0 }, { name: 'todo.md', files: 1, added: 0, removed: 0 }] };
  const b = bodies(layoutCard({ recap: load('minimal.json'), changes, meta }), 'CHANGED');
  assert.equal(b[0], 'notes              3 files');
  assert.equal(b[1], 'todo.md            1 file');
});

test('DECIDED rows: bullet line then indented why', () => {
  const b = bodies(layoutCard({ recap: load('example.json'), changes: null, meta }), 'DECIDED');
  assert.deepEqual(b, ['● polymorphic table  over  one table per type', '  single list query']);
});

test('VERIFIED rows use the right glyph per result', () => {
  const recap = load('max.json');
  const b = bodies(layoutCard({ recap, changes: null, meta }), 'VERIFIED');
  assert.deepEqual(b.map((r) => r[0]), ['✓', '✗', '○', '?', '✓']);
  assert.equal(b[0], '✓ vitest artefacts full suite!  14/14 passed locally');
});

test('CHECK YOURSELF numbers questions and wraps to at most two rows each', () => {
  const rows = layoutCard({ recap: load('max.json'), changes: null, meta });
  const b = bodies(rows, 'CHECK');
  assert.equal(b.length, 4);
  assert.ok(b[0].startsWith('1. '));
  assert.ok(b[1].startsWith('   '));
  assert.ok(b[2].startsWith('2. '));
  for (const r of b) assert.ok(width(r) <= 52);
});

test('flow: linear chain joins nodes with arrows', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['b', 'c']], false, 52), ['[A] → [B] → [C]']);
});

test('flow: disconnected nodes are listed after, comma separated', () => {
  const c = [{ id: 'x', label: 'X' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.deepEqual(flowRows(c, [['a', 'b']], false, 52), ['[A] → [B], [X]']);
});

test('flow: cycles are laid out in input order without looping', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['b', 'a']], false, 52), ['[A] → [B]']);
});

test('flow: branches show the first edge and list the rest', () => {
  const c = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.deepEqual(flowRows(c, [['a', 'b'], ['a', 'c']], false, 52), ['[A] → [B], [C]']);
});

test('flow: wraps past the body width onto indented continuation rows', () => {
  const recap = load('max.json');
  const rows = flowRows(recap.components, recap.edges, false, 52);
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.ok(width(r) <= 52, r);
  for (const r of rows.slice(1)) assert.ok(r.startsWith('  → ['), r);
});

test('flow: collapsed form', () => {
  const recap = load('max.json');
  assert.deepEqual(flowRows(recap.components, recap.edges, true, 52), ['6 components, 5 edges']);
});

test('trim steps apply in order as the row budget shrinks', () => {
  const recap = load('max.json');
  const args = (maxRows) => ({ recap, changes: eightGroups, meta, maxRows });

  const r0 = layoutCard(args(100));
  assert.equal(bodies(r0, 'CHANGED').length, 8);
  assert.equal(bodies(r0, 'DECIDED').length, 10);
  assert.ok(bodies(r0, 'FLOW').length >= 3);

  const r1 = layoutCard(args(r0.length - 1));                     // step 1
  assert.deepEqual(bodies(r1, 'CHANGED').slice(3), ['+5 more']);
  assert.equal(bodies(r1, 'DECIDED').length, 10);

  const r2 = layoutCard(args(r1.length - 1));                     // step 2
  assert.equal(bodies(r2, 'DECIDED').length, 5);
  assert.ok(bodies(r2, 'DECIDED').every((b) => b.startsWith('●')));
  assert.deepEqual(bodies(r2, 'CHANGED').slice(3), ['+5 more']);

  const r3 = layoutCard(args(r2.length - 1));                     // step 3
  assert.deepEqual(bodies(r3, 'DECIDED').slice(3), ['+2 more']);
  assert.equal(bodies(r3, 'DECIDED').length, 4);

  const r4 = layoutCard(args(r3.length - 1));                     // step 4
  assert.deepEqual(bodies(r4, 'CHANGED').slice(2), ['+6 more']);
  assert.ok(bodies(r4, 'FLOW').length >= 3);

  const r5 = layoutCard(args(r4.length - 1));                     // step 5
  assert.deepEqual(bodies(r5, 'FLOW'), ['6 components, 5 edges']);
  assert.equal(bodies(r5, 'VERIFIED').length, 5);
  assert.equal(bodies(r5, 'CHECK').length, 4);

  assert.throws(() => layoutCard(args(r5.length - 1)), LayoutError);
});

test('the maximum fixture with eight changed groups fits in 30 rows without throwing', () => {
  const rows = layoutCard({ recap: load('max.json'), changes: eightGroups, meta });
  assert.ok(rows.length <= 30);
});

test('width below 70 is rejected', () => {
  assert.throws(() => layoutCard({ recap: load('minimal.json'), changes: null, meta, width: 60 }), LayoutError);
});
