// A run of raw TeX, which Pandoc reads as one block: environments, block
// commands and definitions, whitespace and one line break at most between
// them.
//
// A place is a line of `lines` and a character of that line's text.

import { BLANK } from '../lines.js';
import { BEGIN, environmentEnd } from '../tex.js';
import {
  ALSO_INLINE,
  BLOCK_COMMANDS,
  DEFINITIONS,
  DEFS,
  INLINE_COMMANDS,
  INTERLEAVED,
  REQUIRED_GROUPS,
  SECTIONING,
} from '../tex-names.js';

/** @typedef {import('../types.js').Line} Line */
/** @typedef {{k: number, i: number}} Place */

const OPENS_ENVIRONMENT = new RegExp(BEGIN, 'y');
const COMMAND = /\\([A-Za-z]+)\*?/y;
const ENDS_PARAGRAPH = new RegExp(
  `\\\\(?:${[...BLOCK_COMMANDS].filter((name) => !ALSO_INLINE.has(name)).join('|')})(?![A-Za-z])`,
);
const ENDS_PARAGRAPH_AT = new RegExp(ENDS_PARAGRAPH.source, 'y');

/**
 * Whether a command in `text` may end the paragraph it sits in: a block
 * command Pandoc does not read inline. With `at`, one at that offset.
 *
 * @param {string} text
 * @param {number} [at]
 */
export function endsParagraph(text, at) {
  if (at === undefined) return ENDS_PARAGRAPH.test(text);
  ENDS_PARAGRAPH_AT.lastIndex = at;
  return ENDS_PARAGRAPH_AT.test(text);
}

const SPACES = /[ \t]*/y;

const textAt = (lines, p) => lines[p.k].text;

/** @returns {Place} */
function pastSpaces(lines, p) {
  SPACES.lastIndex = p.i;
  SPACES.exec(textAt(lines, p));
  return { k: p.k, i: SPACES.lastIndex };
}

// The command at `p`: its name, and the place after it.
function commandAt(lines, p) {
  COMMAND.lastIndex = p.i;
  const name = COMMAND.exec(textAt(lines, p))?.[1];
  return name === undefined
    ? null
    : { name, end: { k: p.k, i: COMMAND.lastIndex } };
}

// Past the group `open` opens at `p`, across lines, blank ones included, or
// null when it never closes. A backslash escapes the character after it, and
// a `%` comment hides the rest of its line.
function groupEnd(lines, p, open, close) {
  let depth = 0;
  for (let k = p.k, i = p.i; k < lines.length; k++, i = 0) {
    const { text } = lines[k];
    for (; i < text.length && text[i] !== '%'; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return { k, i: i + 1 };
    }
  }
  return null;
}

const OPTION = ['[', ']'];
const GROUP = ['{', '}'];

// The options, then the groups, a command takes from `p`, each after spaces
// on its line; with `interleaved`, the two in any order. Past them, and how
// many groups.
function argumentsOf(lines, p, interleaved = false) {
  const runs = interleaved ? [[OPTION, GROUP]] : [[OPTION], [GROUP]];
  let [end, groups] = [p, 0];
  for (const kinds of runs) {
    for (;;) {
      const at = pastSpaces(lines, end);
      const kind = kinds.find(([open]) => textAt(lines, at)[at.i] === open);
      const past = kind === undefined ? null : groupEnd(lines, at, ...kind);
      if (past === null) break;
      if (kind === GROUP) groups++;
      end = past;
    }
  }
  return { end, groups };
}

const argumentsEnd = (lines, p, interleaved) =>
  argumentsOf(lines, p, interleaved).end;

// cspell:ignore newif
// Past the definition `command` opens, or null when it defines nothing.
function definitionEnd(lines, command) {
  const { name, end } = command;
  const target = commandAt(lines, pastSpaces(lines, end));
  if (name === 'global') {
    return target !== null && DEFINITIONS.has(target.name)
      ? definitionEnd(lines, target)
      : null;
  }
  if (name === 'newif') return target?.end ?? null;
  if (target === null) return argumentsEnd(lines, end, true);
  if (name === 'let') {
    let at = pastSpaces(lines, target.end);
    if (textAt(lines, at)[at.i] === '=') {
      at = pastSpaces(lines, { k: at.k, i: at.i + 1 });
    }
    const value = commandAt(lines, at);
    if (value !== null) return value.end;
    return at.i < textAt(lines, at).length ? { k: at.k, i: at.i + 1 } : null;
  }
  if (DEFS.has(name)) {
    const body = textAt(lines, target.end).indexOf('{', target.end.i);
    return body === -1
      ? null
      : groupEnd(lines, { ...target.end, i: body }, ...GROUP);
  }
  return argumentsEnd(lines, target.end, true);
}

