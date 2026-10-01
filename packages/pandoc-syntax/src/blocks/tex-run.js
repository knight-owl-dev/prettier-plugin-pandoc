// A run of raw TeX, which Pandoc reads as one block: environments, block
// commands and definitions, whitespace and one line break at most between
// them.
//
// A place is a line of `lines` and a character of that line's text.

import { BLANK } from '../lines.js';
import { BEGIN, environmentEnd } from '../tex.js';

/** @typedef {import('../types.js').Line} Line */
/** @typedef {{k: number, i: number}} Place */

// cspell:disable
// Pandoc 3.11's block commands: its LaTeX reader's `blockCommands` and
// `treatAsBlock`. Pandoc reads some of their arguments by a rule of the
// command's own; here each takes options, then groups, but `INTERLEAVED`.
const BLOCK_COMMANDS = new Set([
  'addbibresource',
  'addcontentsline',
  'address',
  'addtocontents',
  'addtocounter',
  'author',
  'bibliography',
  'bibliographystyle',
  'blockcquote',
  'blockquote',
  'caption',
  'centerline',
  'chapter',
  'clearpage',
  'closing',
  'date',
  'dedication',
  'documentclass',
  'endinput',
  'epigraph',
  'extratitle',
  'fancybreak',
  'foreignblockcquote',
  'foreignblockquote',
  'framesubtitle',
  'frametitle',
  'frontispiece',
  'graphicspath',
  'hrule',
  'hspace',
  'hyperdef',
  'hypertarget',
  'hyphenblockcquote',
  'hyphenblockquote',
  'iftoggle',
  'ignore',
  'include',
  'input',
  'inputminted',
  'item',
  'listoffigures',
  'listoftables',
  'lowertitleback',
  'lstinputlisting',
  'makeglossary',
  'makeindex',
  'maketitle',
  'markboth',
  'markleft',
  'markright',
  'minisec',
  'newpage',
  'newtheorem',
  'newtoggle',
  'opening',
  'PackageError',
  'pagebreak',
  'par',
  'paragraph',
  'parbox',
  'part',
  'pdfannot',
  'pdfstringdef',
  'pfbreak',
  'plainbreak',
  'plainfancybreak',
  'publishers',
  'raggedright',
  'rule',
  'section',
  'setdefaultlanguage',
  'setmainlanguage',
  'signature',
  'special',
  'strut',
  'subfile',
  'subject',
  'subparagraph',
  'subsection',
  'subsubsection',
  'subtitle',
  'theoremstyle',
  'title',
  'titleformat',
  'titlehead',
  'togglefalse',
  'toggletrue',
  'uppertitleback',
  'usepackage',
  'vspace',
  'write',
]);

// Those whose own parser takes options among their groups.
const INTERLEAVED = new Set([
  'foreignblockcquote',
  'foreignblockquote',
  'hyphenblockcquote',
  'hyphenblockquote',
  'newtheorem',
  'titleformat',
]);

// In Pandoc's block map, but its parser for them reads inline text.
const INLINE_COMMANDS = new Set(['colorbox', 'textcolor']);

// Block commands Pandoc reads inline in paragraph text: its `treatAsInline`,
// and those in its inline map.
const ALSO_INLINE = new Set([
  'clearpage',
  'hspace',
  'hypertarget',
  'iftoggle',
  'input',
  'newpage',
  'newtoggle',
  'pagebreak',
  'togglefalse',
  'toggletrue',
  'vspace',
]);

// Definitions, which name what they define before their arguments.
const DEFINITIONS = new Set([
  'DeclareMathOperator',
  'DeclareRobustCommand',
  'def',
  'edef',
  'gdef',
  'global',
  'let',
  'newcommand',
  'newenvironment',
  'newif',
  'providecommand',
  'provideenvironment',
  'renewcommand',
  'renewenvironment',
  'xdef',
]);

// Those whose parameters run up to the body's group.
const DEFS = new Set(['def', 'edef', 'gdef', 'xdef']);
// cspell:enable

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

// Past the options, then the groups, a command takes from `p`, each after
// spaces on its line; with `interleaved`, the two in any order.
function argumentsEnd(lines, p, interleaved = false) {
  const runs = interleaved ? [[OPTION, GROUP]] : [[OPTION], [GROUP]];
  let end = p;
  for (const kinds of runs) {
    for (;;) {
      const at = pastSpaces(lines, end);
      const kind = kinds.find(([open]) => textAt(lines, at)[at.i] === open);
      const past = kind === undefined ? null : groupEnd(lines, at, ...kind);
      if (past === null) break;
      end = past;
    }
  }
  return end;
}

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
    return argumentsEnd(lines, command.end, INTERLEAVED.has(command.name));
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
    if (next === null) return end;
    end = next;
  }
}
