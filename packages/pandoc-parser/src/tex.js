// TeX tokens, as Pandoc's LaTeX reader reads TeX.
//
// Ported from Pandoc 3.11's `Text.Pandoc.TeX`.

/**
 * A token's kind: a control sequence (`name` its name), spaces, a newline,
 * a symbol, a word, a comment, a `^^` escape of one or two hex digits, a
 * macro argument (`#1`), or a deferred one (`##1`; `arg` its number).
 *
 * @see Text.Pandoc.TeX.TokType
 * @typedef {'CtrlSeq' | 'Spaces' | 'Newline' | 'Symbol' | 'Word' | 'Comment' | 'Esc1' | 'Esc2' | 'Arg' | 'DeferredArg'} TokType
 */

/**
 * A token: its kind, its text as written, the line and column Pandoc gives
 * it, and the span of text it was read from, in UTF-16 code units.
 * Pandoc's position drifts where its tokenizer's does; the span does not.
 *
 * @see Text.Pandoc.TeX.Tok
 * @typedef {object} Tok
 * @property {TokType} type
 * @property {string} text
 * @property {string} [name] A control sequence's name.
 * @property {number} [arg] An argument's number.
 * @property {number} line From 1.
 * @property {number} column From 1.
 * @property {number} start
 * @property {number} end
 * @property {string} [source] The file it was read from, where it is not
 *   the document: Pandoc's source name.
 */

/**
 * A token's text.
 *
 * @see Text.Pandoc.TeX.tokToText
 * @param {Tok} tok
 */
export const tokToText = (tok) => tok.text;
