// Raw TeX blocks: an environment from `\begin` to its matching `\end`, or a
// line of commands. Each span covers exactly the characters Pandoc keeps raw.
// An environment can end mid-line, and a command line can carry a `%` comment;
// either way what follows on the line is a paragraph.

import { BLANK } from '../lines.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */
/** @typedef {import('../types.js').Match} Match */

const BEGIN = /^ {0,3}\\begin\{([^}]+)\}/;

// Commands and their arguments, then optionally a comment. Prose after the
// last argument makes the whole line a paragraph, and an environment is raw
// only with its matching end, so neither half counts here.
const COMMAND_LINE =
  /^(?!\\(?:begin|end)\{)(\\[A-Za-z]+\*?(?:[ \t]*(?:\{[^{}]*\}|\[[^\]]*\]))*)[ \t]*(?:%.*)?$/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where the environment opened on line `at` ends: the line, and the offset just
// past its matching `\end`, counting nested ones of the same name. Null when it
// never closes, which Pandoc reads as paragraph text.
function environmentEnd(lines, at, name) {
  const marker = new RegExp(`\\\\(begin|end)\\{${escapeRegExp(name)}\\}`, 'g');
  let depth = 0;
  for (let n = at; n < lines.length; n++) {
    for (const m of lines[n].text.matchAll(marker)) {
      depth += m[1] === 'begin' ? 1 : -1;
      if (depth === 0) {
        return { line: n, end: lines[n].start + m.index + m[0].length };
      }
    }
  }
  return null;
}

// The raw span, and whether text left on its last line opens a paragraph.
/** @returns {Match} */
function raw(lines, from, to, end, text) {
  const tail = text.slice(end, lines[to].end);
  return {
    last: to,
    after: BLANK.test(tail) ? 'start' : 'paragraph',
    spans: [{ type: 'raw-tex', from, to, start: lines[from].start, end }],
  };
}

/**
 * An environment interrupts a paragraph.
 *
 * @type {Recognizer}
 */
export const texEnvironment = {
  name: 'tex-environment',
  interruptsParagraph: true,
  match(lines, at, { text }) {
    const name = BEGIN.exec(lines[at].text)?.[1];
    if (name === undefined) return null;
    const close = environmentEnd(lines, at, name);
    return close === null ? null : raw(lines, at, close.line, close.end, text);
  },
};

/**
 * A command line continues a paragraph, so it opens only at a block start.
 *
 * @type {Recognizer}
 */
export const texCommandLine = {
  name: 'tex-command-line',
  interruptsParagraph: false,
  match(lines, at, { text }) {
    const commands = COMMAND_LINE.exec(lines[at].text)?.[1];
    if (commands === undefined) return null;
    return raw(lines, at, at, lines[at].start + commands.length, text);
  },
};

/**
 * Merge raw spans on consecutive lines: Pandoc reads them as one block.
 * Adjacency is by line, since inside a container one line's content does not
 * start where the last one's ended.
 *
 * @param {SpanSpec[]} spans Raw TeX spans, in source order.
 * @returns {SpanSpec[]}
 */
export function mergeAdjacent(spans) {
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span.from === last.to + 1) {
      last.to = span.to;
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
