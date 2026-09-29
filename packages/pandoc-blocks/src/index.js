// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.
//
// A formatter, a linter and a language server all need the same answer to
// where a Pandoc block starts; this is the one place that answers it, and it
// imports no formatter.
//
// Pandoc parses block by block. A construct CommonMark lacks — a fenced div,
// say — is only recognized where a new block may start: a line a paragraph or
// list item could continue into is that paragraph's text, fence or not. After
// any block that ends on its own — a blank line, a heading, an HTML comment, a
// raw TeX environment, another fence — the next line starts a block.
//
// Offsets index the source string, so a caller can slice or mask the exact
// characters Pandoc reads as markup.

const BLANK = /^[ \t]*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DIV_OPEN = /^:{3,}[ \t]*(\{[^}]*\}|[^\s:{}]+)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^:{3,}[ \t]*$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const INDENTED = /^( {4}|\t)/;
const TEX_BEGIN = /^ {0,3}\\begin\{([^}]+)\}/;
// A line of TeX commands and their arguments: Pandoc reads the commands as a
// raw block and a trailing `%` comment as a paragraph after it. Prose after the
// last argument makes the whole line a paragraph, and an environment is raw
// only with its matching end, so neither half counts here.
const TEX_LINE =
  /^(?!\\(?:begin|end)\{)(\\[A-Za-z]+\*?(?:[ \t]*(?:\{[^{}]*\}|\[[^\]]*\]))*)[ \t]*(?:%.*)?$/;
const HTML_COMMENT = /^ {0,3}<!--/;
const HTML_BLOCK_TAG =
  /^ {0,3}<\/?(address|article|aside|blockquote|center|details|dialog|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(\s|\/?>|$)/i;
const YAML_FENCE = /^---[ \t]*$/;
const YAML_END = /^(---|\.\.\.)[ \t]*$/;
const TABLE_SEPARATOR =
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// A line block opens on a bar in the first column followed by a space or the
// end of the line; a line starting with a space continues the verse line above.
const LINE_BLOCK_LINE = /^\|( |$)/;
const LINE_BLOCK_CONTINUATION = /^ +\S/;
const LINK_REFERENCE = /^ {0,3}\[[^\]^][^\]]*\]:[ \t]*\S/;

// Where the line before left the reader. START: the next line may open any
// block, a div included. paragraph: a paragraph, or the paragraph-like last
// line of a list item, quote, definition or footnote, is open and continues
// into any line that does not interrupt it. The rest are blocks with an end
// condition of their own; no fence inside one is markup.
const START = { kind: 'start' };
const paragraph = () => ({ kind: 'paragraph', lines: 1 });

function splitLines(text) {
  const out = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    out.push({ start, end, text: text.slice(start, end) });
    if (newline === -1) return out;
    start = newline + 1;
  }
}

function closesCode(line, marker) {
  const fence = CODE_FENCE.exec(line);
  return (
    fence !== null &&
    fence[1][0] === marker[0] &&
    fence[1].length >= marker.length &&
    BLANK.test(line.slice(fence[0].length))
  );
}

// The state a block-level line leaves when nothing is open: START for a block
// that ends on this line, a block state for one that runs on, a paragraph for
// text. What follows `at` tells a table and YAML apart from a line block and a
// thematic break.
function opened(lines, at) {
  const line = lines[at].text;
  const next = lines[at + 1]?.text;
  if (ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) return START;
  if (HTML_COMMENT.test(line)) {
    return line.includes('-->') ? START : { kind: 'comment' };
  }
  if (HTML_BLOCK_TAG.test(line)) return START;
  if (LINK_REFERENCE.test(line)) return START;
  if (
    YAML_FENCE.test(line) &&
    next !== undefined &&
    !BLANK.test(next) &&
    lines.slice(at + 1).some((l) => YAML_END.test(l.text))
  ) {
    return { kind: 'yaml' };
  }
  if (INDENTED.test(line)) return { kind: 'indented' };
  if (
    /^[ \t]*\|/.test(line) &&
    next !== undefined &&
    TABLE_SEPARATOR.test(next)
  ) {
    return { kind: 'table' };
  }
  return paragraph();
}

// Where the environment opened on line `at` ends: the line, and the offset just
// past its matching `\end`. Null when it never closes, which Pandoc reads as
// paragraph text rather than raw TeX.
function texEnd(lines, at, env) {
  const marker = new RegExp(
    `\\\\(begin|end)\\{${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`,
    'g',
  );
  let depth = 0;
  for (let n = at; n < lines.length; n++) {
    for (const m of lines[n].text.matchAll(marker)) {
      depth += m[1] === 'begin' ? 1 : -1;
      if (depth === 0) {
        return { line: n, end: lines[n].start + m.index + m[0].length };
      }
    }
  }
  return null;
}

// The last line of the line block opening on line `at`. It ends at the first
// line that is neither verse nor its continuation, and what follows starts a
// block of its own.
function lineBlockEnd(lines, at) {
  let n = at;
  while (
    n + 1 < lines.length &&
    (LINE_BLOCK_LINE.test(lines[n + 1].text) ||
      LINE_BLOCK_CONTINUATION.test(lines[n + 1].text))
  ) {
    n++;
  }
  return n;
}

