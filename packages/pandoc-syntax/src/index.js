// Where Pandoc's markdown constructs begin and end, by Pandoc's own rules.
//
// A formatter, a linter and a language server all need that answer; this is
// the one place that gives it, and it imports no formatter.

/** @typedef {import('./types.js').Block} Block */
/** @typedef {import('./types.js').InlineSpan} InlineSpan */

export { blocks } from './blocks/index.js';
export { inlines } from './inlines/index.js';
export { DEFAULT_TAB_STOP } from './syntax.js';
