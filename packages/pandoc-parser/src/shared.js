// Text and AST utilities Pandoc's readers share, and the `Data.Text`
// functions they call that JS strings lack.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Shared`.

import { Node } from './ast/nodes.js';
import { isAlpha, isAlphaNum, isSpace } from './char.js';
import { charWidth } from './text-width.js';

/** A non-breaking space, U+00A0: a formatter writes the escape as the character. */
export const NBSP = String.fromCodePoint(0xa0);

/**
 * `s` lowercased a code point at a time, as Haskell's `T.toLower`: unlike
 * `toLowerCase`, with no regard to context (a final sigma stays `σ`).
 *
 * @see Data.Text.toLower
 * @param {string} s
 */
export const toLower = (s) => [...s].map((c) => c.toLowerCase()).join('');

/**
 * The runs of `s` between its spaces, as GHC's `isSpace` has them.
 *
 * @see Data.Text.words
 * @param {string} s
 * @returns {string[]}
 */
export function words(s) {
  const out = [];
  let word = '';
  for (const c of s) {
    if (!isSpace(c)) word += c;
    else if (word !== '') {
      out.push(word);
      word = '';
    }
  }
  if (word !== '') out.push(word);
  return out;
}

/**
 * `s` without spaces, tabs or line breaks at either end.
 *
 * @see Text.Pandoc.Shared.trim
 * @param {string} s
 */
export const trim = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/**
 * Where `text` from `from` reaches display width `n`: the offset after
 * the characters it takes.
 *
 * @see Text.Pandoc.Shared.splitAtWidth
 * @param {number} n
 * @param {string} text
 * @param {number} from
 */
function splitAtWidth(n, text, from) {
  let [at, width] = [from, 0];
  while (width < n && at < text.length) {
    const c = String.fromCodePoint(text.codePointAt(at));
    width += charWidth(c);
    at += c.length;
  }
  return at;
}

/**
 * `text` split at display widths `indices`, each from the line's start:
 * each piece's `[start, end)`, one more than the indices.
 *
 * @see Text.Pandoc.Shared.splitTextByIndices
 * @param {number[]} indices
 * @param {string} text
 * @returns {[number, number][]}
 */
export function splitTextByIndices(indices, text) {
  const pieces = [];
  let [start, previous] = [0, 0];
  for (const index of indices) {
    const end = splitAtWidth(index - previous, text, start);
    pieces.push([start, end]);
    [start, previous] = [end, index];
  }
  pieces.push([start, text.length]);
  return pieces;
}

/**
 * Math text without spaces, tabs or line breaks at either end, but the
 * first after a backslash ending it: an escaped space.
 *
 * @see Text.Pandoc.Shared.trimMath
 * @param {string} s
 */
export function trimMath(s) {
  const isWS = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  let end = s.length;
  while (end > 0 && isWS(s[end - 1])) end--;
  if (end < s.length && s[end - 1] === '\\') end++;
  let start = 0;
  while (start < end && isWS(s[start])) start++;
  return s.slice(start, end);
}

/**
 * `s` without line breaks at its end.
 *
 * @see Text.Pandoc.Shared.stripTrailingNewlines
 * @param {string} s
 */
export const stripTrailingNewlines = (s) => s.replace(/\n+$/, '');

// The inlines a node holds, for those that hold any.
const childrenOf = (x) => {
  switch (x.t) {
    case 'Quoted':
    case 'Cite':
    case 'Link':
    case 'Image':
    case 'Span':
      return x.c[1];
    case 'Emph':
    case 'Underline':
    case 'Strong':
    case 'Strikeout':
    case 'Superscript':
    case 'Subscript':
    case 'SmallCaps':
      return x.c;
    default:
      return [];
  }
};

const QUOTES = {
  SingleQuote: ['‘', '’'],
  DoubleQuote: ['“', '”'],
};

// The text of one inline and all it holds.
function textOf(x) {
  switch (x.t) {
    case 'Str':
      return x.c;
    case 'Space':
    case 'SoftBreak':
    case 'LineBreak':
      return ' ';
    case 'Code':
    case 'Math':
      return x.c[1];
    case 'RawInline':
      return x.c[0].toLowerCase() === 'html' && x.c[1].startsWith('<br')
        ? ' '
        : '';
    case 'Quoted': {
      const [open, close] = QUOTES[x.c[0].t];
      return open + stringify(x.c[1]) + close;
    }
    default:
      return stringify(childrenOf(x));
  }
}

/**
 * The text of inlines, formatting left out: a note's contents and a
 * citation's own prefix and suffix too; quotes as curly quotes.
 *
 * @see Text.Pandoc.Shared.stringify
 * @param {Node[]} inlines
 * @returns {string}
 */
export function stringify(inlines) {
  let out = '';
  for (const x of inlines) out += textOf(x);
  return out;
}

const keptPunctuation = (c) => c === '_' || c === '-' || c === '.';

