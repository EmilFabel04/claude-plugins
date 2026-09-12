'use strict';

// Every allowed code point renders in exactly one terminal column:
// printable ASCII, Latin-1 symbols and letters, Latin Extended-A/B.
// Soft hyphen U+00AD is zero-width and therefore excluded.
const ALLOWED = /[\x20-\x7E¡-¬®-ɏ]/u;
const ELLIPSIS = '…';

function sanitize(str) {
  return [...String(str).normalize('NFC')].map((c) => (ALLOWED.test(c) ? c : '?')).join('');
}

function width(str) {
  return [...str].length;
}

// Exactly n code points: pad with spaces or cut to n-1 plus an ellipsis.
function fit(str, n) {
  const chars = [...str];
  if (chars.length <= n) return str + ' '.repeat(n - chars.length);
  if (n <= 1) return ELLIPSIS.repeat(n);
  return chars.slice(0, n - 1).join('') + ELLIPSIS;
}

function padStart(str, n) {
  const w = width(str);
  return w >= n ? str : ' '.repeat(n - w) + str;
}

// Word-wrap into at most maxLines lines of at most n code points.
function wrapWords(str, n, maxLines) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (width(word) > n) {
      if (line) { lines.push(line); line = ''; }
      const chars = [...word];
      lines.push(chars.slice(0, n).join(''));
      word = chars.slice(n).join('');
    }
    if (!word) continue;
    if (!line) line = word;
    else if (width(line) + 1 + width(word) <= n) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length === 0) lines.push('');
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    return [...lines.slice(0, maxLines - 1), fit(rest, n).trimEnd()];
  }
  return lines;
}

module.exports = { sanitize, width, fit, padStart, wrapWords, ELLIPSIS };
