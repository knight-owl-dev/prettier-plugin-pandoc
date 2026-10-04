// Tables in LaTeX: `tabular` and its kin, their column specs, rules,
// multirow and multicolumn cells, and the `table` float's caption.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Table`. Each
// environment reads what follows `\begin{name}`, which starts at `start`;
// a table spans to its `\end`.

import * as B from '../ast/builder.js';
import {
  AlignCenter,
  AlignDefault,
  AlignLeft,
  AlignRight,
  ColWidthDefault,
  colWidth,
  Node,
  nullAttr,
  Row,
} from '../ast/nodes.js';
import { walk } from '../ast/walk.js';
import {
  alt,
  attempt,
  count,
  FAIL,
  lookAhead,
  many,
  many1,
  manyTill,
  notFollowedBy,
  option,
  optional,
  sepEndBy,
  skipMany,
} from '../core.js';
import { trim } from '../shared.js';
import {
  anyTok,
  bgroup,
  braced,
  bracedOrToken,
  controlSeq,
  egroup,
  end_,
  env,
  getNextNumber,
  label,
  parenWrapped,
  parseFromToks,
  prepend,
  rawopt,
  removeLabel,
  renderDottedNum,
  resetCaption,
  satisfyTok,
  setCaption,
  setInput,
  singleChar,
  skipopts,
  sp,
  spaces,
  symbol,
  tail,
  tokWith,
  untoken,
  untokenize,
  updateLaTeXState,
  withRaw,
} from './parsing.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {import('../ast/builder.js').Blocks} Blocks */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

// A table environment's blocks, its one table spanning to the `\end`.
const toEnd = (p) => (ctx, start) => {
  const bs = p(ctx, start);
  if (bs === FAIL) return FAIL;
  const [t] = bs;
  if (bs.length !== 1 || t.t !== 'Table' || t.start !== start) return bs;
  return [new Node('Table', t.c, t.start, ctx.state.at)];
};

/**
 * The table environments, reading cells by `block` and `inline`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.tableEnvironments
 * @param {Parser<Blocks>} block
 * @param {Parser<Inlines>} inline
 * @returns {Map<string, (ctx: object, start: number) => Blocks | typeof FAIL>}
 */
export function tableEnvironments(block, inline) {
  const blocks = (ctx) => {
    const bs = many(block)(ctx);
    return bs === FAIL ? FAIL : bs.flat();
  };
  const simple = (name, hasWidth) => (ctx, start) =>
    env(name, (c) => simpTable(block, inline, name, hasWidth)(c, start))(ctx);
  return new Map([
    [
      'longtable',
      toEnd((ctx, start) =>
        env('longtable', (c) => {
          resetCaption(c);
          const bs = simpTable(block, inline, 'longtable', false)(c, start);
          return bs === FAIL ? FAIL : addTableCaption(c, bs);
        })(ctx),
      ),
    ],
    [
      'table',
      (ctx) =>
        env('table', (c) => {
          if (skipopts(c) === FAIL) return FAIL;
          resetCaption(c);
          const bs = blocks(c);
          return bs === FAIL ? FAIL : addTableCaption(c, bs);
        })(ctx),
    ],
    ['tabular*', toEnd(simple('tabular*', true))],
    ['tabularx', toEnd(simple('tabularx', true))],
    ['tabular', toEnd(simple('tabular', false))],
    ['supertabular', toEnd(simple('supertabular', false))],
    ['supertabular*', toEnd(simple('supertabular*', false))],
  ]);
}

const RULES = [
  ['hline', false],
  ['cline', false],
  ['cmidrule', true],
  // booktabs rules:
  ['toprule', true],
  ['bottomrule', true],
  ['midrule', true],
  ['endhead', true],
  ['endfirsthead', true],
];
const ruleCommand = alt(
  ...RULES.map(
    ([name, paren]) =>
      (ctx) =>
        controlSeq(name)(ctx) === FAIL ? FAIL : paren,
  ),
);
const parenArg = optional(
  parenWrapped(
    (ctx) => (singleChar(ctx) === FAIL ? FAIL : undefined),
    () => undefined,
  ),
);

/**
 * A rule between rows: `\hline`, booktabs' rules and their kin.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.hline
 * @type {Parser<undefined>}
 */