// Consecutive raw TeX lines are one block to Pandoc.
function mergeAdjacent(raws) {
  const out = [];
  for (const raw of raws) {
    const last = out.at(-1);
    if (last !== undefined && raw.start === last.end + 1) last.end = raw.end;
    else out.push(raw);
  }
  return out;
}

// A block that runs on: whether this line is still inside it. A block closed
// by its own last line reports `ends`; one that ends before this line reports
// neither, and the line is read afresh.
function within(state, line) {
  switch (state.kind) {
    case 'code':
      return closesCode(line, state.marker) ? 'ends' : 'inside';
    case 'comment':
      return line.includes('-->') ? 'ends' : 'inside';
    case 'yaml':
      return YAML_END.test(line) ? 'ends' : 'inside';
    case 'indented':
      return BLANK.test(line) || INDENTED.test(line) ? 'inside' : 'after';
    case 'table':
      return /^[ \t]*\|/.test(line) ? 'inside' : 'after';
    default:
      return 'after';
  }
}

/**
 * Find every fenced div, raw TeX block and line block, in source order.
 *
 * A div's close needs no block start: Pandoc ends the paragraph a closing fence
 * interrupts. A div never closed runs to the end of the document, as Pandoc
 * reads it (with a warning), so its `close` is null.
 *
 * A raw TeX block is an environment, from `\begin` to its matching `\end`, or
 * a line of commands, and adjacent ones merge. Its span covers exactly the
 * characters Pandoc keeps raw: an environment can end mid-line, and what
 * follows is a paragraph.
 *
 * A line block runs from its first verse line to its last, continuations
 * included.
 *
 * @param {string} text Pandoc markdown.
 * @returns {({
 *   type: 'div',
 *   open: {start: number, end: number},
 *   close: {start: number, end: number} | null,
 * } | {
 *   type: 'raw-tex' | 'line-block',
 *   start: number,
 *   end: number,
 * })[]} Offsets, a line's newline excluded.
 */
export function blocks(text) {
  const divs = [];
  const raws = [];
  const verses = [];
  const open = [];
  const lines = splitLines(text);
  let state = START;

  for (const [n, line] of lines.entries()) {
    const t = line.text;
    const span = { start: line.start, end: line.end };
    const env = TEX_BEGIN.exec(t)?.[1];
    const texClose = env === undefined ? null : texEnd(lines, n, env);

    // Inside a block already found, up to the line it ends on.
    if (state.kind === 'skip') {
      if (n < state.line) continue;
      const tail = text.slice(state.end, line.end);
      state = BLANK.test(tail) ? START : paragraph();
      continue;
    }

    if (state.kind !== 'start' && state.kind !== 'paragraph') {
      const where = within(state, t);
      if (where === 'inside') continue;
      state = START;
      if (where === 'ends') continue;
    }

    if (BLANK.test(t)) {
      state = START;
    } else if (open.length > 0 && DIV_CLOSE.test(t)) {
      divs.push({ type: 'div', open: open.pop(), close: span });
      state = START;
    } else if (CODE_FENCE.test(t)) {
      // Fenced code and raw TeX environments interrupt a paragraph.
      state = { kind: 'code', marker: CODE_FENCE.exec(t)[1] };
    } else if (texClose !== null) {
      raws.push({ type: 'raw-tex', start: line.start, end: texClose.end });
      if (texClose.line === n) {
        const tail = text.slice(texClose.end, line.end);
        state = BLANK.test(tail) ? START : paragraph();
      } else {
        state = { kind: 'skip', line: texClose.line, end: texClose.end };
      }
    } else if (state.kind === 'paragraph') {
      // An underline turns a one-line paragraph into a heading; a block-level
      // HTML tag ends any paragraph. Anything else, a heading marker included,
      // continues it.
      const underline = state.lines === 1 && SETEXT_UNDERLINE.test(t);
      if (underline || HTML_BLOCK_TAG.test(t)) state = START;
      else state.lines++;
    } else if (DIV_OPEN.test(t)) {
      open.push(span);
    } else if (
      LINE_BLOCK_LINE.test(t) &&
      !TABLE_SEPARATOR.test(lines[n + 1]?.text ?? '')
    ) {
      // A bar line over a separator row is a pipe table's header instead.
      const last = lineBlockEnd(lines, n);
      verses.push({
        type: 'line-block',
        start: line.start,
        end: lines[last].end,
      });
      state =
        last === n ? START : { kind: 'skip', line: last, end: lines[last].end };
    } else if (TEX_LINE.test(t)) {
      const end = line.start + TEX_LINE.exec(t)[1].length;
      raws.push({ type: 'raw-tex', start: line.start, end });
      if (!BLANK.test(text.slice(end, line.end))) state = paragraph();
    } else {
      state = opened(lines, n);
    }
  }
  for (const span of open) divs.push({ type: 'div', open: span, close: null });
  const start = (block) =>
    block.type === 'div' ? block.open.start : block.start;
  return [...divs, ...mergeAdjacent(raws), ...verses].sort(
    (a, b) => start(a) - start(b),
  );
}
