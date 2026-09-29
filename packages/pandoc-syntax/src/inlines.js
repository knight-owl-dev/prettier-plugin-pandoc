// Where Pandoc's inline raw TeX is, in the text Pandoc reads as markdown.
//
// Pandoc keeps a TeX command and its arguments raw: `\footnote{see *this*}` is
// one raw span, the emphasis inside it included. Its LaTeX reader knows each
// command's arity, which a scan cannot, so a span here may run wider than the
// raw text Pandoc keeps — `\emph[o]{x}` is raw only as far as `\emph[`. It
// never runs narrower: every raw inline Pandoc finds lies inside one span, so a
// caller that leaves the spans as written leaves Pandoc's raw text alone.

import { blocks } from './blocks/index.js';

const LETTER = /[A-Za-z]/;
const SPACE = /[ \t]/;

// Where markdown is not read: every block but a container or a div's body,
// whose fence lines are markup of their own.
const CONTAINERS = new Set(['block-quote', 'list-item']);

function opaqueSpans(found) {
  return found
    .filter((block) => !CONTAINERS.has(block.type))
    .flatMap((block) =>
      block.type === 'div'
        ? [block.open, block.close].filter((span) => span !== null)
        : [block],
    )
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
}

// The offset just past the group opening at `at` with `open`, or -1 when it
// never closes. A blank line ends the paragraph, and the group with it; a
// backslash escapes the character after it.
function groupEnd(text, at, open, close) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
    else if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 64))) {
      return -1;
    }
  }
  return -1;
}

// The command starting at `at`, a backslash before a letter, and where its
// span ends; null when Pandoc keeps none of it raw.
function command(text, at) {
  let i = at + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  const name = text.slice(at + 1, i);
  // An environment written inline is not raw TeX to Pandoc.
  if (name === 'begin' || name === 'end') return null;
  if (text[i] === '*') i++;

  // The first argument may sit after spaces, or one line down; the rest follow
  // it directly.
  let args = 0;
  for (;;) {
    let j = i;
    if (args === 0) {
      while (SPACE.test(text[j] ?? '')) j++;
      if (text[j] === '\n') j++;
      while (SPACE.test(text[j] ?? '')) j++;
    }
    const pair = { '{': '}', '[': ']' }[text[j]];
    if (pair === undefined) break;
    const end = groupEnd(text, j, text[j], pair);
    // An unclosed brace leaves the whole command as text.
    if (end === -1) return text[j] === '{' ? null : { end: i };
    i = end;
    args++;
  }
  // With no argument, the command takes the spaces after it.
  if (args === 0) while (SPACE.test(text[i] ?? '')) i++;
  return { end: i };
}

// The offset past an inline construct that holds no raw TeX — a code span,
// an HTML comment, math — opening at `at`, or `at` itself when none does.
function skipOpaqueInline(text, at) {
  const c = text[at];
  if (c === '`') {
    let n = at;
    while (text[n] === '`') n++;
    const run = text.slice(at, n);
    // A code span closes on a run of the same length and no longer.
    const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
    close.lastIndex = n;
    const match = close.exec(text);
    return match === null ? n : match.index + run.length;
  }
  if (text.startsWith('<!--', at)) {
    const end = text.indexOf('-->', at + 4);
    return end === -1 ? at : end + 3;
  }
  if (c === '$') {
    if (text[at + 1] === '$') {
      const end = text.indexOf('$$', at + 2);
      return end === -1 ? at : end + 2;
    }
    // Inline math opens on a `$` before a non-space and closes on one after a
    // non-space, not followed by a digit — so a price stays a price.
    if (/\S/.test(text[at + 1] ?? '') && text[at + 1] !== '$') {
      for (let i = at + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (
          text[i] === '\n' &&
          /^\n[ \t]*\n/.test(text.slice(i, i + 64))
        ) {
          break;
        } else if (
          text[i] === '$' &&
          /\S/.test(text[i - 1]) &&
          !/\d/.test(text[i + 1] ?? '')
        ) {
          return i + 1;
        }
      }
    }
  }
  return at;
}

/**
 * Find every inline raw TeX span, in source order.
 *
 * @param {string} text Pandoc markdown.
 * @param {ReturnType<typeof blocks>} [found] What `blocks` found in `text`,
 *   for a caller that already has it.
 * @returns {{type: 'raw-tex', start: number, end: number}[]} Offsets into
 *   `text`.
 */
export function inlines(text, found = blocks(text)) {
  const spans = [];
  const opaque = opaqueSpans(found);
  let next = 0;

  for (let i = 0; i < text.length; ) {
    while (next < opaque.length && opaque[next].end <= i) next++;
    if (next < opaque.length && opaque[next].start <= i) {
      i = opaque[next].end;
      continue;
    }
    const past = skipOpaqueInline(text, i);
    if (past > i) {
      i = past;
    } else if (text[i] === '\\' && LETTER.test(text[i + 1] ?? '')) {
      const cmd = command(text, i);
      if (cmd === null) {
        i += 2;
      } else {
        spans.push({ type: 'raw-tex', start: i, end: cmd.end });
        i = cmd.end;
      }
    } else {
      // A backslash before anything else escapes it.
      i += text[i] === '\\' ? 2 : 1;
    }
  }
  return spans;
}
