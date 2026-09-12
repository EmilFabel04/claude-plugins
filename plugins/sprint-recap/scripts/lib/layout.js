'use strict';
const { fit, width, padStart, wrapWords } = require('./text');

const MIN_WIDTH = 70;
const GUTTER = 12;
const MARGIN = 2;
const GLYPH = { pass: '✓', fail: '✗', skipped: '○', unverified: '?' };

class LayoutError extends Error {
  constructor(message) { super(message); this.name = 'LayoutError'; }
}

// W = total width including borders, B = body width after gutter and margins.
function geometry(w) {
  if (!Number.isInteger(w) || w < MIN_WIDTH) throw new LayoutError(`width must be an integer >= ${MIN_WIDTH}`);
  return { W: w, B: w - 2 - 2 * MARGIN - GUTTER };
}

function row(label, body, g) {
  if (width(body) > g.B) throw new LayoutError(`body wider than ${g.B}: "${body}"`);
  return '│' + ' '.repeat(MARGIN) + fit(label, GUTTER) + fit(body, g.B) + ' '.repeat(MARGIN) + '│';
}
const blank = (g) => '│' + ' '.repeat(g.W - 2) + '│';
const footer = (g) => '╰' + '─'.repeat(g.W - 2) + '╯';

function header(title, right, g) {
  const left = '╭─ Sprint recap · ';
  const tail = ` ${right} ─╮`;
  const avail = g.W - width(left) - 1 - width(tail);
  const t = width(title) > avail ? fit(title, avail) : title;
  const fill = g.W - width(left) - width(t) - 1 - width(tail);
  return left + t + ' ' + '─'.repeat(fill) + tail;
}

function section(label, bodyList, g, secondLabel = '') {
  return bodyList.map((b, i) => row(i === 0 ? label : i === 1 ? secondLabel : '', b, g));
}

// Numbers that would overflow their column collapse to thousands.
function num(n, w) {
  const s = String(n);
  return s.length <= w - 1 ? s : `${Math.floor(n / 1000)}k`;
}

function changedRows(changes, cap) {
  const all = changes.groups;
  const shown = all.slice(0, cap);
  const max = Math.max(1, ...shown.map((x) => x.added + x.removed));
  const out = shown.map((x) => {
    if (!changes.git) return `${fit(x.name, 18)} ${x.files} file${x.files === 1 ? '' : 's'}`;
    const bar = '█'.repeat(Math.max(1, Math.round(((x.added + x.removed) / max) * 16)));
    return `${fit(x.name, 18)} ${fit(bar, 16)} ${padStart('+' + num(x.added, 6), 6)}${padStart('-' + num(x.removed, 5), 5)}`;
  });
  if (all.length > shown.length) out.push(`+${all.length - shown.length} more`);
  return out;
}

// Chains of labels. Starts are nodes with no incoming edge that have an outgoing
// edge, in input order; then everything else in input order. Each chain follows
// the first edge to an unvisited node. Isolated nodes therefore come last.
function flowChains(components, edges) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out = new Map(components.map((c) => [c.id, []]));
  const indeg = new Map(components.map((c) => [c.id, 0]));
  for (const [a, b] of edges) { out.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
  const ids = components.map((c) => c.id);
  const starts = [...ids.filter((id) => indeg.get(id) === 0 && out.get(id).length > 0), ...ids];
  const visited = new Set();
  const chains = [];
  for (const start of starts) {
    if (visited.has(start)) continue;
    const chain = [];
    let cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      chain.push(byId.get(cur).label);
      cur = out.get(cur).find((n) => !visited.has(n));
    }
    chains.push(chain);
  }
  return chains;
}

function flowRows(components, edges, collapse, B) {
  if (collapse) return [`${components.length} components, ${edges.length} edges`];
  const rows = [];
  let line = '';
  const push = (sep, node) => {
    const candidate = line ? line + sep + node : node;
    if (line && width(candidate) > B) {
      rows.push(sep === ', ' ? line + ',' : line);
      line = (sep === ' → ' ? '  → ' : '  ') + node;
    } else {
      line = candidate;
    }
  };
  for (const chain of flowChains(components, edges)) {
    chain.forEach((label, i) => push(i === 0 ? ', ' : ' → ', `[${label}]`));
  }
  if (line) rows.push(line);
  return rows;
}

function decidedRows(decisions, { dropWhy, decisionsCap }) {
  const shown = decisions.slice(0, decisionsCap);
  const out = [];
  for (const d of shown) {
    out.push(`● ${d.chose}  over  ${d.over}`);
    if (!dropWhy && d.why) out.push(`  ${d.why}`);
  }
  if (decisions.length > shown.length) out.push(`+${decisions.length - shown.length} more`);
  return out;
}

function verifiedRows(items) {
  return items.map((v) => `${GLYPH[v.result]} ${fit(v.check, 28)}  ${v.detail}`.trimEnd());
}

function checkRows(questions, B) {
  const out = [];
  questions.forEach((q, i) => {
    wrapWords(q.q, B - 3, 2).forEach((line, li) => out.push((li === 0 ? `${i + 1}. ` : '   ') + line));
  });
  return out;
}

function build(recap, changes, meta, o, g) {
  const files = `${meta.files} file${meta.files === 1 ? '' : 's'}`;
  const rows = [header(recap.title, `${meta.elapsed} · ${files}`, g)];
  const add = (label, bodyList, second) => {
    if (!bodyList.length) return;
    rows.push(blank(g));
    rows.push(...section(label, bodyList, g, second));
  };
  if (changes && changes.groups.length) add('CHANGED', changedRows(changes, o.changedCap));
  if (recap.components.length) add('FLOW', flowRows(recap.components, recap.edges, o.collapseFlow, g.B));
  if (recap.decisions.length) add('DECIDED', decidedRows(recap.decisions, o));
  if (recap.verification.length) add('VERIFIED', verifiedRows(recap.verification));
  add('CHECK', checkRows(recap.questions, g.B), 'YOURSELF');
  rows.push(footer(g));
  return rows;
}

const TRIM_STEPS = [
  (o) => { o.changedCap = 3; },
  (o) => { o.dropWhy = true; },
  (o) => { o.decisionsCap = 3; },
  (o) => { o.changedCap = 2; },
  (o) => { o.collapseFlow = true; },
];

function layoutCard({ recap, changes = null, meta, width: w = MIN_WIDTH, maxRows = 30 }) {
  const g = geometry(w);
  const o = { changedCap: Infinity, dropWhy: false, decisionsCap: Infinity, collapseFlow: false };
  let rows = build(recap, changes, meta, o, g);
  for (const step of TRIM_STEPS) {
    if (rows.length <= maxRows) break;
    step(o);
    rows = build(recap, changes, meta, o, g);
  }
  if (rows.length > maxRows) throw new LayoutError(`card needs ${rows.length} rows, max ${maxRows}`);
  for (const r of rows) if (width(r) !== g.W) throw new LayoutError(`row is ${width(r)} columns: "${r}"`);
  return rows;
}

module.exports = { layoutCard, flowRows, LayoutError };