/**
 * Text as an identifier: lowercased, letters, digits, spaces and `_-.`
 * kept, words joined by `-`, from the first letter on.
 *
 * Not ported yet: `gfm_auto_identifiers` and `ascii_identifiers`, both off
 * by default.
 *
 * @see Text.Pandoc.Shared.textToIdentifier
 * @param {string} text
 */
export function textToIdentifier(text) {
  const kept = [...toLower(text)]
    .filter((c) => isSpace(c) || isAlphaNum(c) || keptPunctuation(c))
    .join('');
  const ident = words(kept).join('-');
  const first = [...ident].findIndex(isAlpha);
  return first === -1 ? '' : [...ident].slice(first).join('');
}

/**
 * Inlines as an identifier.
 *
 * @see Text.Pandoc.Shared.inlineListToIdentifier
 * @param {Node[]} inlines
 */
export const inlineListToIdentifier = (inlines) =>
  textToIdentifier(stringify(inlines));

// Past this, Pandoc lets an identifier repeat.
const MOST_NUMBERED = 60000;

/**
 * An identifier for inlines not among `used`: `section` for none, numbered
 * `-1`, `-2`… where taken.
 *
 * @see Text.Pandoc.Shared.uniqueIdent
 * @param {Node[]} inlines
 * @param {{has: (id: string) => boolean}} used
 */
export function uniqueIdent(inlines, used) {
  const base = inlineListToIdentifier(inlines) || 'section';
  if (!used.has(base)) return base;
  for (let n = 1; n <= MOST_NUMBERED; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return base;
}

const isPara = (b) => b.t === 'Para';
const withType = (b, t) => new Node(t, b.c, b.start, b.end);

/**
 * List items made tight or loose as a whole: where only the last item ends
 * in a paragraph, that paragraph is plain; where any other has one, every
 * plain block is a paragraph.
 *
 * @see Text.Pandoc.Shared.compactify
 * @param {Node[][]} items Each item's blocks.
 * @returns {Node[][]}
 */
export function compactify(items) {
  if (items.length === 0) return items;
  const others = items.slice(0, -1);
  const final = items.at(-1);
  const last = final.at(-1);
  const otherParas = others.some((item) => item.some(isPara));
  if (last?.t === 'Para' && !final.slice(0, -1).some(isPara) && !otherParas) {
    return [...others, [...final.slice(0, -1), withType(last, 'Plain')]];
  }
  if (!items.some((item) => item.some(isPara))) return items;
  return items.map((item) =>
    item.map((b) => (b.t === 'Plain' ? withType(b, 'Para') : b)),
  );
}

const EMPTY_BOX = '\u2610';
const CHECKED_BOX = '\u2612';
const SPACE = null;

// Pandoc's patterns in its order: the inlines a box replaces (a string a
// `Str`, `SPACE` a `Space`), what must follow (a `Space`, kept, or
// nothing), and the box. `[ ]` as one `Str`, a space inside, no `Str` holds.
const TASKS = [
  [['[', SPACE, ']'], 'space', EMPTY_BOX],
  [['[ ]'], 'space', CHECKED_BOX],
  [['[x]'], 'space', CHECKED_BOX],
  [['[X]'], 'space', CHECKED_BOX],
  [['[', SPACE, ']'], 'end', EMPTY_BOX],
  [['[ ]'], 'end', EMPTY_BOX],
  [['[x]'], 'end', CHECKED_BOX],
  [['[X]'], 'end', CHECKED_BOX],
];

const matches = (x, want) =>
  want === SPACE ? x?.t === 'Space' : x?.t === 'Str' && x.c === want;

// The box `xs` opens with and how many of them it replaces, or null.
function taskBox(xs) {
  for (const [nodes, then, box] of TASKS) {
    if (!nodes.every((want, n) => matches(xs[n], want))) continue;
    const next = xs[nodes.length];
    if (then === 'space' ? next?.t === 'Space' : next === undefined) {
      return [box, nodes.length];
    }
  }
  return null;
}

/**
 * A task list item's first block with `[ ]` or `[x]` at its start as a
 * ballot box, `task_lists` on.
 *
 * @see Text.Pandoc.Shared.taskListItemFromAscii
 * @param {boolean} on Whether `task_lists` is.
 * @param {Node[]} blocks
 * @returns {Node[]}
 */
export function taskListItemFromAscii(on, blocks) {
  const [first, ...rest] = blocks;
  if (!on || (first?.t !== 'Plain' && first?.t !== 'Para')) return blocks;
  const box = taskBox(first.c);
  if (box === null) return blocks;
  const [mark, taken] = box;
  const boxNode = new Node(
    'Str',
    mark,
    first.c[0].start,
    first.c[taken - 1].end,
  );
  const inlines = [boxNode, ...first.c.slice(taken)];
  return [new Node(first.t, inlines, first.start, first.end), ...rest];
}
