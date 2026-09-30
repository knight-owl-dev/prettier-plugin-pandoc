// Raw TeX blocks: a run of environments and commands, `tex-run.js`. Each span
// covers exactly the characters Pandoc keeps raw. A run can end mid-line, and
// what follows on the line is a paragraph.
//
// An environment is no inline: in paragraph text it ends the paragraph at its
// `\begin`, wherever that sits, unless balanced brackets hold it.

import { commandEnd, startsCommand } from '../command.js';
import { BLANK, breaksParagraph } from '../lines.js';
import { COMMENT_CLOSE, COMMENT_OPEN, opaqueEnd } from '../opaque.js';
import { BEGIN } from '../tex.js';
import { runEnd } from './tex-run.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */
/** @typedef {import('../types.js').Match} Match */

const OPENS_ENVIRONMENT = new RegExp(BEGIN, 'y');

const BEGIN_PREFIX = '\\begin{';

// Past what opens at `at` in inline text: an opaque construct, a command and
// its arguments, an escape, or a character. A `\begin` is only its own text:
// brackets balance through an environment.
function past(text, at) {
  const opaque = opaqueEnd(text, at);
  if (opaque > at) return opaque;
  if (text.startsWith(BEGIN_PREFIX, at)) return at + BEGIN_PREFIX.length;
  if (startsCommand(text, at)) return commandEnd(text, at) ?? at + 2;
  return at + (text[at] === '\\' ? 2 : 1);
}

// Whether a paragraph break comes at `at`, ending the brackets and
// parentheses open there.
const breaksAt = (text, at) => text[at] === '\n' && breaksParagraph(text, at);

// The offset past the parentheses opening at `at`, or null.
function parensEnd(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (breaksAt(text, i)) return null;
    if (text[i] === '\\') i++;
    else if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return null;
}

// The offset past the brackets opening at `at`, a link destination after them
// included, or null when they never close.
function bracketsEnd(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; ) {
    if (breaksAt(text, i)) return null;
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) {
      return (text[i + 1] === '(' && parensEnd(text, i + 1)) || i + 1;
    }
    i = text[i] === '[' || text[i] === ']' ? i + 1 : past(text, i);
  }
  return null;
}

// The text from `start` on line `from` up to a blank line, or with `whole` to
// the end of `lines`, and where each line's text sits in it.
function viewFrom(lines, from, start, whole = false) {
  const parts = [];
  let text = '';
  for (let k = from; k < lines.length; k++) {
    if (!whole && k > from && BLANK.test(lines[k].text)) break;
    const head = k === from ? start - lines[k].start : 0;
    if (k > from) text += '\n';
    parts.push({ at: text.length, head });
    text += lines[k].text.slice(head);
  }
  return { text, parts };
}

/**
 * The environment in paragraph text on line `at`, and each after it on the
 * line it ends on. The paragraph is read from `start` on line `from`.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} start
 * @param {number} at
 * @param {string} text The whole source.
 * @returns {Match | null}
 */
function inParagraph(lines, from, start, at, text) {
  const line = lines[at];
  if (!line.text.includes(BEGIN_PREFIX)) return null;
  let view = viewFrom(lines, from, start);
  const { at: lineStart, head } = view.parts[at - from];
  const lineEnd = lineStart + line.text.length - head;
  for (let i = 0; i < lineEnd; ) {
    // Only an HTML comment runs past a paragraph break.
    if (
      view.text.startsWith(COMMENT_OPEN, i) &&
      !view.text.includes(COMMENT_CLOSE, i + COMMENT_OPEN.length)
    ) {
      view = viewFrom(lines, from, start, true);
    }
    OPENS_ENVIRONMENT.lastIndex = i;
    const name = OPENS_ENVIRONMENT.exec(view.text)?.[1];
    if (name === undefined) {
      i =
        (view.text[i] === '[' && bracketsEnd(view.text, i)) ||
        past(view.text, i);
      continue;
    }
    if (i >= lineStart) {
      const column = head + (i - lineStart);
      const end = runEnd(lines, { k: at, i: column });
      if (end !== null) return raw(lines, at, line.start + column, end, text);
    }
    i += BEGIN_PREFIX.length;
  }
  return null;
}

// The raw span from `start` on line `from` to the place `run` ends, and what
// the text after it on that line holds.
/** @returns {Match} */
function raw(lines, from, start, run, text) {
  const [to, end] = [run.k, lines[run.k].start + run.i];
  /** @type {SpanSpec} */
  const span = { type: 'raw-tex', from, to, start, end };
  if (BLANK.test(text.slice(end, lines[to].end))) {
    return { last: to, after: 'start', spans: [span] };
  }
  const next = inParagraph(lines, to, end, to, text);
  return next === null
    ? { last: to, after: 'paragraph', tail: end, spans: [span] }
    : { ...next, spans: [span, ...next.spans] };
}

/**
 * Whether line `at` holds an environment that would end a paragraph there.
 *
 * @param {Line[]} lines
 * @param {number} at
 * @param {string} text
 */
export const holdsEnvironment = (lines, at, text) =>
  inParagraph(lines, at, lines[at].start, at, text) !== null;

/**
 * A run opening a line at a block start. An environment in paragraph text is
 * `texEnvironmentInParagraph`'s.
 *
 * @type {Recognizer}
 */
export const texBlock = {
  name: 'tex-block',
  interruptsParagraph: false,
  match(lines, at, { text }) {
    const end = runEnd(lines, { k: at, i: 0 });
    return end === null ? null : raw(lines, at, lines[at].start, end, text);
  },
};

/**
 * An environment in paragraph text.
 *
 * @type {Recognizer}
 */
export const texEnvironmentInParagraph = {
  name: 'tex-environment-in-paragraph',
  interruptsParagraph: true,
  opensAhead: (text) => text.includes(BEGIN_PREFIX),
  match(lines, at, { paragraph, text }) {
    return paragraph === null
      ? inParagraph(lines, at, lines[at].start, at, text)
      : inParagraph(lines, at - paragraph.lines, paragraph.start, at, text);
  },
};
