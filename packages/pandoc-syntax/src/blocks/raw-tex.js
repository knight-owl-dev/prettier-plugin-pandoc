// Raw TeX blocks: a run of environments and commands, `tex-run.js`. Each span
// covers exactly the characters Pandoc keeps raw. Pandoc reads blocks again
// past the whitespace after a run, mid-line or on the next line.
//
// In paragraph text, an environment or a block command Pandoc does not read
// inline ends the paragraph where it opens, unless balanced brackets or an
// argument Pandoc reads raw hold it.

// cspell:ignore vadjust

import {
  commandEnd,
  groupsAfter,
  startsCommand,
  verbatimCommandEnd,
} from '../command.js';
import { BLANK, closeOf, viewFrom } from '../lines.js';
import { COMMENT_CLOSE, COMMENT_OPEN, opaqueEnd } from '../opaque.js';
import { BEGIN } from '../tex.js';
import {
  COLORED,
  INLINE_ARGUMENTS,
  INLINE_COMMANDS,
  INLINE_ENVIRONMENTS,
  RAW_INLINE,
} from '../tex-names.js';
import { endsParagraph, gapEnd, runEnd } from './tex-run.js';

/** @typedef {import('../types.js').Recognizer} Recognizer */
/** @typedef {import('../types.js').Line} Line */
/** @typedef {import('../types.js').SpanSpec} SpanSpec */
/** @typedef {import('../types.js').Match} Match */

const OPENS_ENVIRONMENT = new RegExp(BEGIN, 'y');

const BEGIN_PREFIX = '\\begin{';

// Whether an environment Pandoc reads as a block opens at `at`: any but its
// inline ones.
function opensEnvironment(text, at) {
  OPENS_ENVIRONMENT.lastIndex = at;
  const name = OPENS_ENVIRONMENT.exec(text)?.[1];
  return name !== undefined && !INLINE_ENVIRONMENTS.has(name);
}

// Past what opens at `at` in inline text: an opaque construct, a command and
// its arguments, an escape, or a character. A `\begin` is only its own text:
// brackets balance through an environment.
function past(text, at) {
  const opaque = opaqueEnd(text, at);
  if (opaque > at) return opaque;
  if (text.startsWith(BEGIN_PREFIX, at)) return at + BEGIN_PREFIX.length;
  if (startsCommand(text, at)) {
    const verbatim = verbatimCommandEnd(text, at);
    if (verbatim !== null) return verbatim;
    NAME.lastIndex = at;
    const name = NAME.exec(text)[1];
    return INLINE_COMMANDS.has(name) && !RAW_INLINE.has(name)
      ? pastInline(text, at, name)
      : (commandEnd(text, at) ?? at + 2);
  }
  return at + (text[at] === '\\' ? 2 : 1);
}

const NAME = /\\([A-Za-z]+)/y;

// Whether a block opens between `from` and `to`, failing an inline argument;
// an environment does unless `environments` holds. A colored command fails
// one by its own argument, which the scan reaches.
function holdsBlock(text, from, to, environments) {
  for (let i = from; i < to; i = past(text, i)) {
    if (endsParagraph(text, i)) {
      NAME.lastIndex = i;
      if (!COLORED.has(NAME.exec(text)[1])) return true;
    }
    if (!environments && opensEnvironment(text, i)) return true;
  }
  return false;
}

// Past an inline command Pandoc knows: with its arguments where its parse
// takes them, only its name where a block in an argument it reads as inlines
// fails it, and the arguments are then paragraph text. One reading every
// argument as inlines is its name either way.
function pastInline(text, at, name) {
  if (memo.text !== text) memo = { text, ends: new Map() };
  let end = memo.ends.get(at);
  if (end === undefined) {
    end = commandArgumentsEnd(text, at, name);
    memo.ends.set(at, end);
  }
  return end;
}

// The ends `pastInline` found in the text it last read: a failed command is
// read again from every argument around it, nested ones exponentially often.
let memo = { text: '', ends: new Map() };

function commandArgumentsEnd(text, at, name) {
  const named = at + 1 + name.length;
  if (name === 'vadjust') {
    // Raw up to and through its first group.
    const open = text.indexOf('{', named);
    const [group] = open === -1 ? [] : groupsAfter(text, open, 1);
    return group?.end ?? named;
  }
  const kinds = INLINE_ARGUMENTS.get(name);
  if (kinds === undefined) return named;
  const groups = groupsAfter(text, named, kinds.length);
  const end = groups.at(-1)?.end ?? named;
  const fails =
    groups.some(
      (group, n) =>
        kinds[n] !== 'r' &&
        holdsBlock(text, group.start + 1, group.end - 1, kinds[n] === 'e'),
    ) || !takesMissing(text, end, kinds.slice(groups.length));
  return fails ? named : end;
}

// Whether the arguments of `kinds` a command lacks groups for are taken from
// `at` on: a raw one never is, one of inlines takes the next token, which a
// block cannot be.
function takesMissing(text, at, kinds) {
  if (kinds.length === 0) return true;
  if (kinds.includes('r')) return false;
  const next = text.slice(at).search(/\S/);
  if (next === -1) return false;
  return !endsParagraph(text, at + next) && !opensEnvironment(text, at + next);
}