// Past `command`, one Pandoc does not know, and the commands straight after
// it, or null when more than spaces follow on the line. Spaces after a bare
// command belong to it, as TeX reads them; after an argument they end it.
function unknownEnd(lines, command) {
  let end = command.end;
  for (let next = command; next !== null; ) {
    end = argumentsEnd(lines, next.end);
    const at = end === next.end ? pastSpaces(lines, end) : end;
    next = commandAt(lines, at);
    if (next !== null && !opensPiece(next)) next = null;
  }
  return BLANK.test(textAt(lines, end).slice(end.i)) ? end : null;
}

const opensPiece = ({ name }) =>
  name !== 'begin' && name !== 'end' && !INLINE_COMMANDS.has(name);

// Past the whitespace from `p` on, as TeX reads it: spaces, comments and line
// breaks, blank lines among them.
/** @returns {Place} */
function pastWhitespace(lines, p) {
  for (let { k, i } = p; k < lines.length; k++, i = 0) {
    const at = pastSpaces(lines, { k, i });
    if (at.i < lines[k].text.length && lines[k].text[at.i] !== '%') return at;
  }
  return { k: lines.length - 1, i: lines.at(-1).text.length };
}

const LABEL = /\\label(?![A-Za-z])/y;

// Past the label a sectioning command takes from `p`, or null when none
// follows.
function labelEnd(lines, p) {
  const at = pastWhitespace(lines, p);
  LABEL.lastIndex = at.i;
  if (!LABEL.test(textAt(lines, at))) return null;
  const group = pastWhitespace(lines, { k: at.k, i: LABEL.lastIndex });
  return textAt(lines, group)[group.i] === '{'
    ? groupEnd(lines, group, ...GROUP)
    : null;
}

// The text from `p` on, a line at a time.
function* textFrom(lines, p) {
  const line = lines[p.k];
  yield { text: line.text.slice(p.i), start: line.start + p.i };
  for (let k = p.k + 1; k < lines.length; k++) yield lines[k];
}

// Past the piece of raw TeX at `p`, or null when none opens there.
function pieceEnd(lines, p) {
  OPENS_ENVIRONMENT.lastIndex = p.i;
  const name = OPENS_ENVIRONMENT.exec(textAt(lines, p))?.[1];
  if (name !== undefined) {
    const close = environmentEnd(name, textFrom(lines, p));
    if (close === null) return null;
    const k = p.k + close.chunk;
    return { k, i: close.end - lines[k].start };
  }
  const command = commandAt(lines, p);
  if (command === null || !opensPiece(command)) return null;
  if (DEFINITIONS.has(command.name)) return definitionEnd(lines, command);
  if (BLOCK_COMMANDS.has(command.name)) {
    const end = argumentsEnd(lines, command.end, INTERLEAVED.has(command.name));
    return SECTIONING.has(command.name) ? (labelEnd(lines, end) ?? end) : end;
  }
  return unknownEnd(lines, command);
}

/**
 * Past the whitespace after a piece: spaces, and a line break before a line
 * that is not blank, with that line's indentation.
 *
 * @param {Line[]} lines
 * @param {Place} p
 * @returns {Place}
 */
export function gapEnd(lines, p) {
  const at = pastSpaces(lines, p);
  const next = lines[at.k + 1];
  if (at.i < textAt(lines, at).length || next === undefined) return at;
  return BLANK.test(next.text) ? at : pastSpaces(lines, { k: at.k + 1, i: 0 });
}

/**
 * Where the run of raw TeX ending a paragraph at `p` ends, or null when none
 * does: a block command there needs its groups.
 *
 * @param {Line[]} lines
 * @param {Place} p
 * @returns {Place | null}
 */
export function paragraphRunEnd(lines, p) {
  const command = commandAt(lines, p);
  if (command !== null && command.name !== 'begin') {
    const { groups } = argumentsOf(
      lines,
      command.end,
      INTERLEAVED.has(command.name),
    );
    if (groups < (REQUIRED_GROUPS.get(command.name) ?? 0)) return null;
  }
  return runEnd(lines, p);
}

/**
 * Where the run of raw TeX opening at `p` ends, or null when none opens there.
 *
 * @param {Line[]} lines
 * @param {Place} p
 * @returns {Place | null}
 */
export function runEnd(lines, p) {
  let end = pieceEnd(lines, p);
  if (end === null) return null;
  for (;;) {
    const next = pieceEnd(lines, gapEnd(lines, end));
    if (next === null) return end;
    end = next;
  }
}
