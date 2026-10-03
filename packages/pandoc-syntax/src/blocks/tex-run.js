// A run of raw TeX, which Pandoc reads as one block: environments, block
// commands and definitions, whitespace and one line break at most between
// them.
//
// A place is a line of `lines` and a character of that line's text.

import { BLANK } from '../lines.js';
import { BEGIN, environmentEnd } from '../tex.js';
import { blockArgumentsEnd, groupEnd, pastSpaces } from '../tex-arguments.js';
import {
  ALSO_INLINE,
  BLOCK_COMMANDS,
  COLORED,
  DEFINITIONS,
  DEFS,
  INLINE_COMMANDS,
  INLINE_ENVIRONMENTS,
} from '../tex-names.js';

/** @typedef {import('../types.js').Line} Line */
/** @typedef {{k: number, i: number}} Place */

const OPENS_ENVIRONMENT = new RegExp(BEGIN, 'y');
const COMMAND = /\\([A-Za-z]+)\*?/y;
const ENDS_PARAGRAPH = new RegExp(
  `\\\\(?:${[...BLOCK_COMMANDS, ...COLORED].filter((name) => !ALSO_INLINE.has(name)).join('|')})(?![A-Za-z])`,
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

const textAt = (lines, p) => lines[p.k].text;

// The command at `p`: its name, and the place after it.
function commandAt(lines, p) {
  COMMAND.lastIndex = p.i;
  const name = COMMAND.exec(textAt(lines, p))?.[1];
  return name === undefined
    ? null
    : { name, end: { k: p.k, i: COMMAND.lastIndex } };
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

// The text from `p` on, a line at a time.
function* textFrom(lines, p) {
  const line = lines[p.k];
  yield { text: line.text.slice(p.i), start: line.start + p.i };
  for (let k = p.k + 1; k < lines.length; k++) yield lines[k];
}

// `end` moved back over the whitespace before it, to no earlier than `from`.
// A piece's parse can read whitespace past its last line, blank lines too, and
// the run goes on from there; the raw text stops short of it.
function trimmed(lines, from, end) {
  let { k, i } = end;
  while (k > from.k || i > from.i) {
    if (i === 0) {
      k--;
      i = lines[k].text.length;
    } else if (/[ \t]/.test(lines[k].text[i - 1])) i--;
    else break;
  }
  return { k, i };
}

// Past the piece of raw TeX at `p`, or null when none opens there.
function pieceEnd(lines, p) {
  OPENS_ENVIRONMENT.lastIndex = p.i;
  const name = OPENS_ENVIRONMENT.exec(textAt(lines, p))?.[1];
  if (INLINE_ENVIRONMENTS.has(name)) return null;
  if (name !== undefined) {
    const close = environmentEnd(name, textFrom(lines, p));
    if (close === null) return null;
    // Pandoc skips everything after the document.
    if (name === 'document')
      return { k: lines.length - 1, i: lines.at(-1).text.length };
    const k = p.k + close.chunk;
    return { k, i: close.end - lines[k].start };
  }
  const command = commandAt(lines, p);
  if (command !== null && COLORED.has(command.name)) {
    const named = { k: p.k, i: p.i + 1 + command.name.length };
    return blockArgumentsEnd(lines, command.name, named);
  }
  if (command === null || !opensPiece(command)) return null;
  if (DEFINITIONS.has(command.name)) return definitionEnd(lines, command);
  if (BLOCK_COMMANDS.has(command.name)) {
    const named = { k: p.k, i: p.i + 1 + command.name.length };
    return blockArgumentsEnd(lines, command.name, named);
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
    if (next === null) return trimmed(lines, p, end);
    end = next;
  }
}
