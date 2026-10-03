// The shapes this package passes around, for JSDoc to check against.

/**
 * A line of a document, or a view of one. `start` and `end` are source offsets;
 * `text` is what the view shows, a container's prefix removed.
 *
 * @typedef {object} Line
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {boolean} [lazy] A container line Pandoc took without its prefix.
 */

/**
 * @typedef {object} Span
 * @property {number} start
 * @property {number} end
 */

/**
 * A fenced div: its fence lines. `close` is null for a div Pandoc closes at
 * the end of the document.
 *
 * @typedef {object} DivBlock
 * @property {'div'} type
 * @property {Span} open
 * @property {Span | null} close
 */

/**
 * @typedef {'raw-tex' | 'line-block' | 'pipe-table' | 'grid-table' | 'simple-table'
 *   | 'multiline-table' | 'definition-list' | 'example-list' | 'fancy-list'
 *   | 'fenced-code' | 'indented-code' | 'html-comment' | 'yaml-metadata'
 *   | 'heading' | 'thematic-break'
 * } SpanType
 */

/**
 * A block that runs from `start` to `end`, with its share of each line it
 * covers. Inside a container those segments stop short of the prefix.
 *
 * @typedef {object} SpanBlock
 * @property {SpanType} type
 * @property {number} start
 * @property {number} end
 * @property {Span[]} segments
 */

/**
 * A block quote, list item, footnote definition or a definition list's
 * definition, with the lines of its content.
 *
 * @typedef {object} ContainerBlock
 * @property {'block-quote' | 'list-item' | 'footnote-definition' | 'definition'}
 *   type
 * @property {number} start
 * @property {number} end
 * @property {Span[]} segments
 * @property {{start: number, end: number, lazy: boolean}[]} lines
 */

/** @typedef {DivBlock | SpanBlock | ContainerBlock} Block */

/**
 * A span a recognizer reports, by the lines it covers. `start` and `end`
 * default to the whole of those lines; a block that starts or ends mid-line
 * names its own.
 *
 * @typedef {object} SpanSpec
 * @property {SpanType} type
 * @property {number} from
 * @property {number} to
 * @property {number} [start]
 * @property {number} [end]
 */

/**
 * What a recognizer found at a line: the block's last line, and what to report.
 * Each container carries its lines and content, which the scan reads as a
 * document of its own; a div's opening fence is noted for the scan's stack.
 *
 * @typedef {object} Match
 * @property {number} last
 * @property {number} [resume] Where blocks are read again, when not at the
 *   start of the line after `last`: on `last` after a mid-line end, or past
 *   the next line's indentation.
 * @property {SpanSpec[]} [spans]
 * @property {{
 *   type: ContainerBlock['type'],
 *   from: number,
 *   to: number,
 *   content: Line[],
 * }[]} [containers]
 * @property {Span} [divOpen]
 */

/**
 * @typedef {object} Context
 * @property {import('./syntax.js').Syntax} syntax What the tab stop decides.
 * @property {string} text The whole source.
 * @property {boolean} inDiv Whether a div is open around this line, at any
 *   level of nesting.
 * @property {{lines: number, start: number} | null} paragraph The paragraph
 *   this line would continue, or null at a block start: its lines so far, and
 *   where its text starts on the first.
 * @property {(lines: Line[], at: number) => boolean} opensBlock Whether a block
 *   other than paragraph text opens on a line.
 */

/**
 * One of Pandoc's block constructs. `match` answers whether one opens at line
 * `at`; one that `interruptsParagraph` may open where a paragraph would
 * otherwise continue. One that opens only once a later line closes it says
 * through `opensAhead` whether a line could open it, the lines after it
 * permitting.
 *
 * @typedef {object} Recognizer
 * @property {string} name
 * @property {boolean} interruptsParagraph
 * @property {(lines: Line[], at: number, context: Context) => Match | null} match
 * @property {(text: string, syntax: import('./syntax.js').Syntax) => boolean}
 *   [opensAhead]
 */

/**
 * @typedef {object} InlineSpan
 * @property {'raw-tex'} type
 * @property {number} start
 * @property {number} end
 */

export {};
