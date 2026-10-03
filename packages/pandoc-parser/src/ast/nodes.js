// Pandoc's AST as `pandoc -t json` encodes it, each block and inline with the
// source span it was read from.
//
// Ported from pandoc-types 1.23.1.2's `Text.Pandoc.Definition` and its Aeson
// encoding: a constructor is `{t, c}`, a nullary one `{t}`, a tuple an array,
// `Nothing` null, and a single-constructor type (`Caption`, `Citation`) its
// fields bare. Values are never mutated once built: builders share them.

/** The pandoc-types version Pandoc 3.11 writes into its JSON. */
export const API_VERSION = Object.freeze([1, 23, 1, 2]);

/**
 * A `Block` or `Inline`: its constructor `t`, its content `c` (undefined for
 * a nullary one), and the source span `[start, end)` it was read from, in
 * UTF-16 code units. Serializing leaves the span out: `withoutSpans`.
 *
 * @see Text.Pandoc.Definition.Block
 * @see Text.Pandoc.Definition.Inline
 */
export class Node {
  /**
   * @param {string} t
   * @param {unknown} c
   * @param {number} [start]
   * @param {number} [end]
   */
  constructor(t, c, start, end) {
    this.t = t;
    this.c = c;
    this.start = start;
    this.end = end;
  }
}

// A nullary constructor of an enumeration, as Aeson tags it.
const tag = (t) => Object.freeze({ t });

/** @see Text.Pandoc.Definition.nullAttr */
export const nullAttr = Object.freeze([
  '',
  Object.freeze([]),
  Object.freeze([]),
]);

/** @see Text.Pandoc.Definition.QuoteType */
export const SingleQuote = tag('SingleQuote');
export const DoubleQuote = tag('DoubleQuote');

/** @see Text.Pandoc.Definition.MathType */
export const InlineMath = tag('InlineMath');
export const DisplayMath = tag('DisplayMath');

/** @see Text.Pandoc.Definition.CitationMode */
export const AuthorInText = tag('AuthorInText');
export const SuppressAuthor = tag('SuppressAuthor');
export const NormalCitation = tag('NormalCitation');

/** @see Text.Pandoc.Definition.ListNumberStyle */
export const DefaultStyle = tag('DefaultStyle');
export const Example = tag('Example');
export const Decimal = tag('Decimal');
export const LowerRoman = tag('LowerRoman');
export const UpperRoman = tag('UpperRoman');
export const LowerAlpha = tag('LowerAlpha');
export const UpperAlpha = tag('UpperAlpha');

/** @see Text.Pandoc.Definition.ListNumberDelim */
export const DefaultDelim = tag('DefaultDelim');
export const Period = tag('Period');
export const OneParen = tag('OneParen');
export const TwoParens = tag('TwoParens');

/**
 * A citation: Aeson encodes the record's fields by name.
 *
 * @see Text.Pandoc.Definition.Citation
 * @param {object} fields
 * @param {string} fields.id
 * @param {Node[]} [fields.prefix]
 * @param {Node[]} [fields.suffix]
 * @param {{t: string}} [fields.mode]
 * @param {number} [fields.noteNum]
 * @param {number} [fields.hash]
 */
export const citation = ({
  id,
  prefix = [],
  suffix = [],
  mode = NormalCitation,
  noteNum = 0,
  hash = 0,
}) => ({
  citationId: id,
  citationPrefix: prefix,
  citationSuffix: suffix,
  citationMode: mode,
  citationNoteNum: noteNum,
  citationHash: hash,
});
