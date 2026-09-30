// Raw TeX blocks: an environment from `\begin` to its matching `\end`, or a
// line of commands. Each span covers exactly the characters Pandoc keeps raw.
// An environment can end mid-line, and a command line can carry a `%` comment;
// either way what follows on the line is a paragraph.

import { BLANK } from '../lines.js';
import { perSyntax } from '../syntax.js';
import { BEGIN, environmentEnd } from '../tex.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */
/** @typedef {import('../types.js').Match} Match */

const patterns = perSyntax((syntax) => ({
  begin: syntax.atBlockIndent(BEGIN),
}));

// Commands and their arguments, then optionally a comment. Prose after the
// last argument makes the whole line a paragraph, and an environment is raw
// only with its matching end, so neither half counts here.
const COMMAND_LINE =
  /^(?!\\(?:begin|end)\{)(\\[A-Za-z]+\*?(?:[ \t]*(?:\{[^{}]*\}|\[[^\]]*\]))*)[ \t]*(?:%.*)?$/;

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
  opensAhead: (text, syntax) => patterns(syntax).begin.test(text),
  match(lines, at, { syntax, text }) {
    const name = patterns(syntax).begin.exec(lines[at].text)?.[1];
    if (name === undefined) return null;
    const close = environmentEnd(name, lines.slice(at));
    return close === null
      ? null
      : raw(lines, at, at + close.chunk, close.end, text);
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