const hline = attempt((ctx) => {
  if (spaces(ctx) === FAIL) return FAIL;
  const hasParenArg = ruleCommand(ctx);
  if (hasParenArg === FAIL || optional(rawopt)(ctx) === FAIL) return FAIL;
  return hasParenArg ? parenArg(ctx) : undefined;
});

const lineEnd = alt(controlSeq('\\'), controlSeq('tabularnewline'));
const optRawopt = optional(rawopt);

/**
 * The end of a row: `\\` or `\tabularnewline`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.lbreak
 * @type {Parser<Tok>}
 */
function lbreak(ctx) {
  const t = lineEnd(ctx);
  if (t === FAIL || optRawopt(ctx) === FAIL || spaces(ctx) === FAIL) {
    return FAIL;
  }
  return t;
}

/** @see Text.Pandoc.Readers.LaTeX.Table.amp */
const amp = symbol('&');

/**
 * A word next in the input split into symbols, one per character, for
 * the column spec.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.splitWordTok
 * @param {object} ctx
 */
function splitWordTok(ctx) {
  const cell = ctx.state.input;
  const t = cell?.tok;
  if (t?.type !== 'Word') return undefined;
  const syms = [];
  let at = 0;
  for (const c of t.text) {
    // A token from an expansion spans nothing; its pieces neither.
    const [from, to] =
      t.start === t.end
        ? [t.start, t.start]
        : [t.start + at, t.start + at + c.length];
    syms.push({ ...t, type: 'Symbol', text: c, start: from, end: to });
    at += c.length;
  }
  setInput(ctx, prepend(syms, tail(cell)), ctx.state.expanded);
  return undefined;
}

const ALIGNS = [
  ['c', AlignCenter],
  ['l', AlignLeft],
  ['r', AlignRight],
  ['p', AlignLeft],
  // aligns from tabularx
  ['X', AlignLeft],
  ['m', AlignLeft],
  ['b', AlignLeft],
];
const alignByChar = alt(
  ...ALIGNS.map(
    ([c, a]) =>
      (ctx) =>
        symbol(c)(ctx) === FAIL ? FAIL : a,
  ),
);
const alignChar = (ctx) =>
  splitWordTok(ctx) === FAIL ? FAIL : alignByChar(ctx);
const maybeBar = skipMany(
  attempt((ctx) => {
    if (sp(ctx) === FAIL) return FAIL;
    return alt(
      (c) => (symbol('|')(c) === FAIL ? FAIL : undefined),
      (c) => (symbol('@')(c) === FAIL || braced(c) === FAIL ? FAIL : undefined),
    )(ctx);
  }),
);
const affix = (c) =>
  option([], (ctx) => (symbol(c)(ctx) === FAIL ? FAIL : braced(ctx)));
const alignPrefix = affix('>');
const alignSuffix = affix('<');

// Haskell's `read` of a `Double`.
const readDouble = (s) =>
  /^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(s) ? Number(s) : null;
// Haskell's `read` of an `Int`.
const readInt = (s) =>
  /^\s*-?[0-9]+\s*$/.test(s)
    ? Number(BigInt.asIntN(64, BigInt(s.trim())))
    : null;

const colWidthOf = attempt((ctx) => {
  const ts = braced(ctx);
  if (ts === FAIL) return FAIL;
  const i = ts.findIndex((t) => t.type === 'CtrlSeq' && t.name === 'linewidth');
  return i === -1 ? null : readDouble(trim(untokenize(ts.slice(0, i))));
});
// Pandoc warns of a width it skips (`SkippedContent`).
const skippedWidth = option(null, (ctx) =>
  braced(ctx) === FAIL ? FAIL : null,
);

function alignSpec(ctx) {
  const pref = alignPrefix(ctx);
  if (pref === FAIL || spaces(ctx) === FAIL) return FAIL;
  const al = alignChar(ctx);
  if (al === FAIL) return FAIL;
  const width = alt(colWidthOf, skippedWidth)(ctx);
  if (width === FAIL || spaces(ctx) === FAIL) return FAIL;
  const suff = alignSuffix(ctx);
  return suff === FAIL ? FAIL : [al, width, [pref, suff]];
}

