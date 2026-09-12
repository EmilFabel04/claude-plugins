'use strict';
const { sanitize, width } = require('./text');

const RESULTS = ['pass', 'fail', 'skipped', 'unverified'];

class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

function str(value, field, min, max) {
  if (typeof value !== 'string') throw new ValidationError(field, 'must be a string');
  const clean = sanitize(value).trim();
  const w = width(clean);
  if (w < min || w > max) throw new ValidationError(field, `must be ${min} to ${max} characters, got ${w}`);
  return clean;
}

function optStr(value, field, max) {
  return value === undefined || value === null ? '' : str(value, field, 0, max);
}

function list(value, field, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, 'must be an array');
  if (value.length > max) throw new ValidationError(field, `at most ${max} entries, got ${value.length}`);
  return value;
}

function obj(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(field, 'must be an object');
  return value;
}

function validateRecap(input, { questions = 2 } = {}) {
  obj(input, 'recap');
  const out = {};
  out.title = str(input.title, 'title', 1, 28);

  const ids = new Set();
  out.components = list(input.components, 'components', 6).map((c, i) => {
    const f = `components[${i}]`;
    obj(c, f);
    const id = str(c.id, `${f}.id`, 1, 40);
    if (ids.has(id)) throw new ValidationError(`${f}.id`, `duplicate id "${id}"`);
    ids.add(id);
    return { id, label: str(c.label, `${f}.label`, 1, 22) };
  });

  out.edges = list(input.edges, 'edges', 30).map((e, i) => {
    const f = `edges[${i}]`;
    if (!Array.isArray(e) || e.length !== 2) throw new ValidationError(f, 'must be a pair [from, to]');
    const pair = e.map((id) => (typeof id === 'string' ? sanitize(id).trim() : ''));
    for (const id of pair) if (!ids.has(id)) throw new ValidationError(f, `unknown component id "${id}"`);
    return pair;
  });

  out.decisions = list(input.decisions, 'decisions', 5).map((d, i) => {
    const f = `decisions[${i}]`;
    obj(d, f);
    return {
      chose: str(d.chose, `${f}.chose`, 1, 20),
      over: str(d.over, `${f}.over`, 1, 20),
      why: optStr(d.why, `${f}.why`, 50),
    };
  });

  out.verification = list(input.verification, 'verification', 5).map((v, i) => {
    const f = `verification[${i}]`;
    obj(v, f);
    if (!RESULTS.includes(v.result)) throw new ValidationError(`${f}.result`, `must be one of ${RESULTS.join(', ')}`);
    return {
      check: str(v.check, `${f}.check`, 1, 28),
      result: v.result,
      detail: optStr(v.detail, `${f}.detail`, 20),
    };
  });

  if (!Array.isArray(input.questions) || input.questions.length !== questions) {
    throw new ValidationError('questions', `must have exactly ${questions} entries`);
  }
  out.questions = input.questions.map((q, i) => {
    const f = `questions[${i}]`;
    obj(q, f);
    return { q: str(q.q, `${f}.q`, 1, 98), a: str(q.a, `${f}.a`, 1, 200) };
  });

  return out;
}

module.exports = { validateRecap, ValidationError, RESULTS };