// The offset past the parentheses opening at `at`, or null.
const parensEnd = (text, at) => closeOf(text, at, '(', ')', escaped);

// Past the character at `at`, and the one after a backslash.
const escaped = (text, at) => at + (text[at] === '\\' ? 2 : 1);

// The offset past the brackets opening at `at`, or null when they never close
// before `limit`.
function bracketsClose(text, at, limit = text.length) {
  const close = closeOf(text, at, '[', ']', past);
  return close !== null && close <= limit ? close : null;
}

// The offset past the brackets opening at `at`, a link destination after them
// included, or null when they never close. Brackets past `to`, in a link's
// text, hold nothing: a line there may open a block.
function bracketsEnd(text, at, to = text.length) {
  const close = bracketsClose(text, at, to);
  if (close === null) return null;
  return (text[close] === '(' && parensEnd(text, close)) || close;
}

/**
 * The offset past the command at `at` as Pandoc reads it in paragraph text:
 * one raw inline, its arguments with it, unless an argument it reads as
 * inlines holds a block, which fails it and leaves its name.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number}
 */
export function pastCommand(text, at) {
  const verbatim = verbatimCommandEnd(text, at);
  if (verbatim !== null) return verbatim;
  NAME.lastIndex = at;
  const name = NAME.exec(text)[1];
  if (!INLINE_COMMANDS.has(name) || RAW_INLINE.has(name)) {
    return commandEnd(text, at) ?? at + 2;
  }
  const named = at + 1 + name.length;
  const end = pastInline(text, at, name);
  if (end > named || INLINE_ARGUMENTS.has(name) || name === 'vadjust') {
    return end;
  }
  const whole = commandEnd(text, at) ?? named;
  return holdsBlock(text, named, whole, false) ? named : whole;
}

/**
 * The offset past what opens at `at` in inline text: brackets and a link
 * destination after them, a command and its arguments, an opaque construct,
 * an escape, or a character. Brackets whose text runs past `to` are only a
 * character.
 *
 * @param {string} text
 * @param {number} at
 * @param {number} [to]
 * @returns {number}
 */
export const pastInlines = (text, at, to) =>
  (text[at] === '[' && bracketsEnd(text, at, to)) || past(text, at);

// Whether raw TeX may end a paragraph somewhere in `text`.
const opensAhead = (text) => text.includes(BEGIN_PREFIX) || endsParagraph(text);

/**
 * The raw TeX ending the paragraph on line `at`: an environment or block
 * command, and the run after it. The paragraph is read from `start` on line
 * `from`.
 *
 * @param {Line[]} lines
 * @param {number} from
 * @param {number} start
 * @param {number} at
 * @returns {Match | null}
 */
function inParagraph(lines, from, start, at) {
  const line = lines[at];
  if (!opensAhead(line.text)) return null;
  // A comment holding a blank line keeps the paragraph open past it.
  const spansBlank = lines.slice(from, at).some((l) => BLANK.test(l.text));
  let view = viewFrom(lines, from, start, spansBlank);
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
    if (!opensEnvironment(view.text, i) && !endsParagraph(view.text, i)) {
      i = pastInlines(view.text, i);
      continue;
    }
    if (i >= lineStart) {
      const column = head + (i - lineStart);
      const end = runEnd(lines, { k: at, i: column });
      if (end !== null) return raw(lines, at, line.start + column, end);
    }
    i = past(view.text, i);
  }
  return null;
}

// The raw span from `start` on line `from` to the place `run` ends, and where
// blocks are read again.
/** @returns {Match} */
function raw(lines, from, start, run) {
  const [to, end] = [run.k, lines[run.k].start + run.i];
  /** @type {SpanSpec} */
  const span = { type: 'raw-tex', from, to, start, end };
  const at = gapEnd(lines, run);
  return at.i < lines[at.k].text.length
    ? { last: to, resume: lines[at.k].start + at.i, spans: [span] }
    : { last: to, spans: [span] };
}

/**
 * Whether line `at` holds raw TeX that would end a paragraph there.
 *
 * @param {Line[]} lines
 * @param {number} at
 */
export const holdsRaw = (lines, at) =>
  inParagraph(lines, at, lines[at].start, at) !== null;

/**
 * A run opening a line at a block start. One in paragraph text is
 * `texInParagraph`'s.
 *
 * @type {Recognizer}
 */
export const texBlock = {
  name: 'tex-block',
  interruptsParagraph: false,
  match(lines, at) {
    const end = runEnd(lines, { k: at, i: 0 });
    return end === null ? null : raw(lines, at, lines[at].start, end);
  },
};

/**
 * Raw TeX in paragraph text.
 *
 * @type {Recognizer}
 */
export const texInParagraph = {
  name: 'tex-in-paragraph',
  interruptsParagraph: true,
  opensAhead,
  match(lines, at, { paragraph }) {
    return paragraph === null
      ? inParagraph(lines, at, lines[at].start, at)
      : inParagraph(lines, at - paragraph.lines, paragraph.start, at);
  },
};
