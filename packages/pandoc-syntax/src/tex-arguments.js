// How far a block command reads: Pandoc's LaTeX reader parses each by a rule
// of its own, and its raw block holds what that parse consumed. The parsers
// below are Pandoc 3.11's, composed of its primitives as its source composes
// them, over places in lines.
//
// A place is a line of `lines` and a character of that line's text. Each
// parser takes the place it starts at and returns the place past what it
// read, or null where Pandoc's fails.

// cspell:disable

import { BLANK } from './lines.js';
import {
  ALSO_INLINE,
  BLOCK_COMMANDS,
  COLORED,
  INLINE_ENVIRONMENTS,
} from './tex-names.js';

/** @typedef {import('./types.js').Line} Line */
/** @typedef {{k: number, i: number}} Place */
/** @typedef {(lines: Line[], p: Place) => Place | null} Parser */

const textAt = (lines, p) => lines[p.k].text;
const charAt = (lines, p) => textAt(lines, p)[p.i];
const atLineEnd = (lines, p) => p.i >= textAt(lines, p).length;
const nextLine = (p) => ({ k: p.k + 1, i: 0 });

const SPACES = /[ \t]*/y;

/** @returns {Place} */
export function pastSpaces(lines, p) {
  SPACES.lastIndex = p.i;
  SPACES.exec(textAt(lines, p));
  return { k: p.k, i: SPACES.lastIndex };
}

// Spaces and comments on the line: a comment runs to the line's end.
function pastSpacesAndComments(lines, p) {
  const at = pastSpaces(lines, p);
  return charAt(lines, at) === '%'
    ? { k: at.k, i: textAt(lines, at).length }
    : at;
}

// Pandoc's `sp`: spaces and comments, and one line break with those after it,
// where a line that is not blank follows.
/** @type {(lines: Line[], p: Place) => Place} */
function sp(lines, p) {
  const at = pastSpacesAndComments(lines, p);
  const next = lines[at.k + 1];
  if (!atLineEnd(lines, at) || next === undefined || BLANK.test(next.text)) {
    return at;
  }
  return pastSpacesAndComments(lines, nextLine(at));
}

/**
 * Pandoc's `spaces`: spaces, comments and line breaks, blank lines among them.
 *
 * @param {Line[]} lines
 * @param {Place} p
 * @returns {Place}
 */
function pastWhitespace(lines, p) {
  for (let { k, i } = p; k < lines.length; k++, i = 0) {
    const at = pastSpaces(lines, { k, i });
    if (at.i < lines[k].text.length && lines[k].text[at.i] !== '%') return at;
  }
  return { k: lines.length - 1, i: lines.at(-1).text.length };
}

/**
 * Past the group `open` opens at `p`, across lines, blank ones included, or
 * null when it never closes. A backslash escapes the character after it, and
 * a `%` comment hides the rest of its line.
 *
 * @param {Line[]} lines
 * @param {Place} p
 * @param {string} open
 * @param {string} close
 * @returns {Place | null}
 */
