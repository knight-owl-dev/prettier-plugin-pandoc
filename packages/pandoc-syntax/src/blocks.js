// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.
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
// Pandoc's own table forms; a pipe table is CommonMark's too, and prettier
// already prints one as Pandoc reads it. A grid table is framed in `+` rules. A
// dash line is one or more runs of dashes: several runs split a simple table's
// columns, and a multiline or headerless table opens and closes on one.
const GRID_RULE = /^[ \t]*\+[-=:]+(\+[-=:]+)*\+[ \t]*$/;
const GRID_ROW = /^[ \t]*[+|]/;
const DASH_COLUMNS = /^[ \t]*-+([ \t]+-+)+[ \t]*$/;
const DASH_LINE = /^[ \t]*-+([ \t]+-+)*[ \t]*$/;
// A definition marker, indented at most two spaces, and an example list item.
const DEFINITION_MARKER = /^ {0,2}[:~][ \t]+\S/;
const EXAMPLE_ITEM = /^\(@[\w-]*\)[ \t]+\S/;
const INDENTED_CONTENT = /^( {2,}|\t)\S/;

// An ordered list item, in any of Pandoc's styles: a number, a letter, a roman
// numeral or `#`, closed by `.` or `)` or wrapped in parentheses. A capital
// letter closed by `.` needs two spaces after it, so an initial opening a
// sentence stays prose. `(?<indent>)` is how far in the marker sits.
// cspell:ignore ivxlcdm IVXLCDM
const ORDERED_MARKER =
  /^(?<indent>[ \t]*)(?:\((?:\d+|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+|#)\)|(?:\d+|[a-z]|[ivxlcdm]+|#)[.)]|[A-Z]\)|[IVXLCDM]+\)|(?:[A-Z]|[IVXLCDM]+)\.(?= {2}|\t))(?:[ \t]+\S|[ \t]*$)/;
// The one marker style prettier prints as Pandoc reads it.
const PLAIN_MARKER = /^[ \t]*\d+\.[ \t]/;
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
  // Before the thematic break its opening `---` would otherwise read as.
  if (opensYaml(lines, at)) return { kind: 'yaml' };
  if (ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) return START;
  if (HTML_COMMENT.test(line)) {
    return line.includes('-->') ? START : { kind: 'comment' };
  }
  if (HTML_BLOCK_TAG.test(line)) return START;
  if (LINK_REFERENCE.test(line)) return START;
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

function opensYaml(lines, at) {
  const next = lines[at + 1]?.text;
  return (
    YAML_FENCE.test(lines[at].text) &&
    next !== undefined &&
    !BLANK.test(next) &&
    lines.slice(at + 1).some((l) => YAML_END.test(l.text))
  );
}

// The table opening on line `at`, and its last line; null when none does. A
// grid table ends on its last framed line, a simple table at the next blank
// line — a text line straight after it is another row — and a multiline or
// headerless table on its closing dash line. Without that line the opening
// dashes are a thematic break.
function tableAt(lines, at) {
  const line = lines[at].text;
  const next = lines[at + 1]?.text;

  if (GRID_RULE.test(line)) {
    let n = at;
    while (n + 1 < lines.length && GRID_ROW.test(lines[n + 1].text)) n++;
    return { type: 'grid-table', last: n };
  }
  if (next !== undefined && !BLANK.test(line) && DASH_COLUMNS.test(next)) {
    let n = at;
    while (n + 1 < lines.length && !BLANK.test(lines[n + 1].text)) n++;
    return { type: 'simple-table', last: n };
  }
  if (DASH_LINE.test(line) && next !== undefined && !BLANK.test(next)) {
    // Headerless: rows between two column lines. Multiline: a full-width rule,
    // header lines, a column line, rows, and a full-width rule again — which
    // closes it only once the column line has been seen.
    const headerless = DASH_COLUMNS.test(line);
    let separated = false;
    for (let n = at + 1; n < lines.length; n++) {
      const row = lines[n].text;
      if (headerless && DASH_COLUMNS.test(row)) {
        return { type: 'simple-table', last: n };
      }
      if (!headerless && DASH_COLUMNS.test(row)) separated = true;
      else if (!headerless && separated && DASH_LINE.test(row)) {
        return { type: 'multiline-table', last: n };
      }
    }
  }
  return null;
}

// Whether a definition list opens on line `at`: a one-line term, then its
// marker, a blank line between them allowed. A line that opens a block of its
// own, a heading say, is never a term.
function opensDefinitionList(lines, at) {
  const [next, after] = [lines[at + 1]?.text, lines[at + 2]?.text];
  if (BLANK.test(lines[at].text) || next === undefined) return false;
  if (opened(lines, at).kind !== 'paragraph') return false;
  if (DEFINITION_MARKER.test(next)) return true;
  return (
    BLANK.test(next) && after !== undefined && DEFINITION_MARKER.test(after)
  );
}

// The last line of a list opening on line `at`. Every non-blank line after an
// item continues it, lazily or not; past a blank line, the list goes on only
// where `resumes` says the next non-blank line belongs to it.
function listEnd(lines, at, resumes) {
  let last = at;
  for (let n = at + 1; n < lines.length; n++) {
    if (!BLANK.test(lines[n].text)) {
      if (!BLANK.test(lines[n - 1].text) || resumes(lines, n)) last = n;
      else break;
    }
  }
  return last;
}

const resumesDefinitionList = (lines, n) =>
  INDENTED_CONTENT.test(lines[n].text) ||
  DEFINITION_MARKER.test(lines[n].text) ||
  opensDefinitionList(lines, n);

const isOrderedItem = (line) => {
  const marker = ORDERED_MARKER.exec(line);
  return marker !== null && marker.groups.indent.length <= 3;
};

const resumesOrderedList = (lines, n) =>
  INDENTED_CONTENT.test(lines[n].text) || isOrderedItem(lines[n].text);

// Whether any item of a list, however deep, carries a marker prettier would
// rewrite or not read as one.
const hasFancyMarker = (lines, from, to) =>
  lines
    .slice(from, to + 1)
    .some((l) => ORDERED_MARKER.test(l.text) && !PLAIN_MARKER.test(l.text));

const resumesExampleList = (lines, n) =>
  INDENTED_CONTENT.test(lines[n].text) || EXAMPLE_ITEM.test(lines[n].text);

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

// Consecutive raw TeX lines are one block to Pandoc. Adjacency is by line:
// inside a container, one line's content does not start where the last ended.
function mergeAdjacent(raws) {
  const out = [];
  for (const raw of raws) {
    const last = out.at(-1);
    if (last !== undefined && raw.from === last.to + 1) {
      last.end = raw.end;
      last.to = raw.to;
    } else {
      out.push(raw);
    }
  }
  return out;
}

// Each line's share of a span from `start` on line `from` to `end` on line
// `to`: what a caller masks, line by line, without touching a container's
// prefix between them.
const segmentsOf = (lines, from, to, start, end) =>
  lines.slice(from, to + 1).map((line, k) => ({
    start: k === 0 ? start : line.start,
    end: k === to - from ? end : line.end,
  }));

// The column a line's text starts at, a tab advancing to the next stop of four.
function indentOf(text) {
  let col = 0;
  for (const c of text) {
    if (c === ' ') col++;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// A line with up to `cols` columns of its indentation removed: the view a
// container's content is read through. `start` moves with it, so offsets into
// the view stay offsets into the source.
function dedent(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.text.length && col < cols) {
    const c = line.text[i];
    if (c === ' ') col++;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
    i++;
  }
  return { start: line.start + i, end: line.end, text: line.text.slice(i) };
}

const QUOTE_MARKER = /^ {0,3}> ?/;
const BULLET_ITEM = /^( {0,3})([-*+])([ \t]+|$)/;
const PLAIN_ITEM = /^( {0,3})(\d{1,9}\.)([ \t]+|$)/;

// The block quote opening on line `at`: every line up to a blank one, a `>`
// stripped where there is one. A line without is lazy, taken as it stands —
// Pandoc collects the quote's text first and parses it after, so laziness
// follows the text and not what the line continues. Inside a div, a closing
// fence is the div's, never a lazy line.
function collectQuote(lines, at, inDiv) {
  const content = [];
  let n = at;
  for (; n < lines.length && !BLANK.test(lines[n].text); n++) {
    const marker = QUOTE_MARKER.exec(lines[n].text);
    if (marker === null && inDiv && DIV_CLOSE.test(lines[n].text)) break;
    content.push(
      marker === null
        ? { ...lines[n], lazy: true }
        : {
            start: lines[n].start + marker[0].length,
            end: lines[n].end,
            text: lines[n].text.slice(marker[0].length),
          },
    );
  }
  return { last: n - 1, content };
}

// The list item opening on line `at`. Its content column is where the text
// after the marker starts. Straight after a content line, any line continues
// the item except a list marker left of that column, which opens the next one;
// past a blank line, only a line indented to the column does. Blank lines the
// item ends on belong to what follows, and inside a div, so does a closing
// fence.
function collectItem(lines, at, marker, inDiv) {
  const [prefix, indent, bullet, gap] = marker;
  const after = lines[at].text.slice(prefix.length);
  // Five spaces or more after a marker is an indented code block with one space
  // of gap; no text after it puts the column one past the marker.
  const width = BLANK.test(after) || indentOf(gap) >= 5 ? 1 : indentOf(gap);
  const column = indent.length + bullet.length + width;
  const first = indent.length + bullet.length + Math.min(width, gap.length);
  const content = [
    {
      start: lines[at].start + first,
      end: lines[at].end,
      text: lines[at].text.slice(first),
    },
  ];
  let last = at;
  for (let n = at + 1; n < lines.length; n++) {
    const line = lines[n];
    if (BLANK.test(line.text)) continue;
    const blankBefore = n > last + 1;
    const indent = indentOf(line.text);
    if (indent >= column) {
      // Blank lines between content lines are the item's own.
      for (let b = last + 1; b < n; b++) content.push(dedent(lines[b], column));
      content.push(dedent(line, column));
    } else if (blankBefore) {
      break;
    } else if (
      isListMarker(line.text) ||
      THEMATIC_BREAK.test(line.text) ||
      (inDiv && DIV_CLOSE.test(line.text))
    ) {
      break;
    } else {
      content.push({ ...dedent(line, indent), lazy: true });
    }
    last = n;
  }
  return { last, content };
}

const isListMarker = (text) =>
  BULLET_ITEM.test(text) || PLAIN_ITEM.test(text) || isOrderedItem(text);

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
 * Find every fenced div, raw TeX block, line block, Pandoc table, and each
 * list CommonMark cannot read — definition, example and fancy — in source
 * order.
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
 * included. A table runs from its first line to its last; its caption is a
 * paragraph of its own, which Pandoc attaches. A definition or example list
 * runs from its first term or item to the last line that belongs to it; so
 * does a fancy list, an ordered list with any marker other than a number and
 * a period, nested items included.
 *
 * Code blocks, HTML comments and YAML metadata are reported too: Pandoc reads
 * no markdown inside them, which a caller scanning for inline syntax needs.
 *
 * Block quotes and list items are containers: Pandoc collects each one's text
 * and parses it as a document of its own, so everything above holds inside
 * them too. A container is reported with the lines it holds, lazy ones marked.
 * Every span but a div's carries `segments`, its share of each line it covers;
 * inside a container those stop short of the prefix.
 *
 * @param {string} text Pandoc markdown.
 * @returns {({
 *   type: 'div',
 *   open: {start: number, end: number},
 *   close: {start: number, end: number} | null,
 * } | {
 *   type:
 *     | 'raw-tex'
 *     | 'line-block'
 *     | 'grid-table'
 *     | 'simple-table'
 *     | 'multiline-table'
 *     | 'definition-list'
 *     | 'example-list'
 *     | 'fancy-list'
 *     | 'code-block'
 *     | 'html-comment'
 *     | 'yaml-metadata'
 *     | 'block-quote'
 *     | 'list-item',
 *   start: number,
 *   end: number,
 *   segments: {start: number, end: number}[],
 *   lines?: {start: number, end: number, lazy: boolean}[],
 * })[]} Offsets, a line's newline excluded.
 */
export function blocks(text) {
  const out = [];
  scan(splitLines(text), text, out, 0);
  const start = (block) =>
    block.type === 'div' ? block.open.start : block.start;
  return out.sort((a, b) => start(a) - start(b));
}

// One document's lines, top level or a container's content, read by the block
// rules into `out`. A line's `start` is where its text begins in the source,
// so every offset found here is a source offset. `divs` counts the divs open
// around this document, whose closing fence ends a container inside them.
function scan(lines, text, out, divs) {
  const raws = [];
  const open = [];
  let state = START;

  // A span from `start` on line `from` to `end` on line `to`, with its share of
  // each line.
  const push = (type, from, to, start, end) =>
    out.push({
      type,
      start,
      end,
      segments: segmentsOf(lines, from, to, start, end),
    });
  const whole = (type, from, to) =>
    push(type, from, to, lines[from].start, lines[to].end);

  // Blocks Pandoc reads no markdown inside, reported so a caller scanning for
  // inline syntax can pass over them.
  const OPAQUE_TYPE = {
    code: 'code-block',
    indented: 'code-block',
    comment: 'html-comment',
    yaml: 'yaml-metadata',
  };
  const close = (state, to) => whole(OPAQUE_TYPE[state.kind], state.from, to);

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
      if (where === 'inside') {
        if (!BLANK.test(t)) state.to = n;
        continue;
      }
      // An indented block ends at its last non-blank line; the rest end on
      // the line that closes them. A pipe table is prettier's to print.
      if (OPAQUE_TYPE[state.kind] !== undefined) {
        close(state, where === 'ends' ? n : state.to);
      }
      state = START;
      if (where === 'ends') continue;
    }

    const skipTo = (last, end = lines[last].end) => {
      state = last === n ? START : { kind: 'skip', line: last, end };
    };

    if (BLANK.test(t)) {
      state = START;
    } else if (open.length > 0 && DIV_CLOSE.test(t)) {
      out.push({ type: 'div', open: open.pop(), close: span });
      state = START;
    } else if (CODE_FENCE.test(t)) {
      // Fenced code and raw TeX environments interrupt a paragraph.
      state = { kind: 'code', marker: CODE_FENCE.exec(t)[1], from: n, to: n };
    } else if (texClose !== null) {
      raws.push({
        from: n,
        to: texClose.line,
        start: line.start,
        end: texClose.end,
      });
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
    } else if (opensDefinitionList(lines, n) || EXAMPLE_ITEM.test(t)) {
      const [type, resumes] = EXAMPLE_ITEM.test(t)
        ? ['example-list', resumesExampleList]
        : ['definition-list', resumesDefinitionList];
      const last = listEnd(lines, n, resumes);
      whole(type, n, last);
      skipTo(last);
    } else if (
      isOrderedItem(t) &&
      hasFancyMarker(lines, n, listEnd(lines, n, resumesOrderedList))
    ) {
      const last = listEnd(lines, n, resumesOrderedList);
      whole('fancy-list', n, last);
      skipTo(last);
    } else if (!opensYaml(lines, n) && tableAt(lines, n) !== null) {
      const table = tableAt(lines, n);
      whole(table.type, n, table.last);
      skipTo(table.last);
    } else if (
      LINE_BLOCK_LINE.test(t) &&
      !TABLE_SEPARATOR.test(lines[n + 1]?.text ?? '')
    ) {
      // A bar line over a separator row is a pipe table's header instead.
      const last = lineBlockEnd(lines, n);
      whole('line-block', n, last);
      skipTo(last);
    } else if (TEX_LINE.test(t)) {
      const end = line.start + TEX_LINE.exec(t)[1].length;
      raws.push({ from: n, to: n, start: line.start, end });
      if (!BLANK.test(text.slice(end, line.end))) state = paragraph();
    } else if (
      QUOTE_MARKER.test(t) ||
      (!THEMATIC_BREAK.test(t) && (BULLET_ITEM.test(t) || PLAIN_ITEM.test(t)))
    ) {
      // A container: its content is read as a document of its own.
      const marker = BULLET_ITEM.exec(t) ?? PLAIN_ITEM.exec(t);
      const quote = QUOTE_MARKER.test(t);
      const inDiv = divs + open.length > 0;
      const { last, content } = quote
        ? collectQuote(lines, n, inDiv)
        : collectItem(lines, n, marker, inDiv);
      out.push({
        type: quote ? 'block-quote' : 'list-item',
        start: line.start,
        end: lines[last].end,
        segments: segmentsOf(lines, n, last, line.start, lines[last].end),
        lines: content.map((c) => ({
          start: c.start,
          end: c.end,
          lazy: c.lazy === true,
        })),
      });
      scan(content, text, out, divs + open.length);
      skipTo(last);
    } else {
      state = opened(lines, n);
      if (HTML_COMMENT.test(t) && state === START) {
        whole('html-comment', n, n);
      } else if (OPAQUE_TYPE[state.kind] !== undefined) {
        state = { ...state, from: n, to: n };
      }
    }
  }
  // A code fence or comment never closed runs to the end of the document.
  if (OPAQUE_TYPE[state.kind] !== undefined) close(state, state.to);
  for (const span of open) out.push({ type: 'div', open: span, close: null });
  for (const raw of mergeAdjacent(raws)) {
    push('raw-tex', raw.from, raw.to, raw.start, raw.end);
  }
}
