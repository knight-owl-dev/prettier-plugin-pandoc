// A read's log beside Pandoc's: each message at Pandoc's position. Pandoc
// gives a position in text extracted to be read again in that text's
// frame: a note's or raw TeX's (a `chunk`), or, in its source's name, a
// container's (a list item's, a quote's, a table cell's). There only the
// message is compared, the port's position being the source's. In raw TeX,
// Pandoc's tokenizer drifts behind the text (`tokenize`): there Pandoc's
// position may fall behind the port's, never ahead.

// The messages the LaTeX reader raises.
const LATEX = new Set([
  'MacroAlreadyDefined',
  'SkippedContent',
  'ParsingUnescaped',
  'UndefinedToggle',
]);

// The blocks whose contents Pandoc extracts and reads again.
const REREAD = new Set([
  'BlockQuote',
  'BulletList',
  'OrderedList',
  'DefinitionList',
  'LineBlock',
  'Table',
]);

// The spans of each block in `value` Pandoc reads again.
function rereadSpans(value, spans = []) {
  if (Array.isArray(value)) {
    for (const v of value) rereadSpans(v, spans);
  } else if (value !== null && typeof value === 'object') {
    if (REREAD.has(value.t)) spans.push([value.start, value.end]);
    for (const v of Object.values(value)) rereadSpans(v, spans);
  }
  return spans;
}

/**
 * Our read's log and Pandoc's `--log` JSON of `text`, read at `tabStop`, as
 * two values equal where they agree.
 *
 * @param {string} text
 * @param {number} tabStop
 * @param {{blocks: object[], log: import('../../src/logging.js').LogMessage[]}} read
 * @param {object[]} theirs
 * @returns {[object[], object[]]}
 */
export function logsCompared(text, tabStop, read, theirs) {
  const at = positionsIn(text, tabStop);
  const reread = rereadSpans(read.blocks);
  const inReread = (offset) =>
    reread.some(([start, end]) => start < offset && offset <= end);
  const want = theirs.map(normalized(at(text.length)));
  const got = read.log.map(({ start, end, pos, ...fields }, k) => {
    const offsets =
      fields.type === 'UnclosedDiv'
        ? { closepos: end, openpos: start }
        : { at: pos };
    const out = { ...fields };
    for (const [key, offset] of Object.entries(offsets)) {
      if (!(key in (want[k] ?? {}))) continue;
      if (inReread(offset)) delete want[k][key];
      else out[key] = at(offset);
    }
    if (LATEX.has(out.type) && out.at && behind(want[k].at, out.at)) {
      out.at = want[k].at;
    }
    return out;
  });
  return [got, want];
}

// Whether position `a` is before `b`.
const behind = (a, b) =>
  a.line < b.line || (a.line === b.line && a.column < b.column);

// Pandoc's message with each position as one, the end of the source
// standing for one past it, which Pandoc's input runs to; none in
// extracted text.
function normalized(last) {
  const position = ({ source, line, column }) => {
    if (source.endsWith('chunk')) return undefined;
    return line > last.line ? last : { line, column };
  };
  return ({ pretty, source, line, column, ...fields }) => {
    for (const key of ['openpos', 'closepos']) {
      if (key in fields) fields[key] = position(fields[key]);
      if (fields[key] === undefined) delete fields[key];
    }
    const here = line && position({ source, line, column });
    return here ? { ...fields, at: here } : fields;
  };
}

// Each offset of `text` as Pandoc's line and column, tabs expanded to
// `tabStop`.
function positionsIn(text, tabStop) {
  return (offset) => {
    let line = 1;
    let column = 1;
    for (const c of text.slice(0, offset)) {
      if (c === '\n') [line, column] = [line + 1, 1];
      else if (c === '\t') column += tabStop - ((column - 1) % tabStop);
      else column++;
    }
    return { line, column };
  };
}