export function groupEnd(lines, p, open, close) {
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

// Pandoc's `braced`: a group opening right at `p`.
/** @type {Parser} */
const braced = (lines, p) =>
  charAt(lines, p) === '{' ? groupEnd(lines, p, '{', '}') : null;

// Pandoc's `grouped`: a group after `sp`.
/** @type {Parser} */
const grouped = (lines, p) => braced(lines, sp(lines, p));

const INLINE_NAMES = [...INLINE_ENVIRONMENTS]
  .map((name) => name.replace('*', '\\*'))
  .join('|');
const END = new RegExp(
  `\\\\end(?![A-Za-z])(?![ \\t]*\\{(?:${INLINE_NAMES})\\})`,
);

// A group right at `p` Pandoc reads as inline text: no blank line in it, and no
// `\end`.
/** @type {Parser} */
function inlineGroup(lines, p) {
  const past = braced(lines, p);
  if (past === null) return null;
  for (let k = p.k; k <= past.k; k++) {
    const { text } = lines[k];
    if (k > p.k && k < past.k && BLANK.test(text)) return null;
    const from = k === p.k ? p.i : 0;
    const to = k === past.k ? past.i : text.length;
    if (END.test(text.slice(from, to).replace(/(?<!\\)%.*/, ''))) return null;
  }
  return past;
}

// `grouped inline`: such a group after `sp`.
/** @type {Parser} */
const groupedInline = (lines, p) => inlineGroup(lines, sp(lines, p));

// Pandoc's `bracketedToks`: `[` right at `p`, through the first `]` outside a
// group.
/** @type {Parser} */
function bracketed(lines, p) {
  if (charAt(lines, p) !== '[') return null;
  let at = { k: p.k, i: p.i + 1 };
  while (at !== null && at.k < lines.length) {
    const char = charAt(lines, at);
    if (char === undefined || char === '%')
      at = at.k + 1 < lines.length ? nextLine(at) : null;
    else if (char === ']') return { k: at.k, i: at.i + 1 };
    else if (char === '{') at = groupEnd(lines, at, '{', '}');
    else at = { k: at.k, i: at.i + (char === '\\' ? 2 : 1) };
  }
  return null;
}

// Pandoc's `opt`, `rawopt` and the options of a citation: one after `sp`,
// with `sp` after it.
/** @type {Parser} */
function option(lines, p) {
  const past = bracketed(lines, sp(lines, p));
  return past === null ? null : sp(lines, past);
}

const KEY = /[A-Za-z0-9_-]+/y;

// One of Pandoc's `keyval`s: a key of word characters, `-` and `_`, and a value
// after `=`: a group, or text up to a `]` or `,`.
/** @type {Parser} */
function keyval(lines, p) {
  let at = sp(lines, p);
  KEY.lastIndex = at.i;
  if (!KEY.test(textAt(lines, at))) return null;
  at = sp(lines, { k: at.k, i: KEY.lastIndex });
  if (charAt(lines, at) === '=') {
    at = sp(lines, { k: at.k, i: at.i + 1 });
    const start = at;
    for (;;) {
      const char = charAt(lines, at);
      if (char === undefined) {
        if (at.k + 1 >= lines.length) return null;
        at = nextLine(at);
      } else if (char === ']' || char === ',') break;
      else if (char === '}') return null;
      else if (char === '{') at = braced(lines, at);
      else if (char === '%') at = { k: at.k, i: textAt(lines, at).length };
      else at = command(lines, at) ?? { k: at.k, i: at.i + 1 };
      if (at === null) return null;
    }
    if (at.k === start.k && at.i === start.i) return null;
  }
  at = sp(lines, at);
  return charAt(lines, at) === ',' ? { k: at.k, i: at.i + 1 } : at;
}

// Pandoc's `keyvals`: `[`, key-value pairs, `]` right at `p`, `sp` after.
/** @type {Parser} */
function keyvals(lines, p) {
  if (charAt(lines, p) !== '[') return null;
  let at = { k: p.k, i: p.i + 1 };
  while (charAt(lines, at) !== ']') {
    at = keyval(lines, at);
    if (at === null) return null;
  }
  return sp(lines, { k: at.k, i: at.i + 1 });
}

const OVERLAY = /<([A-Za-z0-9 \t\-+@|:,]*)>/y;
const OVERLAY_WORDS = new Set([
  'beamer',
  'presentation',
  'trans',
  'handout',
  'article',
  'second',
]);

// A beamer overlay specification right at `p`: `<2->`.
/** @type {Parser} */
function overlay(lines, p) {
  OVERLAY.lastIndex = p.i;
  const inner = OVERLAY.exec(textAt(lines, p))?.[1];
  if (inner === undefined) return null;
  if (/^[A-Za-z]*$/.test(inner) && !OVERLAY_WORDS.has(inner)) return null;
  return { k: p.k, i: OVERLAY.lastIndex };
}

// Each parser in turn, from where the last ended; null when one fails.
const seq =
  (...parsers) =>
  (lines, p) => {
    let at = p;
    for (const parser of parsers) {
      at = parser(lines, at);
      if (at === null) return null;
    }
    return at;
  };

// The first parser that succeeds.
const either =
  (...parsers) =>
  (lines, p) => {
    for (const parser of parsers) {
      const past = parser(lines, p);
      if (past !== null) return past;
    }
    return null;
  };

const maybe = (parser) => (lines, p) => parser(lines, p) ?? p;

const many = (parser) => (lines, p) => {
  let at = p;
  for (let past = parser(lines, at); past !== null; past = parser(lines, at)) {
    if (past.k === at.k && past.i === at.i) return at;
    at = past;
  }
  return at;
};

const times = (n, parser) => seq(...Array.from({ length: n }, () => parser));

// Pandoc's `skipopts`.
const skipopts = many(either(overlay, option));

const COMMAND = /\\(?:[A-Za-z]+[ \t]*|[^A-Za-z])/y;

// A command right at `p`, the spaces after a name with it, as Pandoc's
// tokenizer reads one.
/** @type {Parser} */
function command(lines, p) {
  COMMAND.lastIndex = p.i;
  return COMMAND.test(textAt(lines, p))
    ? { k: p.k, i: COMMAND.lastIndex }
    : null;
}

const DIMENSION = /=?-?(?:\d[A-Za-z0-9]*)?(?:\.[A-Za-z0-9]+)?/y;
const UNITS = new Set([
  '',
  'pt',
  'pc',
  'in',
  'bp',
  'cm',
  'mm',
  'dd',
  'cc',
  'sp',
  'ex',
  'em',
  'mu',
  'px',
]);

// Pandoc's `dimenarg`: `sp`, then a number and a unit.
/** @type {Parser} */
function dimension(lines, p) {
  const at = sp(lines, p);
  DIMENSION.lastIndex = at.i;
  const match = DIMENSION.exec(textAt(lines, at))?.[0];
  if (match === undefined) return null;
  const value = match.replace(/^=?-?/, '');
  const unit = value.replace(/^[\d.]*/, '');
  if (unit.length === value.length || !UNITS.has(unit)) return null;
  return { k: at.k, i: DIMENSION.lastIndex };
}

// What Pandoc's `getRawCommand` reads after most commands: options, a
// dimension, and the groups straight after.
const rawArguments = seq(skipopts, maybe(dimension), many(braced));

const NAME = /\\([A-Za-z]+)/y;

// Pandoc's `inlineCommand'`: a command, not a block one, its star and overlay,
// and its arguments as `getRawCommand` reads them. Pandoc reads a known inline
// command by its own rule, which for most is that one.
/** @type {Parser} */
function inlineCommand(lines, p) {
  NAME.lastIndex = p.i;
  const name = NAME.exec(textAt(lines, p))?.[1];
  if (name === 'begin' || name === 'end' || name === 'and') return null;
  if (BLOCK_COMMANDS.has(name) && !ALSO_INLINE.has(name)) return null;
  const named = command(lines, p);
  if (named === null) return null;
  const starred = name === undefined ? named : star(lines, named);
  return rawArguments(lines, maybe(overlay)(lines, starred));
}

const SPECIAL = new Set('#$%&~_^\\{}');

// Pandoc's `tok`: after `spaces`, a group, a command, or one character.
/** @type {Parser} */
function tok(lines, p) {
  const at = pastWhitespace(lines, p);
  const char = charAt(lines, at);
  if (char === undefined) return null;
  if (char === '{') return inlineGroup(lines, at);
  if (char === '\\') return inlineCommand(lines, at);
  return SPECIAL.has(char) ? null : { k: at.k, i: at.i + 1 };
}

// Pandoc's `anyTok`: a word, a command, or one character, a line break among
// them.
/** @type {Parser} */
function anyToken(lines, p) {
  if (atLineEnd(lines, p)) return p.k + 1 < lines.length ? nextLine(p) : null;
  if (charAt(lines, p) === '\\') return command(lines, p);
  const word = /[A-Za-z0-9]+|[ \t]+|./y;
  word.lastIndex = p.i;
  word.exec(textAt(lines, p));
  return { k: p.k, i: word.lastIndex };
}

const LABEL = /\\label[ \t]*/y;

// A label after `spaces`: `\label`, `spaces`, a group.
/** @type {Parser} */
function label(lines, p) {
  const at = pastWhitespace(lines, p);
  LABEL.lastIndex = at.i;
  if (!LABEL.test(textAt(lines, at))) return null;
  return braced(lines, pastWhitespace(lines, { k: at.k, i: LABEL.lastIndex }));
}

const PUNCTUATION = new Set('.:;?!');

// csquotes' block quotes: options, the quote, punctuation after it.
const quote = seq(
  maybe(bracketed),
  grouped,
  maybe((lines, p) =>
    PUNCTUATION.has(charAt(lines, p)) ? { k: p.k, i: p.i + 1 } : null,
  ),
);
const blockquote = seq(maybe(bracketed), quote);
const KEY_LABEL = /[\p{L}\p{N}.:;?!`'()/*@_+=\-&[\]]+/uy;

// The keys of a citation: a group of words and BibTeX key characters, each key
// with `sp` around it and a comma after it.
/** @type {Parser} */
function citationKeys(lines, p) {
  let at = sp(lines, p);
  if (charAt(lines, at) !== '{') return null;
  at = { k: at.k, i: at.i + 1 };
  while (charAt(lines, at) !== '}') {
    at = sp(lines, at);
    KEY_LABEL.lastIndex = at.i;
    if (!KEY_LABEL.test(textAt(lines, at))) return null;
    at = sp(lines, { k: at.k, i: KEY_LABEL.lastIndex });
    if (charAt(lines, at) === ',') at = sp(lines, { k: at.k, i: at.i + 1 });
  }
  return { k: at.k, i: at.i + 1 };
}

const blockcquote = seq(maybe(option), maybe(option), citationKeys, quote);

const sectioning = seq(skipopts, groupedInline, maybe(label));
const meta = seq(skipopts, tok);
const include = either(seq(many(option), braced), rawArguments);

// Pandoc's LaTeX `block`, as far as a raw block holds it: text or a group
// opens a paragraph, to a blank line; whitespace and commands are the run's.
/** @type {Parser} */
function block(lines, p) {
  const char = charAt(lines, p);
  if (char === undefined || /[ \t%\\]/.test(char)) return p;
  let k = p.k;
  while (k + 1 < lines.length && !BLANK.test(lines[k + 1].text)) k++;
  return { k, i: lines[k].text.length };
}

// `\documentclass` reads the preamble; `\endinput` the rest of the file.
/** @type {Parser} */
function toDocument(lines, p) {
  const BEGIN_DOCUMENT = /\\begin[ \t]*\{document\}/y;
  let at = p;
  while (at !== null) {
    const char = charAt(lines, at);
    if (char === undefined || char === '%') {
      if (at.k + 1 >= lines.length) break;
      at = nextLine(at);
    } else if (char === '{') {
      at = braced(lines, at) ?? { k: at.k, i: at.i + 1 };
    } else if (char === '\\') {
      BEGIN_DOCUMENT.lastIndex = at.i;
      if (BEGIN_DOCUMENT.test(textAt(lines, at))) return at;
      at = command(lines, at);
    } else at = { k: at.k, i: at.i + 1 };
  }
  return toEnd(lines);
}
const toEnd = (lines) => ({ k: lines.length - 1, i: lines.at(-1).text.length });

// A star, and `sp` after it, as Pandoc reads one after any block command.
/** @type {Parser} */
const star = (lines, p) =>
  charAt(lines, p) === '*' ? sp(lines, { k: p.k, i: p.i + 1 }) : p;

/** @type {Map<string, Parser>} */
const PARSERS = new Map([
  ...[
    'chapter',
    'framesubtitle',
    'frametitle',
    'minisec',
    'paragraph',
    'part',
    'section',
    'subparagraph',
    'subsection',
    'subsubsection',
  ].map((name) => [name, sectioning]),
  ...[
    'address',
    'centerline',
    'closing',
    'date',
    'dedication',
    'extratitle',
    'frontispiece',
    'lowertitleback',
    'opening',
    'publishers',
    'subject',
    'subtitle',
    'titlehead',
    'uppertitleback',
  ].map((name) => [name, meta]),
  ...['author', 'signature'].map((name) => [name, seq(skipopts, grouped)]),
  ['title', seq(skipopts, grouped)],
  ['caption', seq(maybe(bracketed), tok, maybe(label))],
  ['par', skipopts],
  ['item', skipopts],
  ...['hrule', 'pfbreak', 'raggedright', 'strut'].map((name) => [
    name,
    (_, p) => p,
  ]),
  ['rule', seq(skipopts, tok, tok)],
  ['parbox', seq(skipopts, braced, grouped)],
  ['epigraph', seq(grouped, grouped)],
  ['blockquote', blockquote],
  ['blockcquote', blockcquote],
  ...['foreignblockquote', 'hyphenblockquote'].map((name) => [
    name,
    seq(braced, blockquote),
  ]),
  ...['foreignblockcquote', 'hyphenblockcquote'].map((name) => [
    name,
    seq(braced, blockcquote),
  ]),
  [
    'newtheorem',
    seq(
      star,
      braced,
      sp,
      maybe(bracketed),
      sp,
      either(braced, anyToken),
      sp,
      maybe(bracketed),
    ),
  ],
  ...[
    'fancybreak',
    'newtoggle',
    'plainbreak',
    'theoremstyle',
    'togglefalse',
    'toggletrue',
  ].map((name) => [name, braced]),
  ...['plainfancybreak', 'PackageError'].map((name) => [
    name,
    times(3, braced),
  ]),
  ...['addbibresource', 'bibliography'].map((name) => [
    name,
    seq(skipopts, braced),
  ]),
  ...['setdefaultlanguage', 'setmainlanguage'].map((name) => [
    name,
    seq(maybe(option), braced),
  ]),
  ['lstinputlisting', seq(maybe(keyvals), braced)],
  ['inputminted', seq(maybe(keyvals), braced, braced)],
  ['graphicspath', graphicsPath],
  ['hypertarget', seq(braced, grouped)],
  [
    'iftoggle',
    seq(braced, pastWhitespace, braced, pastWhitespace, braced, block),
  ],
  ...['include', 'input', 'subfile', 'usepackage'].map((name) => [
    name,
    include,
  ]),
  ['documentclass', seq(skipopts, braced, toDocument)],
  ['endinput', (lines) => toEnd(lines)],
  ['write', seq(digits, braced)],
  ['titleformat', seq(braced, skipopts, times(4, braced))],
  ...[...COLORED].map((name) => [name, coloredBlock]),
]);

const DIGITS = /\d*/y;

/** @type {Parser} */
function digits(lines, p) {
  DIGITS.lastIndex = p.i;
  DIGITS.exec(textAt(lines, p));
  return { k: p.k, i: DIGITS.lastIndex };
}

const BLOCK = new RegExp(
  `\\\\(?:begin[ \\t]*\\{(?!(?:${INLINE_NAMES})\\})|(?:${[...BLOCK_COMMANDS].filter((name) => !ALSO_INLINE.has(name)).join('|')})(?![A-Za-z]))`,
);

// Pandoc's `coloredBlock`: options, a color, and a group after `sp` that is no
// inline text: one holding a blank line, `\end`, a block command or an
// environment.
/** @type {Parser} */
function coloredBlock(lines, p) {
  const color = braced(lines, skipopts(lines, p));
  if (color === null) return null;
  const open = sp(lines, color);
  const past = braced(lines, open);
  if (past === null || inlineGroup(lines, open) === null) return past;
  for (let k = open.k; k <= past.k; k++) {
    const from = k === open.k ? open.i : 0;
    const to = k === past.k ? past.i : lines[k].text.length;
    const text = lines[k].text.slice(from, to).replace(/(?<!\\)%.*/, '');
    if (BLOCK.test(text)) return past;
  }
  return null;
}

// `\graphicspath`: a group of nothing but groups and whitespace.
/** @type {Parser} */
function graphicsPath(lines, p) {
  const open = sp(lines, p);
  if (charAt(lines, open) !== '{') return null;
  for (let at = pastWhitespace(lines, { k: open.k, i: open.i + 1 }); ; ) {
    if (charAt(lines, at) === '}') return { k: at.k, i: at.i + 1 };
    const past = braced(lines, at);
    if (past === null) return null;
    at = pastWhitespace(lines, past);
  }
}

/**
 * Past the arguments Pandoc reads after the block command `name`, from just
 * after its name; null where Pandoc's parse fails, and so reads no raw block.
 *
 * @param {Line[]} lines
 * @param {string} name
 * @param {Place} p
 * @returns {Place | null}
 */
export function blockArgumentsEnd(lines, name, p) {
  const parser = PARSERS.get(name) ?? rawArguments;
  return parser(lines, star(lines, pastSpaces(lines, p)));
}