// '*{2}{r}' == 'rr', we just expand like a macro
function starAlign(ctx) {
  if (symbol('*')(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  const ds = bracedOrToken(ctx);
  if (ds === FAIL || spaces(ctx) === FAIL) return FAIL;
  const spec = bracedOrToken(ctx);
  if (spec === FAIL) return FAIL;
  const n = readInt(trim(untokenize(ds)));
  // Could not parse it as number.
  if (n === null) return FAIL;
  const repeated = [];
  for (let k = 0; k < n; k++) repeated.push(...spec);
  setInput(ctx, prepend(repeated, ctx.state.input), false);
  return undefined;
}

const alignEntry = attempt((ctx) => {
  if (spaces(ctx) === FAIL || optional(starAlign)(ctx) === FAIL) return FAIL;
  const a = alignSpec(ctx);
  return a === FAIL || maybeBar(ctx) === FAIL ? FAIL : a;
});
const alignEntries = many(alignEntry);

/**
 * The column spec: each column's alignment, width and the tokens before
 * and after its cells.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.parseAligns
 */
const parseAligns = attempt((ctx) => {
  if (bgroup(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  if (maybeBar(ctx) === FAIL) return FAIL;
  const aligns = alignEntries(ctx);
  if (aligns === FAIL || spaces(ctx) === FAIL) return FAIL;
  if (egroup(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  return aligns.map(([a, w, ps]) => [
    a,
    w !== null && w > 0 ? colWidth(w) : ColWidthDefault,
    ps,
  ]);
});

// The tokens that may hold a `&` that is no column separator.
const canContainAmp = (t) =>
  t.type === 'CtrlSeq' &&
  (t.name === 'begin' || t.name === 'verb' || t.name === 'Verb');

// A token at `at`'s position, spanning nothing there.
const setposAt = (ctx) => (t) => ({
  ...t,
  line: ctx.state.line,
  column: ctx.state.column,
  start: ctx.state.at,
  end: ctx.state.at,
});

/**
 * A row: each column's cell tokens, its prefix and suffix around them,
 * read as a cell. It may hold empty cells where a multirow cell above
 * reaches: `fixTableRows`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.parseTableRow
 * @param {Parser<Blocks>} block
 * @param {Parser<Inlines>} inline
 * @param {string} envname
 * @param {[Tok[], Tok[]][]} prefsufs
 * @returns {Parser<Row>}
 */
function parseTableRow(block, inline, envname, prefsufs) {
  const atEnd = notFollowedBy((ctx) =>
    spaces(ctx) === FAIL ? FAIL : end_(envname)(ctx),
  );
  const ahead = (p) => lookAhead(p);
  const embedded = withRaw(
    alt(
      (ctx) => (ahead(controlSeq('parbox'))(ctx) === FAIL ? FAIL : block(ctx)), // #5711
      (ctx) =>
        ahead(satisfyTok(canContainAmp))(ctx) === FAIL ? FAIL : inline(ctx),
      (ctx) => (ahead(controlSeq('begin'))(ctx) === FAIL ? FAIL : block(ctx)), // #4746
      (ctx) => (ahead(symbol('$'))(ctx) === FAIL ? FAIL : inline(ctx)),
    ),
  );
  const stop = notFollowedBy(
    alt(
      (ctx) => (amp(ctx) === FAIL ? FAIL : undefined),
      (ctx) => (lbreak(ctx) === FAIL ? FAIL : undefined),
      end_(envname),
    ),
  );
  const piece = alt(
    (ctx) => {
      const r = embedded(ctx);
      return r === FAIL ? FAIL : r[1];
    },
    (ctx) => (stop(ctx) === FAIL ? FAIL : count(1, anyTok)(ctx)),
  );
  const contentsOf = many(piece);
  const celltoks =
    ([pref, suff]) =>
    (ctx) => {
      const prefToks = pref.map(setposAt(ctx));
      const contents = contentsOf(ctx);
      if (contents === FAIL) return FAIL;
      const suffToks = suff.map(setposAt(ctx));
      if (option([], count(1, amp))(ctx) === FAIL) return FAIL;
      return [...prefToks, ...contents.flat(), ...suffToks];
    };
  const cell = parseTableCell(block);
  return (ctx) => {
    const start = ctx.state.at;
    if (atEnd(ctx) === FAIL) return FAIL;
    const rawcells = [];
    for (const ps of prefsufs) {
      const toks = celltoks(ps)(ctx);
      if (toks === FAIL) return FAIL;
      rawcells.push(toks);
    }
    const cells = [];
    for (const toks of rawcells) {
      const c = parseFromToks(cell, toks)(ctx);
      if (c === FAIL) return FAIL;
      cells.push(c);
    }
    const end = ctx.state.at;
    if (spaces(ctx) === FAIL) return FAIL;
    return new Row(nullAttr, cells, start, end);
  };
}

const emptyCell = () => B.cell(AlignDefault, 1, 1, []);

/**
 * A cell's contents: a multicolumn or multirow cell, its blocks, or
 * nothing.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.parseTableCell
 * @param {Parser<Blocks>} block
 */
function parseTableCell(block) {
  const blocks = (ctx) => {
    const bs = many(block)(ctx);
    return bs === FAIL ? FAIL : bs.flat();
  };
  const parseSimpleCell = (ctx) => {
    const bs = blocks(ctx);
    return bs === FAIL ? FAIL : B.cell(AlignDefault, 1, 1, plainify(bs));
  };
  // The parsing of empty cells is important in LaTeX, especially when
  // dealing with multirow/multicolumn. See #6603.
  const parseEmptyCell = (ctx) => (spaces(ctx) === FAIL ? FAIL : emptyCell());
  const content = alt(
    multicolumnCell(block),
    multirowCell(block),
    parseSimpleCell,
    parseEmptyCell,
  );
  return (ctx) => {
    if (spaces(ctx) === FAIL) return FAIL;
    updateLaTeXState(ctx, { inTableCell: true });
    const c = content(ctx);
    if (c === FAIL) return FAIL;
    updateLaTeXState(ctx, { inTableCell: false });
    return spaces(ctx) === FAIL ? FAIL : c;
  };
}

const bars = skipMany(symbol('|'));
const alignmentArg = optional(braced); // ignore args

/**
 * A cell's alignment, as `\multicolumn` gives it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.cellAlignment
 * @type {Parser<{t: string}>}
 */
function cellAlignment(ctx) {
  if (bars(ctx) === FAIL) return FAIL;
  const t = singleChar(ctx);
  if (t === FAIL || alignmentArg(ctx) === FAIL) return FAIL;
  if (bars(ctx) === FAIL) return FAIL;
  const c = untoken(t);
  return c === 'l'
    ? AlignLeft
    : c === 'r'
      ? AlignRight
      : c === 'c'
        ? AlignCenter
        : AlignDefault;
}

/**
 * A lone paragraph as plain text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.plainify
 * @param {Blocks} bs
 */
function plainify(bs) {
  if (bs.length === 1 && bs[0].t === 'Para') {
    return B.plain(bs[0].c, bs[0].start, bs[0].end);
  }
  return bs;
}

const inBrackets = (p) => (ctx) =>
  symbol('[')(ctx) === FAIL
    ? FAIL
    : (() => {
        const x = p(ctx);
        return x === FAIL || symbol(']')(ctx) === FAIL ? FAIL : x;
      })();
const skipBracketed = optional((ctx) =>
  symbol('[')(ctx) === FAIL ? FAIL : manyTill(anyTok, symbol(']'))(ctx),
);
const skipBraced = (ctx) =>
  symbol('{')(ctx) === FAIL ? FAIL : manyTill(anyTok, symbol('}'))(ctx);
const spanOf = (ctx) => {
  const t = braced(ctx);
  return t === FAIL ? FAIL : (readInt(untokenize(t)) ?? 1);
};

/**
 * `\multirow[vpos]{nrows}[bigstruts]{width}[vmove]{text}`: a cell over
 * rows. All but its rows and text mean nothing in Pandoc's AST.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.multirowCell
 * @param {Parser<Blocks>} block
 */
function multirowCell(block) {
  const contents = (ctx) => {
    if (symbol('{')(ctx) === FAIL) return FAIL;
    const bs = many(block)(ctx);
    if (bs === FAIL || symbol('}')(ctx) === FAIL) return FAIL;
    return plainify(bs.flat());
  };
  return (ctx) => {
    if (controlSeq('multirow')(ctx) === FAIL) return FAIL;
    // vertical position
    if (optional(inBrackets(cellAlignment))(ctx) === FAIL) return FAIL;
    const nrows = spanOf(ctx);
    if (nrows === FAIL) return FAIL;
    if (skipBracketed(ctx) === FAIL) return FAIL; // bigstrut-related
    if (skipBraced(ctx) === FAIL) return FAIL; // Cell width
    if (skipBracketed(ctx) === FAIL) return FAIL; // fine-tuning
    const content = contents(ctx);
    if (content === FAIL) return FAIL;
    return B.cell(AlignDefault, nrows, 1, content);
  };
}

/**
 * `\multicolumn{n}{align}{text}`: a cell over columns, its text a
 * `\multirow` cell or blocks. A `\multirow` cell can be nested in a
 * `\multicolumn`, but not the other way around (#6603).
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.multicolumnCell
 * @param {Parser<Blocks>} block
 */
function multicolumnCell(block) {
  const multirow = multirowCell(block);
  return (ctx) => {
    if (controlSeq('multicolumn')(ctx) === FAIL) return FAIL;
    const span = spanOf(ctx);
    if (span === FAIL) return FAIL;
    const alignment = inBraces(cellAlignment)(ctx);
    if (alignment === FAIL) return FAIL;
    const singleCell = (c) => {
      const bs = many(block)(c);
      if (bs === FAIL) return FAIL;
      return B.cell(alignment, 1, span, plainify(bs.flat()));
    };
    const nestedCell = (c) => {
      const inner = multirow(c);
      if (inner === FAIL) return FAIL;
      return B.cell(alignment, inner[2], span, inner[4]);
    };
    return inBraces(alt(nestedCell, singleCell))(ctx);
  };
}

const inBraces = (p) => (ctx) => {
  if (symbol('{')(ctx) === FAIL) return FAIL;
  const x = p(ctx);
  return x === FAIL || symbol('}')(ctx) === FAIL ? FAIL : x;
};

/**
 * Rows with the empty cells under multirow cells dropped: LaTeX stores
 * them, padding the grid spaces those cells take (#6603). Nothing else of
 * a malformed table is fixed: the table builder does.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.fixTableRows
 * @param {Row[]} rows
 * @returns {Row[]}
 */
function fixTableRows(rows) {
  let hang = [];
  return rows.map((row) => {
    const [newHang, cells] = fixTableRow(hang, row.cells);
    hang = newHang;
    return new Row(row.attr, cells, row.start, row.end);
  });
}

// A grid row's overhang from the rows above: per column, a cell's
// `[colSpan, rowSpan]` left, or null for a free space; free past its end.
const toHang = (c, r) => (r > 1 ? [[c, r]] : Array(Math.max(0, c)).fill(null));

// List items dropped until their widths reach `n`.
function dropToWidth(wproj, n, l) {
  let k = 0;
  for (let left = n; left >= 1 && k < l.length; k++) left -= wproj(l[k]);
  return l.slice(k);
}

/**
 * A row's cells with those under an overhang dropped, and the overhang
 * it leaves.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.fixTableRow
 * @param {([number, number] | null)[]} oldHang
 * @param {import('../ast/tables.js').Cell[]} cells
 * @returns {[([number, number] | null)[], import('../ast/tables.js').Cell[]]}
 */
function fixTableRow(oldHang, cells) {
  // If there's overhang, drop cells until their total width meets the
  // width of the occupied grid spaces (or we run out).
  let n = 0;
  let i = 0;
  const prefHang = [];
  for (; i < oldHang.length && oldHang[i] !== null; i++) {
    const [c, r] = oldHang[i];
    n += c;
    prefHang.push(...toHang(c, r - 1));
  }
  if (n > 0) {
    const rest = dropToWidth((c) => c[3], n, cells);
    const [restHang, fixed] = fixTableRow(oldHang.slice(i), rest);
    return [[...prefHang, ...restHang], fixed];
  }
  // Otherwise record the overhang of a pending cell and fix the rest of
  // the row.
  if (cells.length > 0) {
    const [c, ...rest] = cells;
    const h = Math.max(1, c[2]);
    const w = Math.max(1, c[3]);
    const hang = dropToWidth((x) => (x === null ? 1 : x[0]), w, oldHang);
    const [newHang, fixed] = fixTableRow(hang, rest);
    return [
      [...toHang(w, h), ...newHang],
      [c, ...fixed],
    ];
  }
  return [oldHang, []];
}

const optionalCaption = (inline) =>
  optional((ctx) =>
    controlSeq('caption')(ctx) === FAIL ? FAIL : setCaption(inline)(ctx),
  );
const optionalLabel = optional(label);
const optionalLbreak = optional(lbreak);
const hlines = skipMany(hline);
const ruleRows = many1(hline);

/**
 * A tabular's column spec and rows, its first row the head where rules
 * follow it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.simpTable
 * @param {Parser<Blocks>} block
 * @param {Parser<Inlines>} inline
 * @param {string} envname
 * @param {boolean} hasWidthParameter
 */
function simpTable(block, inline, envname, hasWidthParameter) {
  const width = tokWith(inline);
  const caption = optionalCaption(inline);
  const atEnd = lookAhead(controlSeq('end')); // make sure we're at end
  return (ctx, start) =>
    attempt((c) => {
      if (hasWidthParameter && width(c) === FAIL) return FAIL;
      if (skipopts(c) === FAIL) return FAIL;
      const colspecs = parseAligns(c);
      if (colspecs === FAIL) return FAIL;
      const prefsufs = colspecs.map(([, , ps]) => ps);
      const row = parseTableRow(block, inline, envname, prefsufs);
      const tail = [
        caption,
        spaces,
        optionalLabel,
        spaces,
        optionalLbreak,
        spaces,
      ];
      for (const p of tail) if (p(c) === FAIL) return FAIL;
      if (hlines(c) === FAIL || spaces(c) === FAIL) return FAIL;
      const header = option(
        [],
        attempt((d) => {
          const r = row(d);
          if (r === FAIL || lbreak(d) === FAIL || ruleRows(d) === FAIL) {
            return FAIL;
          }
          return [r];
        }),
      )(c);
      if (header === FAIL || spaces(c) === FAIL) return FAIL;
      const rowSep = (d) => (lbreak(d) === FAIL ? FAIL : optional(hlines)(d));
      const rows = sepEndBy(row, rowSep)(c);
      if (rows === FAIL) return FAIL;
      for (const p of [spaces, ...tail]) if (p(c) === FAIL) return FAIL;
      if (atEnd(c) === FAIL) return FAIL;
      const specs = colspecs.map(([a, w]) => [a, w]);
      return B.tableWith(
        nullAttr,
        B.emptyCaption,
        specs,
        [nullAttr, fixTableRows(header)],
        [[nullAttr, 0, [], fixTableRows(rows)]],
        [nullAttr, []],
        start,
        c.state.at,
      );
    })(ctx);
}

/**
 * A float's tables with the caption and label it gave, the label numbered
 * and dropped from the caption.
 *
 * @see Text.Pandoc.Readers.LaTeX.Table.addTableCaption
 * @param {object} ctx
 * @param {Blocks} bs
 * @returns {Blocks}
 */
function addTableCaption(ctx, bs) {
  return walk(
    {
      block: (x) => {
        if (x.t !== 'Table') return x;
        const [attr, c, ...rest] = x.c;
        const { caption, lastLabel } = ctx.state.s;
        const capt = caption ?? c;
        if (lastLabel !== null) {
          const num = getNextNumber((s) => s.lastTableNum)(ctx);
          const labels = new Map(ctx.state.s.labels).set(
            lastLabel,
            B.str(renderDottedNum(num), x.start, x.start),
          );
          updateLaTeXState(ctx, { lastTableNum: num, labels });
        }
        // add num to caption?
        const attr2 = lastLabel === null ? attr : [lastLabel, attr[1], attr[2]];
        const table = new Node('Table', [attr2, capt, ...rest], x.start, x.end);
        return lastLabel === null ? table : removeLabel(lastLabel, table);
      },
    },
    bs,
  );
}
