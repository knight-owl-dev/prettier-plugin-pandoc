// A read's log beside Pandoc's: each message at Pandoc's position. Pandoc
// gives a position in text extracted to be read again, a list item's, a
// note's or raw TeX's (a `chunk`), in that text's lines: there only the
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

/**
 * Our log and Pandoc's `--log` JSON of `text`, read at `tabStop`, as two
 * values equal where they agree.
 *
 * @param {string} text
 * @param {number} tabStop
 * @param {import('../../src/logging.js').LogMessage[]} ours
 * @param {object[]} theirs
 * @returns {[object[], object[]]}
 */
export function logsCompared(text, tabStop, ours, theirs) {
  const at = positionsIn(text, tabStop);
  const want = theirs.map(normalized(at(text.length)));
  const got = ours.map(({ start, end, pos, ...fields }, k) => {
    const out =
      fields.type === 'UnclosedDiv'
        ? { ...fields, closepos: at(end), openpos: at(start) }
        : { ...fields, at: at(pos) };
    for (const key of ['at', 'openpos', 'closepos']) {
      if (!(key in (want[k] ?? {}))) delete out[key];
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
