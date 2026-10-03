// Inline constructs that hold no raw TeX: code spans, HTML comments and tags,
// math, autolinks.
// A paragraph break ends each but a comment or a tag.

import { breaksParagraph, paragraphEnd } from './lines.js';

export const COMMENT_OPEN = '<!--';
export const COMMENT_CLOSE = '-->';
const DISPLAY_MATH = '$$';
const INLINE_MATH = '$';

// Pandoc links many schemes; only the common ones are read here, the rest
// left as text.
const AUTOLINK =
  /<(?:(?:https?|ftp|file|mailto):[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/y;

// A tag, its attribute values included.
const TAG =
  /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/y;

// A code span closes on a backtick run of the same length as its opener, and
// no longer; one never closed leaves its backticks as text.
function codeSpanEnd(text, at) {
  let n = at;
  while (text[n] === '`') n++;
  const run = text.slice(at, n);
  const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
  close.lastIndex = n;
  const match = close.exec(text);
  return match === null || match.index > paragraphEnd(text, n)
    ? n
    : match.index + run.length;
}

// The offset past the balanced group opening at `at`, or null when none closes
// before a paragraph break.
function bracedEnd(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === '\n' && breaksParagraph(text, i)) return null;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i + 1;
  }
  return null;
}

// What may not come before a formula's closing `$`.
const SPACING = /[ \t\n]/;

// What follows `\text` in a formula: a group Pandoc reads whole, a `$` in it
// included.
const TEXT_GROUP = '\\text{';

// Inline math opens on a `$` before a non-space and closes on one after
// anything but a space, a tab or a newline, an escaped character included,
// not followed by a digit — so a price stays a price. A paragraph break ends
// the search, and so does a `$` that cannot close: a formula holds none
// outside a `\text` group.
function inlineMathEnd(text, at) {
  const first = text[at + 1] ?? '';
  if (!/\S/.test(first) || first === INLINE_MATH) return at;
  let escaped = -1;
  for (let i = at + 1; i < text.length; i++) {
    const char = text[i];
    if (text.startsWith(TEXT_GROUP, i)) {
      const end = bracedEnd(text, i + TEXT_GROUP.length - 1);
      if (end !== null) i = end - 1;
    } else if (char === '\\') escaped = ++i;
    else if (char === '\n' && breaksParagraph(text, i)) break;
    else if (char === INLINE_MATH) {
      const after = escaped === i - 1 || !SPACING.test(text[i - 1]);
      const closes = after && !/\d/.test(text[i + 1] ?? '');
      return closes ? i + 1 : at;
    }
  }
  return at;
}

// The offset past the pair of `open` and `close` starting at `at`, or `at`
// when it never closes before `limit`.
function pairEnd(text, at, open, close, limit = text.length) {
  const end = text.indexOf(close, at + open.length);
  return end === -1 || end > limit ? at : end + close.length;
}

/**
 * The offset past the opaque construct opening at `at`, or `at` itself when
 * none does.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
export function opaqueEnd(text, at) {
  if (text[at] === '`') return codeSpanEnd(text, at);
  if (text.startsWith(COMMENT_OPEN, at)) {
    return pairEnd(text, at, COMMENT_OPEN, COMMENT_CLOSE);
  }
  if (text[at] === '<') {
    AUTOLINK.lastIndex = at;
    const link = AUTOLINK.exec(text);
    if (link !== null) return at + link[0].length;
    TAG.lastIndex = at;
    const tag = TAG.exec(text);
    if (tag !== null) return at + tag[0].length;
  }
  if (text.startsWith(DISPLAY_MATH, at)) {
    const limit = paragraphEnd(text, at);
    return pairEnd(text, at, DISPLAY_MATH, DISPLAY_MATH, limit);
  }
  if (text[at] === INLINE_MATH) return inlineMathEnd(text, at);
  return at;
}
