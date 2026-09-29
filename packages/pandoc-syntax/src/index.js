// Where Pandoc's markdown constructs begin and end, by Pandoc's own rules.
//
// A formatter, a linter and a language server all need the same answer to
// where a Pandoc construct starts; this is the one place that answers it, and
// it imports no formatter.

export { blocks } from './blocks/index.js';
export { inlines } from './inlines/index.js';
