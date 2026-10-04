// Pandoc's LaTeX reader: TeX to Pandoc's AST, each block and inline with
// the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX`. What it reads
// outside the text it reads through its host's hooks: `common-state.js`.

import * as B from '../ast/builder.js';
import { doc } from '../ast/document.js';
import { DefaultDelim, DefaultStyle, Node, nullAttr } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import { walk, walkInlines } from '../ast/walk.js';
import { isSpace } from '../char.js';
import { renderLang } from '../collate/lang.js';
import { commonState } from '../common-state.js';
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
  parse,
  sepBy,
  skipMany,
} from '../core.js';
import { isAlphaNum, isAlpha as isLetter } from '../data-char.js';
import { numUnit, showFl } from '../image-size.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { anyOrderedListMarker } from '../parsing/lists.js';
import { defaultParserState } from '../parsing/state.js';
import {
  blocksToInlines,
  extractSpaces,
  formatCode,
  NBSP,
  splitTextBy,
  stringify,
  toLower,
  trim,
} from '../shared.js';
import { citationCommands, cites } from './citation.js';
import {
  accentCommands,
  acronymCommands,
  biblatexInlineCommands,
  charCommands,
  listingsLanguage,
  miscCommands,
  nameCommands,
  rawInlineOr,
  refCommands,
  verbCommands,
} from './inline.js';
import {
  babelLangToBCP47,
  enquoteCommands,
  inlineLanguageCommands,
  setDefaultLanguage,
} from './lang.js';
import { macroDef } from './macro.js';
import {
  dollarsMath,
  INLINE_ENVIRONMENTS,
  inlineEnvironment,
  mathDisplay,
  mathInline,
  newtheorem,
  proof,
  theoremEnvironment,
  theoremstyle,
  withMathMode,
} from './math.js';
import {
  addMeta,
  anyControlSeq,
  anyTok,
  begin_,
  bgroup,
  blankline,
  braced,
  bracedUrl,
  bracketed,
  bracketedToks,
  controlSeq,
  defaultLaTeXState,
  egroup,
  endline,
  env,
  getNextNumber,
  getRawCommand,
  grouped,
  incrementDottedNum,
  isNewlineTok,
  keyvals,
  label,
  lpContext,
  overlaySpecification,
  parseFromToks,
  peekTok,
  prepend,
  primEscape,
  rawopt,
  registerHeader,
  renderDottedNum,
  resetCaption,
  satisfyTok,
  setCaption,
  setInput,
  skipopts,
  sp,
  spaces,
  spaces1,
  streamOf,
  symbol,
  symbolIn,
  tokenize,
  tokWith,
  untokenize,
  updateLaTeXState,
  verbEnv,
  withRaw,
  withVerbatimMode,
} from './parsing.js';
import { siunitxCommands } from './siunitx.js';
import { tableEnvironments } from './table.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {import('../ast/builder.js').Blocks} Blocks */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

const enabled = (ctx, ext) => ctx.state.s.options.extensions.has(ext);

/**
 * Read `source` as Pandoc's LaTeX reader does.
 *
 * Not ported yet: `\lstinputlisting`.
 *
 * @see Text.Pandoc.Readers.LaTeX.readLaTeX
 * @param {string} source
 * @param {{tabStop?: number, extensions?: string[], lang?: string, defaultImageExtension?: string, host?: Partial<import('../common-state.js').Host>}} [options]
 *   `lang` is the BCP 47 tag of the language terms are translated to, as
 *   `-M lang=…` gives it; `host` the IO allowed, by default none.
 */
export function readLaTeX(source, options) {
  const opts = readerOptions({ ...options, format: 'latex' });
  const { text, toSource } = readerInput(source, opts.tabStop, 1);
  const input = streamOf(tokenize(text));
  const common = commonState({ lang: options?.lang, host: options?.host });
  const ctx = lpContext(input, defaultLaTeXState(opts), text.length, common);
  const pandoc = parseLaTeX(ctx);
  return { ...pandoc, blocks: mapSpans(pandoc.blocks, toSource, toSource) };
}

/**
 * The document's blocks to the end of input; references and footnote
 * marks resolved, headers raised where `\part` or `\chapter` went below
 * level 1.
 *
 * @see Text.Pandoc.Readers.LaTeX.parseLaTeX
 */
function parseLaTeX(ctx) {
  const bs = blocks(ctx);
  // Parsec's `eof` on Pandoc's token stream: no macro expanded first.
  if (bs === FAIL || ctx.state.input !== null) {
    throw new Error(
      `the LaTeX reader failed at offset ${ctx.state.at} (line ${ctx.state.line}, column ${ctx.state.column})`,
    );
  }
  const { meta, labels, footnoteTexts } = ctx.state.s;
  let levels = Number.POSITIVE_INFINITY;
  walk(
    {
      block: (x) => {
        if (x.t === 'Header') levels = Math.min(levels, x.c[0]);
        return x;
      },
    },
    bs,
  );
  const bottomLevel = levels === Number.POSITIVE_INFINITY ? 1 : levels;
  let out = walk({ inline: (x) => resolveRefs(labels, x) }, bs);
  out = walk({ inline: (x) => resolveFootnoteMarks(footnoteTexts, x) }, out);
  if (bottomLevel < 1) {
    const m = 1 - bottomLevel;
    out = walk(
      {
        block: (x) =>
          x.t === 'Header'
            ? new Node('Header', [x.c[0] + m, x.c[1], x.c[2]], x.start, x.end)
            : x,
      },
      out,
    );
  }
  return doc(out, meta);
}

const lookupKv = (kvs, key) => kvs.find(([k]) => k === key)?.[1];

/**
 * A `\ref` link's text, the number of the label it refers to; its spans
 * empty where the link starts.
 *
 * @see Text.Pandoc.Readers.LaTeX.resolveRefs
 * @param {Map<string, Inlines>} labels
 * @param {Node} x
 */
function resolveRefs(labels, x) {
  if (x.t !== 'Link') return x;
  const [[ident, classes, kvs]] = x.c;
  const type = lookupKv(kvs, 'reference-type');
  const lab = lookupKv(kvs, 'reference');
  if (type === undefined || type.split('+')[0] !== 'ref' || lab === undefined) {
    return x;
  }
  const txt = labels.get(lab);
  if (txt === undefined) return x;
  const at = () => x.start;
  return new Node(
    'Link',
    [[ident, classes, kvs], mapSpans(txt, at, at), [`#${lab}`, '']],
    x.start,
    x.end,
  );
}

/**
 * A `\footnotemark`'s span, the note `\footnotetext` gave its number; an
 * empty string without one.
 *
 * @see Text.Pandoc.Readers.LaTeX.resolveFootnoteMarks
 * @param {Map<number, Blocks>} fnTexts
 * @param {Node} x
 */
function resolveFootnoteMarks(fnTexts, x) {
  if (x.t !== 'Span') return x;
  const [[, classes, kvs]] = x.c;
  const numText = lookupKv(kvs, 'note-num');
  if (!classes.includes('footnote-mark') || numText === undefined) return x;
  // Haskell's `reads` of an `Int`, all of it.
  if (!/^\s*-?\d+$/.test(numText)) return x;
  const contents = fnTexts.get(Number(numText));
  return contents === undefined
    ? new Node('Str', '', x.start, x.end)
    : new Node('Note', contents, x.start, x.end);
}

// ---------------------------------------------------------------------
// Inlines

/**
 * A group's inlines, as a span: it may matter that `{C}` was braced.
 *
 * @see Text.Pandoc.Readers.LaTeX.inlineGroup
 * @type {Parser<Inlines>}
 */
function inlineGroup(ctx) {
  const start = ctx.state.at;
  const ils = groupedInlines(ctx);
  if (ils === FAIL) return FAIL;
  return ils.length === 0 ? [] : B.spanWith(nullAttr, ils, start, ctx.state.at);
}

const groupedInlines = grouped((ctx) => inline(ctx), B.concat);

const notNewline = satisfyTok((t) => !isNewlineTok(t));
const lhsVerb = manyTill(notNewline, symbol('|'));

/**
 * Literate Haskell's `|code|`, its opening `|` read.
 *
 * @see Text.Pandoc.Readers.LaTeX.doLHSverb
 */
function doLHSverb(ctx, start) {
  const toks = lhsVerb(ctx);
  if (toks === FAIL) return FAIL;
  return B.codeWith(
    ['', ['haskell'], []],
    untokenize(toks),
    start,
    ctx.state.at,
  );
}

const tokens = (p) => (ctx) => {
  const t = p(ctx);
  return t === FAIL ? FAIL : [t];
};
const sequence = (...ps) =>
  attempt((ctx) => {
    const out = [];
    for (const p of ps) {
      const t = p(ctx);
      if (t === FAIL) return FAIL;
      out.push(t);
    }
    return out;
  });
const skip = (p) => (ctx) => (p(ctx) === FAIL ? FAIL : undefined);

/**
 * “Double quotes”: ``…'', “…”, or babel's "`…"'.
 *
 * @see Text.Pandoc.Readers.LaTeX.doubleQuote
 * @type {Parser<Inlines>}
 */
const doubleQuote = alt(
  quoted(
    B.doubleQuoted,
    attempt(count(2, symbol('`'))),
    skip(attempt(count(2, symbol("'")))),
  ),
  quoted(B.doubleQuoted, tokens(symbol('“')), skip(symbol('”'))),
  quoted(
    B.doubleQuoted,
    sequence(symbol('"'), symbol('`')),
    skip(sequence(symbol('"'), symbol("'"))),
  ),
);

const startsWithLetter = (t) =>
  t.type === 'Word' && t.text !== '' && isLetter([...t.text][0]);
const notLetter = notFollowedBy(satisfyTok(startsWithLetter));
const closingQuote = (c) =>
  attempt((ctx) => (symbol(c)(ctx) === FAIL ? FAIL : notLetter(ctx)));

/**
 * ‘Single quotes’: `…' or ‘…’, the closing one before no letter.
 *
 * @see Text.Pandoc.Readers.LaTeX.singleQuote
 * @type {Parser<Inlines>}
 */
const singleQuote = alt(
  quoted(B.singleQuoted, tokens(symbol('`')), closingQuote("'")),
  quoted(B.singleQuoted, tokens(symbol('‘')), closingQuote('’')),
);

/**
 * Inlines `f` quotes, from `starter` to `ender` where `smart` is on;
 * without an `ender`, or with `smart` off, the opening quote as text.
 *
 * @see Text.Pandoc.Readers.LaTeX.quoted'
 * @param {(ils: Inlines, start: number, end: number) => Inlines} f
 * @param {Parser<Tok[]>} starter
 * @param {Parser<unknown>} ender
 * @returns {Parser<Inlines>}
 */
function quoted(f, starter, ender) {
  const notEnder = notFollowedBy(ender);
  const contents = many((ctx) => (notEnder(ctx) === FAIL ? FAIL : inline(ctx)));
  return (ctx) => {
    const start = ctx.state.at;
    const toks = starter(ctx);
    if (toks === FAIL) return FAIL;
    const startchs = untokenize(toks);
    const starterEnd = ctx.state.at;
    if (!enabled(ctx, 'smart')) return lit(startchs, start, starterEnd);
    const ils = contents(ctx);
    if (ils === FAIL) return FAIL;
    const inner = B.concat(ils);
    const at = ctx.pos;
    if (ender(ctx) !== FAIL) return f(inner, start, ctx.state.at);
    if (ctx.pos !== at) return FAIL;
    const open = startchs === '``' ? '“' : startchs === '`' ? '‘' : startchs;
    return B.join(lit(open, start, starterEnd), inner);
  };
}

/** @see Text.Pandoc.Readers.LaTeX.lit */
const lit = (t, start, end) => B.str(t, start, end);

// A token read as the inlines `f` makes of it.
const eatOne = (f) => (ctx) => {
  const t = anyTok(ctx);
  return t === FAIL ? FAIL : f(t);
};
const symbolAsString = eatOne((t) => B.str(t.text, t.start, t.end));
// Pandoc warns of a special character unescaped (`ParsingUnescaped`).
const unescapedSymbolAsString = symbolAsString;

const hyphens = (ctx) => {
  const start = ctx.state.at;
  anyTok(ctx);
  const str = (t) => B.str(t, start, ctx.state.at);
  if (symbol('-')(ctx) === FAIL) return str('-');
  if (symbol('-')(ctx) === FAIL) return str('–');
  return str('—');
};

const apostrophe = (ctx) => {
  const start = ctx.state.at;
  anyTok(ctx);
  const double = ctx.state.s.ligatures && symbol("'")(ctx) !== FAIL;
  return B.str(double ? '”' : '’', start, ctx.state.at);
};

const backtick = eatOne((t) => B.str('‘', t.start, t.end));
const quotesOr = (p) => alt(doubleQuote, singleQuote, p);
const ctrlSeqInline = alt(
  macroDef((t, start, end) => B.rawInline('latex', t, start, end)),
  inlineGroup,
  (ctx) => inlineCommandPrime(ctx),
  inlineEnvironment,
);
const escapedChar = (ctx) => {
  const start = ctx.state.at;
  const c = primEscape(ctx);
  return c === FAIL ? FAIL : B.str(c, start, ctx.state.at);
};
const lhsCode = (ctx) => {
  if (!enabled(ctx, 'literate_haskell')) return FAIL;
  const start = ctx.state.at;
  anyTok(ctx);
  return doLHSverb(ctx, start);
};

/**
 * An inline, by its first token.
 *
 * @see Text.Pandoc.Readers.LaTeX.inline
 * @type {Parser<Inlines>}
 */
export function inline(ctx) {
  const tk = peekTok(ctx);
  if (tk === FAIL) return FAIL;
  const { type, text: t } = tk;
  const { ligatures } = ctx.state.s;
  switch (type) {
    case 'Comment':
      anyTok(ctx);
      return [];
    case 'Spaces':
      anyTok(ctx);
      return B.space(tk.start, tk.end);
    case 'Newline': {
      const start = ctx.state.at;
      return endline(ctx) === FAIL ? FAIL : B.softbreak(start, ctx.state.at);
    }
    case 'Word':
      anyTok(ctx);
      return B.str(t, tk.start, tk.end);
    case 'Symbol':
      switch (t) {
        case '-':
          if (ligatures) return hyphens(ctx);
          break;
        case "'":
          return apostrophe(ctx);
        case '~':
          anyTok(ctx);
          return B.str(NBSP, tk.start, tk.end);
        case '`':
          return ligatures ? quotesOr(backtick)(ctx) : backtick(ctx);
        case '"':
          if (ligatures) return quotesOr(symbolAsString)(ctx);
          break;
        case '“':
          return alt(doubleQuote, symbolAsString)(ctx);
        case '‘':
          return alt(singleQuote, symbolAsString)(ctx);
        case '$':
          return alt(dollarsMath, unescapedSymbolAsString)(ctx);
        case '|':
          return alt(lhsCode, symbolAsString)(ctx);
        case '{':
          return inlineGroup(ctx);
        case '#':
        case '&':
        case '_':
        case '^':
          return unescapedSymbolAsString(ctx);
        case '\\':
        case '}':
          return FAIL;
      }
      return symbolAsString(ctx);
    case 'CtrlSeq':
      return ctrlSeqInline(ctx);
    case 'Esc1':
    case 'Esc2':
      return escapedChar(ctx);
    default:
      return FAIL;
  }
}

const manyInlines = many(inline);

/**
 * @see Text.Pandoc.Readers.LaTeX.inlines
 * @type {Parser<Inlines>}
 */
export function inlines(ctx) {
  const ils = manyInlines(ctx);
  return ils === FAIL ? FAIL : B.concat(ils);
}

const optToks = attempt((ctx) => {
  if (sp(ctx) === FAIL) return FAIL;
  const toks = bracketedToks(ctx);
  return toks === FAIL || sp(ctx) === FAIL ? FAIL : toks;
});

/**
 * An option in brackets, read as inlines on its own: what it leaves
 * unread is dropped, what it changes of the state too.
 *
 * @see Text.Pandoc.Readers.LaTeX.opt
 * @type {Parser<Inlines>}
 */
export function opt(ctx) {
  const toks = optToks(ctx);
  if (toks === FAIL) return FAIL;
  const sub = lpContext(
    prepend(toks, null),
    ctx.state.s,
    toks.at(-1)?.end,
    ctx.common,
  );
  const result = inlines(sub);
  if (result === FAIL) {
    throw new Error(
      `the LaTeX reader failed in an option at offset ${sub.state.at}`,
    );
  }
  return result;
}

/**
 * @see Text.Pandoc.Readers.LaTeX.tok
 * @type {Parser<Inlines>}
 */
export const tok = tokWith(inline);

// ---------------------------------------------------------------------
// Commands

/**
 * A URL with the escapes of `#$%&~_^\{}` dropped; any other backslash
 * kept.
 *
 * @see Text.Pandoc.Readers.LaTeX.unescapeURL
 * @param {string} t
 */
function unescapeURL(t) {
  const [first, ...parts] = t.split('\\');
  return (
    first +
    parts
      .map((x) => (x !== '' && '#$%&~_^\\{}'.includes(x[0]) ? x : `\\${x}`))
      .join('')
  );
}

// `p` with the ligatures of `--`, quotes and the like off.
const disableLigatures = (p) => (ctx) => {
  const old = ctx.state.s.ligatures;
  updateLaTeXState(ctx, { ligatures: false });
  const res = p(ctx);
  if (res !== FAIL) updateLaTeXState(ctx, { ligatures: old });
  return res;
};

// `p`'s inlines made into others by `f`, which spans what it makes.
const wrapping = (p, f) => (ctx, start) => {
  const ils = p(ctx);
  return ils === FAIL ? FAIL : f(ils, start, ctx.state.at);
};
// `f` applied with the spaces at either end kept outside.
const extracting = (p, f) =>
  wrapping(p, (ils, start, end) => extractSpaces(f, ils, start, end));
const classed = (cls) => (ils, start, end) =>
  B.spanWith(['', [cls], []], ils, start, end);
const code = (ils) => formatCode(nullAttr, ils);
const skipping = (p) => (ctx, start) =>
  skipopts(ctx) === FAIL ? FAIL : p(ctx, start);

const groupedBlock = grouped(
  (ctx) => block(ctx),
  (xs) => xs.flat(),
);

/**
 * A note, its number the next; labels in it name that number.
 *
 * @see Text.Pandoc.Readers.LaTeX.footnote
 * @param {object} ctx
 * @param {number} start
 */
function footnote(ctx, start) {
  updateLaTeXState(ctx, { lastNoteNum: ctx.state.s.lastNoteNum + 1 });
  const contents = noteBlocks(ctx);
  return contents === FAIL ? FAIL : B.note(contents, start, ctx.state.at);
}

// A group's blocks, their labels resolved to the current note's number.
function noteBlocks(ctx) {
  const bs = groupedBlock(ctx);
  if (bs === FAIL) return FAIL;
  return walk({ inline: (x) => resolveNoteLabel(ctx, x) }, bs);
}

/**
 * `\footnotemark[n]`: a mark for note `n`, else the next, resolved to the
 * note `\footnotetext` gives it after reading.
 *
 * @see Text.Pandoc.Readers.LaTeX.footnotemark
 * @param {object} ctx
 * @param {number} start
 */
function footnotemark(ctx, start) {
  const mbNum = optionalFootnoteNum(ctx);
  if (mbNum === FAIL) return FAIL;
  let noteNum = mbNum;
  if (noteNum === null) {
    noteNum = ctx.state.s.lastNoteNum + 1;
    updateLaTeXState(ctx, { lastNoteNum: noteNum });
  }
  const attr = ['', ['footnote-mark'], [['note-num', String(noteNum)]]];
  return B.spanWith(attr, [], start, ctx.state.at);
}

/**
 * `\footnotetext[n]{…}`: the text of note `n`, else the current one.
 *
 * @see Text.Pandoc.Readers.LaTeX.footnotetext
 * @param {object} ctx
 */
function footnotetext(ctx) {
  const mbNum = optionalFootnoteNum(ctx);
  if (mbNum === FAIL) return FAIL;
  const noteNum = mbNum ?? ctx.state.s.lastNoteNum;
  const contents = noteBlocks(ctx);
  if (contents === FAIL) return FAIL;
  const footnoteTexts = new Map(ctx.state.s.footnoteTexts).set(
    noteNum,
    contents,
  );
  updateLaTeXState(ctx, { footnoteTexts });
  return [];
}

/**
 * A note's number in brackets; null where it is no number.
 *
 * @see Text.Pandoc.Readers.LaTeX.optionalFootnoteNum
 */
const optionalFootnoteNum = option(null, (ctx) => {
  const t = bracketedToks(ctx);
  if (t === FAIL) return FAIL;
  // Haskell's `reads` of an `Int`, all of it.
  const s = untokenize(t).replace(/^\s+/, '');
  return /^-?[0-9]+$/.test(s) ? Number(BigInt.asIntN(64, BigInt(s))) : null;
});

/**
 * A label in a note: its span emptied, the note's number its text.
 *
 * @see Text.Pandoc.Readers.LaTeX.resolveNoteLabel
 * @param {object} ctx
 * @param {Node} il
 */
function resolveNoteLabel(ctx, il) {
  if (il.t !== 'Span') return il;
  const [[, cls, kvs]] = il.c;
  const lab = kvs.find(([k]) => k === 'label')?.[1];
  if (lab === undefined) return il;
  const { labels, lastNoteNum } = ctx.state.s;
  const text = B.text(String(lastNoteNum), il.start);
  updateLaTeXState(ctx, { labels: new Map(labels).set(lab, text) });
  return new Node('Span', [[lab, cls, kvs], []], il.start, il.end);
}

/**
 * `\lettrine[options]{L}{ead}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.lettrine
 * @param {object} ctx
 * @param {number} start
 */
function lettrine(ctx, start) {
  if (optional(rawopt)(ctx) === FAIL) return FAIL;
  const x = tok(ctx);
  if (x === FAIL) return FAIL;
  const mid = ctx.state.at;
  const y = tok(ctx);
  if (y === FAIL) return FAIL;
  return B.concat([
    extractSpaces(classed('lettrine'), x, start, mid),
    B.smallcaps(y, mid, ctx.state.at),
  ]);
}

const toFi = manyTill(anyTok, controlSeq('fi'));

/**
 * `\ifdim…\fi`, raw.
 *
 * @see Text.Pandoc.Readers.LaTeX.ifdim
 * @param {object} ctx
 * @param {number} start
 */
function ifdim(ctx, start) {
  const contents = toFi(ctx);
  if (contents === FAIL) return FAIL;
  const raw = `\\ifdim${untokenize(contents)}\\fi`;
  return B.rawInline('latex', raw, start, ctx.state.at);
}

/**
 * @see Text.Pandoc.Readers.LaTeX.alterStr
 * @param {(t: string) => string} f
 */
const alterStr = (f) => (x) =>
  x.t === 'Str' ? new Node('Str', f(x.c), x.start, x.end) : x;

/** @see Text.Pandoc.Readers.LaTeX.makeUppercase */
const makeUppercase = (ils) =>
  walkInlines({ inline: alterStr((t) => t.toUpperCase()) }, ils);

/** @see Text.Pandoc.Readers.LaTeX.makeLowercase */
const makeLowercase = (ils) => walkInlines({ inline: alterStr(toLower) }, ils);

/**
 * Code with the escapes of `%{}\` the LaTeX writer puts in `\passthrough`
 * dropped.
 *
 * @see Text.Pandoc.Readers.LaTeX.fixPassthroughEscapes
 */
const fixPassthroughEscapes = (ils) =>
  walkInlines(
    {
      inline: (x) =>
        x.t === 'Code'
          ? new Node(
              'Code',
              [x.c[0], x.c[1].replace(/\\([%{}\\])/g, '$1')],
              x.start,
              x.end,
            )
          : x,
    },
    ils,
  );

/**
 * `\hyperlink{target}{text}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.hyperlink
 * @param {object} ctx
 * @param {number} start
 */
function hyperlink(ctx, start) {
  return attempt((c) => {
    const src = braced(c);
    if (src === FAIL) return FAIL;
    const lab = tok(c);
    if (lab === FAIL) return FAIL;
    return B.link(`#${untokenize(src)}`, '', lab, start, c.state.at);
  })(ctx);
}

const hyperrefLabel = attempt((ctx) => {
  if (sp(ctx) === FAIL) return FAIL;
  const t = bracketedToks(ctx);
  return t === FAIL || sp(ctx) === FAIL ? FAIL : `#${untokenize(t)}`;
});
const hyperrefURL = (ctx) => {
  const url = bracedUrl(ctx);
  if (url === FAIL || bracedUrl(ctx) === FAIL || bracedUrl(ctx) === FAIL) {
    return FAIL;
  }
  return untokenize(url);
};

/**
 * `\hyperref[label]{text}`, or `\hyperref{url}{category}{name}{text}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.hyperref
 * @param {object} ctx
 * @param {number} start
 */
function hyperref(ctx, start) {
  return attempt((c) => {
    const url = alt(hyperrefLabel, hyperrefURL)(c);
    if (url === FAIL) return FAIL;
    const ils = tok(c);
    return ils === FAIL ? FAIL : B.link(url, '', ils, start, c.state.at);
  })(ctx);
}

/**
 * `\hypertarget{name}{text}`: a span with the name for identifier.
 *
 * @see Text.Pandoc.Readers.LaTeX.hypertargetInline
 * @param {object} ctx
 * @param {number} start
 */
function hypertargetInline(ctx, start) {
  return attempt((c) => {
    const ref = braced(c);
    if (ref === FAIL) return FAIL;
    const ils = tok(c);
    if (ils === FAIL) return FAIL;
    return B.spanWith([untokenize(ref), [], []], ils, start, c.state.at);
  })(ctx);
}

/**
 * `\newtoggle{name}`: a toggle, off.
 *
 * @see Text.Pandoc.Readers.LaTeX.newToggle
 * @param {object} ctx
 */
function newToggle(ctx) {
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const toggles = new Map(ctx.state.s.toggles).set(untokenize(name), false);
  updateLaTeXState(ctx, { toggles });
  return [];
}

/**
 * `\toggletrue{name}` or `\togglefalse{name}`, for a toggle defined.
 *
 * @see Text.Pandoc.Readers.LaTeX.setToggle
 * @param {boolean} on
 */
const setToggle = (on) => (ctx) => {
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const key = untokenize(name);
  if (ctx.state.s.toggles.has(key)) {
    updateLaTeXState(ctx, {
      toggles: new Map(ctx.state.s.toggles).set(key, on),
    });
  }
  return [];
};

const verbatimBraced = withVerbatimMode(braced);

/**
 * `\iftoggle{name}{yes}{no}`: the branch the toggle takes, put back to
 * read; neither for a toggle not defined.
 *
 * @see Text.Pandoc.Readers.LaTeX.ifToggle
 * @param {object} ctx
 */
function ifToggle(ctx) {
  const name = braced(ctx);
  if (name === FAIL || spaces(ctx) === FAIL) return FAIL;
  const yes = verbatimBraced(ctx);
  if (yes === FAIL || spaces(ctx) === FAIL) return FAIL;
  const no = verbatimBraced(ctx);
  if (no === FAIL) return FAIL;
  const on = ctx.state.s.toggles.get(untokenize(name));
  // Pandoc warns of a toggle not defined (`UndefinedToggle`).
  if (on !== undefined) {
    setInput(ctx, prepend(on ? yes : no, ctx.state.input), false);
  }
  return undefined;
}

/**
 * A span styled `stylename: color`.
 *
 * @see Text.Pandoc.Readers.LaTeX.coloredInline
 * @param {string} stylename
 */
const coloredInline = (stylename) => (ctx, start) => {
  if (skipopts(ctx) === FAIL) return FAIL;
  const color = braced(ctx);
  if (color === FAIL) return FAIL;
  const ils = tok(ctx);
  if (ils === FAIL) return FAIL;
  const attr = ['', [], [['style', `${stylename}: ${untokenize(color)}`]]];
  return B.spanWith(attr, ils, start, ctx.state.at);
};

/**
 * A box's spaces unbreakable, its line breaks gone.
 *
 * @see Text.Pandoc.Readers.LaTeX.processHBox
 */
const processHBox = (ils) =>
  walkInlines(
    {
      inline: (x) => {
        if (x.t === 'Space' || x.t === 'SoftBreak') {
          return new Node('Str', NBSP, x.start, x.end);
        }
        return x.t === 'LineBreak' ? new Node('Str', '', x.start, x.end) : x;
      },
    },
    ils,
  );

const tokThen = (f) => wrapping((ctx) => tok(ctx), f);
const inlinesThen = (f) => wrapping((ctx) => inlines(ctx), f);
const urlArg = (ctx) => {
  const url = bracedUrl(ctx);
  return url === FAIL ? FAIL : unescapeURL(untokenize(url));
};

// The entries of `LaTeX.hs`'s own table.
const REST_COMMANDS = [
  ['emph', extracting((ctx) => tok(ctx), B.emph)],
  ['textit', extracting((ctx) => tok(ctx), B.emph)],
  ['textsl', extracting((ctx) => tok(ctx), B.emph)],
  ['textsc', extracting((ctx) => tok(ctx), B.smallcaps)],
  ['textsf', extracting((ctx) => tok(ctx), classed('sans-serif'))],
  ['textmd', extracting((ctx) => tok(ctx), classed('medium'))],
  ['textrm', extracting((ctx) => tok(ctx), classed('roman'))],
  ['textup', extracting((ctx) => tok(ctx), classed('upright'))],
  [
    'texttt',
    wrapping(
      disableLigatures((ctx) => tok(ctx)),
      code,
    ),
  ],
  ['alert', skipping(tokThen(classed('alert')))], // beamer
  ['textsuperscript', extracting((ctx) => tok(ctx), B.superscript)],
  ['textsubscript', extracting((ctx) => tok(ctx), B.subscript)],
  ['textbf', extracting((ctx) => tok(ctx), B.strong)],
  ['textnormal', extracting((ctx) => tok(ctx), classed('nodecor'))],
  ['underline', tokThen(B.underline)],
  ['mbox', rawInlineOr('mbox', tokThen(processHBox))],
  ['hbox', rawInlineOr('hbox', tokThen(processHBox))],
  [
    'vbox',
    rawInlineOr(
      'vbox',
      tokThen((ils) => ils),
    ),
  ],
  ['lettrine', rawInlineOr('lettrine', lettrine)],
  ['(', mathUntil(')', mathInline)],
  ['[', mathUntil(']', mathDisplay)],
  [
    'ensuremath',
    (ctx, start) => {
      const toks = withMathMode(braced)(ctx);
      return toks === FAIL
        ? FAIL
        : mathInline(untokenize(toks), start, ctx.state.at);
    },
  ],
  [
    'texorpdfstring',
    (ctx) => {
      const x = tok(ctx);
      return x === FAIL || tok(ctx) === FAIL ? FAIL : x;
    },
  ],
  // old TeX commands
  ['em', extracting((ctx) => inlines(ctx), B.emph)],
  ['it', extracting((ctx) => inlines(ctx), B.emph)],
  ['sl', extracting((ctx) => inlines(ctx), B.emph)],
  ['bf', extracting((ctx) => inlines(ctx), B.strong)],
  ['tt', inlinesThen(code)],
  ['rm', (ctx) => inlines(ctx)],
  ['itshape', extracting((ctx) => inlines(ctx), B.emph)],
  ['slshape', extracting((ctx) => inlines(ctx), B.emph)],
  ['scshape', extracting((ctx) => inlines(ctx), B.smallcaps)],
  ['bfseries', extracting((ctx) => inlines(ctx), B.strong)],
  ['MakeUppercase', tokThen(makeUppercase)],
  ['MakeTextUppercase', tokThen(makeUppercase)], // textcase
  ['uppercase', tokThen(makeUppercase)],
  ['MakeLowercase', tokThen(makeLowercase)],
  ['MakeTextLowercase', tokThen(makeLowercase)],
  ['lowercase', tokThen(makeLowercase)],
  [
    'thanks',
    skipping((ctx, start) => {
      const bs = groupedBlock(ctx);
      return bs === FAIL ? FAIL : B.note(bs, start, ctx.state.at);
    }),
  ],
  ['footnote', skipping(footnote)],
  ['footnotemark', footnotemark],
  ['footnotetext', footnotetext],
  ['newline', (ctx, start) => B.linebreak(start, ctx.state.at)],
  ['passthrough', tokThen(fixPassthroughEscapes)],
  // \passthrough macro used by latex writer for listings
  ['includegraphics', includegraphics],
  // svg
  ['includesvg', includegraphics],
  // hyperref
  [
    'url',
    (ctx, start) => {
      const url = urlArg(ctx);
      if (url === FAIL) return FAIL;
      const end = ctx.state.at;
      const text = B.str(url, start, end);
      return B.linkWith(['', ['uri'], []], url, '', text, start, end);
    },
  ],
  [
    'nolinkurl',
    (ctx, start) => {
      const url = urlArg(ctx);
      return url === FAIL ? FAIL : B.code(url, start, ctx.state.at);
    },
  ],
  [
    'href',
    (ctx, start) => {
      const url = urlArg(ctx);
      if (url === FAIL || sp(ctx) === FAIL) return FAIL;
      const ils = tok(ctx);
      return ils === FAIL ? FAIL : B.link(url, '', ils, start, ctx.state.at);
    },
  ],
  ['hyperlink', hyperlink],
  ['hyperref', hyperref],
  ['hypertarget', hypertargetInline],
  // hyphenat
  ['nohyphens', (ctx) => tok(ctx)],
  ['textnhtt', tokThen(code)],
  ['nhttfamily', tokThen(code)],
  // LaTeX colors
  ['textcolor', coloredInline('color')],
  ['colorbox', coloredInline('background-color')],
  // etoolbox
  ['newtoggle', newToggle],
  ['toggletrue', setToggle(true)],
  ['togglefalse', setToggle(false)],
  ['iftoggle', attempt((ctx) => (ifToggle(ctx) === FAIL ? FAIL : inline(ctx)))],
  // include
  ['input', rawInlineOr('input', include('input'))],
  // soul package
  ['st', extracting((ctx) => tok(ctx), B.strikeout)],
  ['ul', tokThen(B.underline)],
  ['hl', extracting((ctx) => tok(ctx), classed('mark'))],
  // ulem package
  ['sout', extracting((ctx) => tok(ctx), B.strikeout)],
  ['uline', tokThen(B.underline)],
  // plain tex stuff that should just be passed through as raw tex
  ['ifdim', ifdim],
  // generally only used in \date
  ['today', today],
  // this is used internally by pandoc but the definition is too complicated
  // for pandoc to handle (see #11140):
  ['pandocbounded', (ctx) => tok(ctx)],
];

// ---------------------------------------------------------------------
// Files and the clock, through the host's hooks

/**
 * A file name's extension, its dot included; none for none.
 *
 * @see System.FilePath.takeExtension
 * @param {string} fp
 */
function takeExtension(fp) {
  const name = fp.slice(fp.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

/**
 * @see System.FilePath.addExtension
 * @param {string} fp
 * @param {string} ext
 */
const addExtension = (fp, ext) =>
  ext === '' ? fp : ext.startsWith('.') ? fp + ext : `${fp}.${ext}`;

/**
 * @see System.FilePath.</>
 * @param {string} dir
 * @param {string} fp
 */
const joinPath = (dir, fp) =>
  fp.startsWith('/') ? fp : dir.endsWith('/') ? dir + fp : `${dir}/${fp}`;

/**
 * `fp`, with `defaultExt` added where its own extension is not allowed.
 *
 * @see Text.Pandoc.Readers.LaTeX.ensureExtension
 * @param {(ext: string) => boolean} isAllowed
 * @param {string} defaultExt
 * @param {string} fp
 */
const ensureExtension = (isAllowed, defaultExt, fp) =>
  isAllowed(takeExtension(fp)) ? fp : addExtension(fp, defaultExt);

/** @see Text.Pandoc.Readers.LaTeX.removeDoubleQuotes */
const removeDoubleQuotes = (t) =>
  t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;

// Haskell's `T.strip`.
const strip = (t) => {
  const cs = [...t];
  let [from, to] = [0, cs.length];
  while (from < to && isSpace(cs[from])) from++;
  while (to > from && isSpace(cs[to - 1])) to--;
  return cs.slice(from, to).join('');
};

const isCommentTok = (t) => t.type === 'Comment';

/**
 * A braced file name: comments dropped, spaces and double quotes around
 * it too.
 *
 * @see Text.Pandoc.Readers.LaTeX.bracedFilename
 * @param {object} ctx
 */
function bracedFilename(ctx) {
  const t = braced(ctx);
  if (t === FAIL) return FAIL;
  return removeDoubleQuotes(
    strip(untokenize(t.filter((x) => !isCommentTok(x)))),
  );
}

// Braced file names separated by commas.
function bracedFilenames(ctx) {
  const t = braced(ctx);
  if (t === FAIL) return FAIL;
  return untokenize(t.filter((x) => !isCommentTok(x)))
    .split(',')
    .map((f) => removeDoubleQuotes(strip(f)));
}

// A file's text as Pandoc decodes it: its byte order mark and carriage
// returns dropped.
// @see Text.Pandoc.UTF8.toText
const toText = (t) => t.replace(/^﻿/, '').replaceAll('\r', '');

/**
 * A file's text: one `filecontents` gave, else the first found in the
 * directories `TEXINPUTS` names, the current one by default.
 *
 * @see Text.Pandoc.Readers.LaTeX.readFileFromTexinputs
 * @see Text.Pandoc.Class.PandocMonad.readFileFromDirs
 * @param {object} ctx
 * @param {string} fp
 * @returns {string | null}
 */
function readFileFromTexinputs(ctx, fp) {
  const given = ctx.state.s.fileContents.get(fp);
  if (given !== undefined) return given;
  const { host } = ctx.common;
  const dirs = (host.env('TEXINPUTS') ?? '')
    .split(':')
    .map((t) => (t === '' ? '.' : t));
  for (const dir of dirs) {
    const text = host.readFile(joinPath(dir, fp));
    if (text !== null) return toText(text);
  }
  return null;
}

/**
 * A file's tokens, read in at `at`: from that file, spanning nothing
 * there, as an expansion does. A file including itself while it is read
 * is a loop.
 *
 * @see Text.Pandoc.Readers.LaTeX.getIncludedToks
 * @param {object} ctx
 * @param {string} f
 * @param {number} start
 * @returns {Tok[]}
 */
function getIncludedToks(ctx, f, at) {
  if (ctx.state.s.containers.includes(f)) {
    throw new Error(`Include file loop at offset ${ctx.state.at}`);
  }
  updateLaTeXState(ctx, { containers: [f, ...ctx.state.s.containers] });
  // Pandoc warns of a file it cannot load (`CouldNotLoadIncludeFile`).
  const contents = readFileFromTexinputs(ctx, f) ?? '';
  updateLaTeXState(ctx, { containers: ctx.state.s.containers.slice(1) });
  return [...tokenize(contents)].map((t) => ({
    ...t,
    source: f,
    start: at,
    end: at,
  }));
}

/**
 * A file's tokens before the input, where it is.
 *
 * @see Text.Pandoc.Readers.LaTeX.insertIncluded
 * @param {object} ctx
 * @param {string} f
 */
function insertIncluded(ctx, f) {
  const toks = getIncludedToks(ctx, f, ctx.state.at);
  setInput(ctx, prepend(toks, ctx.state.input), false);
}

const skipOpts = skipMany((ctx) => opt(ctx));

/**
 * `\input{a,b}` or `\include{a}`: the files read in its place, `.tex`
 * added where the extension is not one it takes.
 *
 * @see Text.Pandoc.Readers.LaTeX.include
 * @param {string} name
 */
function include(name) {
  const isAllowed =
    name === 'include'
      ? (ext) => ext === '.tex'
      : name === 'input'
        ? (ext) => ext !== ''
        : () => false;
  return (ctx) => {
    if (skipOpts(ctx) === FAIL) return FAIL;
    const fs = bracedFilenames(ctx);
    if (fs === FAIL) return FAIL;
    for (const f of fs)
      insertIncluded(ctx, ensureExtension(isAllowed, '.tex', f));
    return [];
  };
}

/**
 * The command raw where `raw_tex` is on, else `fallback`.
 *
 * @see Text.Pandoc.Readers.LaTeX.rawBlockOr
 * @param {string} name
 * @param {(ctx: object, start: number) => Blocks | typeof FAIL} fallback
 */
function rawBlockOr(name, fallback) {
  const raw = getRawCommand(name, `\\${name}`);
  return (ctx, start) => {
    if (!enabled(ctx, 'raw_tex')) return fallback(ctx, start);
    const t = raw(ctx);
    return t === FAIL ? FAIL : B.rawBlock('latex', t, start, ctx.state.at);
  };
}

/**
 * `\subfile{f}`: the file's blocks, to its end.
 *
 * @see Text.Pandoc.Readers.LaTeX.doSubfile
 * @param {object} ctx
 */
function doSubfile(ctx) {
  if (skipOpts(ctx) === FAIL) return FAIL;
  const f = bracedFilename(ctx);
  if (f === FAIL) return FAIL;
  const { input, expanded } = ctx.state;
  setInput(ctx, null, false);
  insertIncluded(
    ctx,
    ensureExtension((ext) => ext !== '', '.tex', f),
  );
  const bs = blocks(ctx);
  if (bs === FAIL || ctx.state.input !== null) return FAIL;
  setInput(ctx, input, expanded);
  return bs;
}

/**
 * `\usepackage{p}`: a local `p.sty` read for its macros.
 *
 * @see Text.Pandoc.Readers.LaTeX.usepackage
 * @param {object} ctx
 */
function usepackage(ctx) {
  if (skipOpts(ctx) === FAIL) return FAIL;
  const fs = bracedFilenames(ctx);
  if (fs === FAIL) return FAIL;
  for (const f of fs) {
    const sty = ensureExtension((ext) => ext === '.sty', '.sty', f);
    const ts = getIncludedToks(ctx, sty, ctx.state.at);
    // Pandoc warns of a package it cannot read to its end
    // (`CouldNotParseIncludeFile`).
    if (parseFromToks(blocks, ts)(ctx) === FAIL) return FAIL;
  }
  return [];
}

const IMAGE_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.mps',
  '.jpeg',
  '.jbig2',
  '.jb2',
];
const RELATIVE_UNITS = new Set(['\\textwidth', '\\linewidth', '\\textheight']);

/**
 * An image of `src`: its width and height, relative ones as percentages,
 * and its alt text; an extension found for it where it has none.
 *
 * @see Text.Pandoc.Readers.LaTeX.mkImage
 * @param {object} ctx
 * @param {[string, string][]} options
 * @param {string} src
 * @param {number} start
 */
function mkImage(ctx, options, src, start) {
  const replaceRelative = ([k, v]) => {
    const nu = numUnit(v);
    return nu !== null && RELATIVE_UNITS.has(nu[1])
      ? [k, `${showFl(nu[0] * 100)}%`]
      : [k, v];
  };
  const kvs = options
    .filter(([k]) => k === 'width' || k === 'height')
    .map(replaceRelative);
  const altText = options.find(([k]) => k === 'alt')?.[1] ?? 'image';
  const { defaultImageExtension } = ctx.state.s.options;
  let src2 = src;
  if (takeExtension(src) === '') {
    if (defaultImageExtension !== '') {
      src2 = addExtension(src, defaultImageExtension);
    } else {
      const exts = [
        ...IMAGE_EXTENSIONS,
        ...IMAGE_EXTENSIONS.map((e) => e.toUpperCase()),
      ];
      const found = exts
        .map((e) => addExtension(src, e))
        .find((s2) => ctx.common.host.fileExists(s2));
      if (found !== undefined) src2 = found;
    }
  }
  const end = ctx.state.at;
  return B.imageWith(
    ['', [], kvs],
    src2,
    '',
    B.str(altText, start, start),
    start,
    end,
  );
}

const imageOptions = option([], keyvals);

/**
 * `\includegraphics[options]{file}`, and `\includesvg`.
 *
 * @see Text.Pandoc.Readers.LaTeX.inlineCommands
 * @param {object} ctx
 * @param {number} start
 */
function includegraphics(ctx, start) {
  const options = imageOptions(ctx);
  if (options === FAIL) return FAIL;
  const src = bracedFilename(ctx);
  if (src === FAIL) return FAIL;
  return mkImage(ctx, options, unescapeURL(src), start);
}

/**
 * `\today`: the date, as the host's clock gives it.
 *
 * @see Text.Pandoc.Readers.LaTeX.today
 * @param {object} ctx
 * @param {number} start
 */
function today(ctx, start) {
  const d = ctx.common.host.now();
  const pad = (n, w) => String(n).padStart(w, '0');
  const t = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  return B.str(t, start, ctx.state.at);
}

/**
 * `\inputminted{language}{file}`: the file as code.
 *
 * @see Text.Pandoc.Readers.LaTeX.inputMinted
 * @param {object} ctx
 * @param {number} start
 */
function inputMinted(ctx, start) {
  const attr = mintedAttr(ctx);
  if (attr === FAIL) return FAIL;
  const f = braced(ctx);
  if (f === FAIL) return FAIL;
  // Pandoc warns of a file it cannot load (`CouldNotLoadIncludeFile`).
  const code =
    readFileFromTexinputs(ctx, untokenize(f).replaceAll('"', '')) ?? '';
  return B.codeBlockWith(attr, code, start, ctx.state.at);
}

const graphicsDirs = (ctx) => {
  if (bgroup(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  return manyTill((c) => {
    const t = braced(c);
    return t === FAIL || spaces(c) === FAIL ? FAIL : untokenize(t);
  }, egroup)(ctx);
};

/**
 * `\graphicspath{{dir/}…}`: directories added to the resource path.
 *
 * @see Text.Pandoc.Readers.LaTeX.graphicsPath
 * @param {object} ctx
 */
function graphicsPath(ctx) {
  const ps = graphicsDirs(ctx);
  if (ps === FAIL) return FAIL;
  ctx.common.resourcePath = [...ctx.common.resourcePath, ...ps];
  return [];
}

const UNNUMBERED = ['', ['unnumbered'], []];

/**
 * Inline commands, by name: each reads what follows the command, which
 * starts at `start`. Haskell's `M.unions` keeps the first map's entry for
 * a name: each map here overrides those before it.
 *
 * @see Text.Pandoc.Readers.LaTeX.inlineCommands
 * @type {Map<string, (ctx: object, start: number) => Inlines | typeof FAIL>}
 */
const INLINE_COMMANDS = new Map([
  ...REST_COMMANDS,
  ...biblatexInlineCommands(tok),
  ...inlineLanguageCommands(tok),
  ...enquoteCommands(tok),
  ...charCommands,
  ...verbCommands,
  ...nameCommands,
  ...refCommands,
  ...acronymCommands,
  ...siunitxCommands(tok),
  ...citationCommands(inline),
  ...miscCommands,
  ...accentCommands(tok),
]);

function mathUntil(close, f) {
  const p = withMathMode(manyTill(anyTok, controlSeq(close)));
  return (ctx, start) => {
    const toks = p(ctx);
    return toks === FAIL ? FAIL : f(untokenize(toks), start, ctx.state.at);
  };
}

/**
 * Block commands, by name: each reads what follows the command, which
 * starts at `start`.
 *
 * @see Text.Pandoc.Readers.LaTeX.blockCommands
 * @type {Map<string, (ctx: object, start: number) => Blocks | typeof FAIL>}
 */
const BLOCK_COMMANDS = new Map([
  ['par', (ctx) => (skipopts(ctx) === FAIL ? FAIL : [])],
  ['parbox', parbox],
  ['title', title],
  ['subtitle', metaTok('subtitle')],
  ['author', (ctx) => (skipopts(ctx) === FAIL ? FAIL : authors(ctx))],
  // -- in letter class, temp. store address & sig as title, author
  ['address', metaTok('address')],
  ['signature', (ctx) => (skipopts(ctx) === FAIL ? FAIL : authors(ctx))],
  ['date', metaTok('date')],
  ['newtheorem', newtheorem],
  ['theoremstyle', theoremstyle],
  // KOMA-Script metadata commands
  ['extratitle', metaTok('extratitle')],
  ['frontispiece', metaTok('frontispiece')],
  ['titlehead', metaTok('titlehead')],
  ['subject', metaTok('subject')],
  ['publishers', metaTok('publishers')],
  ['uppertitleback', metaTok('uppertitleback')],
  ['lowertitleback', metaTok('lowertitleback')],
  ['dedication', metaTok('dedication')],
  // sectioning
  ['part', section(nullAttr, -1)],
  ['part*', section(UNNUMBERED, -1)],
  ['chapter', section(nullAttr, 0)],
  ['chapter*', section(UNNUMBERED, 0)],
  ['section', section(nullAttr, 1)],
  ['section*', section(UNNUMBERED, 1)],
  ['subsection', section(nullAttr, 2)],
  ['subsection*', section(UNNUMBERED, 2)],
  ['subsubsection', section(nullAttr, 3)],
  ['subsubsection*', section(UNNUMBERED, 3)],
  ['paragraph', section(nullAttr, 4)],
  ['paragraph*', section(UNNUMBERED, 4)],
  ['subparagraph', section(nullAttr, 5)],
  ['subparagraph*', section(UNNUMBERED, 5)],
  ['minisec', section(['', ['unnumbered', 'unlisted'], []], 6)], // from KOMA
  // beamer slides
  ['frametitle', section(nullAttr, 3)],
  ['framesubtitle', section(nullAttr, 4)],
  // letters
  ['opening', centered],
  [
    'closing',
    (ctx, start) => (skipopts(ctx) === FAIL ? FAIL : closing(ctx, start)),
  ],
  // memoir
  ['plainbreak', bracedRule(1)],
  ['plainbreak*', bracedRule(1)],
  ['fancybreak', bracedRule(1)],
  ['fancybreak*', bracedRule(1)],
  ['plainfancybreak', bracedRule(3)],
  ['plainfancybreak*', bracedRule(3)],
  ['pfbreak', bracedRule(0)],
  ['pfbreak*', bracedRule(0)],
  //
  ['hrule', bracedRule(0)],
  ['strut', () => []],
  ['rule', rule],
  ['item', looseItem],
  [
    'documentclass',
    (ctx) =>
      skipopts(ctx) === FAIL || braced(ctx) === FAIL ? FAIL : preamble(ctx),
  ],
  ['centerline', centered],
  [
    'caption',
    (ctx) => (setCaption((c) => inline(c))(ctx) === FAIL ? FAIL : []),
  ],
  ['bibliography', bibliography],
  ['addbibresource', bibliography],
  ['endinput', skipSameFileToks],
  // includes
  // Not ported yet: `\lstinputlisting`, which takes a language from
  // skylighting's syntax definitions.
  ['inputminted', inputMinted],
  ['graphicspath', graphicsPath],
  // polyglossia
  ['setdefaultlanguage', setDefaultLanguage],
  ['setmainlanguage', setDefaultLanguage],
  // hyperlink
  ['hypertarget', hypertargetBlock],
  // LaTeX colors
  ['textcolor', coloredBlock('color')],
  ['colorbox', coloredBlock('background-color')],
  // csquotes
  ['blockquote', blockquote(false, null)],
  ['blockcquote', blockquote(true, null)],
  ['foreignblockquote', foreignBlockquote(false)],
  ['foreignblockcquote', foreignBlockquote(true)],
  ['hyphenblockquote', foreignBlockquote(false)],
  ['hyphenblockcquote', foreignBlockquote(true)],
  // include
  ['include', rawBlockOr('include', include('include'))],
  ['input', rawBlockOr('input', include('input'))],
  ['subfile', rawBlockOr('subfile', doSubfile)],
  ['usepackage', rawBlockOr('usepackage', usepackage)],
  // preamble
  [
    'PackageError',
    (ctx) =>
      braced(ctx) === FAIL || braced(ctx) === FAIL || braced(ctx) === FAIL
        ? FAIL
        : [],
  ],
  // epigraph package
  ['epigraph', epigraph],
  // alignment
  ['raggedright', () => []],
  // etoolbox
  ['newtoggle', newToggle],
  ['toggletrue', setToggle(true)],
  ['togglefalse', setToggle(false)],
  ['iftoggle', attempt((ctx) => (ifToggle(ctx) === FAIL ? FAIL : block(ctx)))],
]);

/**
 * Environments, by name: each reads what follows `\begin{name}`, which
 * starts at `start`.
 *
 * @see Text.Pandoc.Readers.LaTeX.environments
 * @type {Map<string, (ctx: object, start: number) => Blocks | typeof FAIL>}
 */
const ENVIRONMENTS = new Map([
  ['document', documentEnv],
  ['abstract', abstractEnv],
  ['sloppypar', envOf('sloppypar', (ils) => ils)],
  ['letter', (ctx) => env('letter', letterContents)(ctx)],
  ['minipage', minipage],
  ['figure', (ctx, start) => figureEnv('figure', false)(ctx, start)],
  ['figure*', (ctx, start) => figureEnv('figure*', false)(ctx, start)],
  ['subfigure', (ctx, start) => figureEnv('subfigure', true)(ctx, start)],
  [
    'center',
    envOf('center', (bs, start, end) =>
      B.divWith(['', ['center'], []], bs, start, end),
    ),
  ],
  ['quote', envOf('quote', B.blockQuote)],
  ['quotation', envOf('quotation', B.blockQuote)],
  ['verse', envOf('verse', B.blockQuote)],
  [
    'itemize',
    (ctx, start) => listOf('itemize', B.bulletList, item)(ctx, start),
  ],
  [
    'description',
    (ctx, start) =>
      listOf('description', B.definitionList, descItem)(ctx, start),
  ],
  ['enumerate', (ctx, start) => orderedListEnv(ctx, start)],
  ['alltt', envOf('alltt', (bs) => alltt(bs))],
  [
    'code',
    (ctx, start) => {
      if (!enabled(ctx, 'literate_haskell')) return FAIL;
      const code = verbEnv('code')(ctx);
      if (code === FAIL) return FAIL;
      const attr = ['', ['haskell', 'literate'], []];
      return B.codeBlockWith(attr, code, start, ctx.state.at);
    },
  ],
  ['comment', (ctx) => (verbEnv('comment')(ctx) === FAIL ? FAIL : [])],
  [
    'verbatim',
    (ctx, start) => {
      const code = verbEnv('verbatim')(ctx);
      return code === FAIL ? FAIL : B.codeBlock(code, start, ctx.state.at);
    },
  ],
  ['Verbatim', (ctx, start) => fancyverbEnv('Verbatim')(ctx, start)],
  ['BVerbatim', (ctx, start) => fancyverbEnv('BVerbatim')(ctx, start)],
  ['lstlisting', (ctx, start) => lstlisting(ctx, start)],
  ['minted', (ctx, start) => minted(ctx, start)],
  ['obeylines', (ctx, start) => obeylines(ctx, start)],
  ['tikzpicture', (ctx, start) => rawVerbEnv('tikzpicture', start)(ctx)],
  ['tikzcd', (ctx, start) => rawVerbEnv('tikzcd', start)(ctx)],
  ['lilypond', (ctx, start) => rawVerbEnv('lilypond', start)(ctx)],
  ['ly', (ctx, start) => rawVerbEnv('ly', start)(ctx)],
  // amsthm
  ['proof', proof(blocks, opt)],
  // other
  [
    'CSLReferences',
    (ctx) =>
      braced(ctx) === FAIL || braced(ctx) === FAIL
        ? FAIL
        : env('CSLReferences', blocks)(ctx),
  ],
  ['otherlanguage', otherlanguageEnv],
  // Haskell's `M.union` keeps the table environments' entries.
  ...tableEnvironments(
    (ctx) => block(ctx),
    (ctx) => inline(ctx),
  ),
]);

/**
 * `\title{…}`: the title's inlines in the metadata, else its blocks.
 *
 * @see Text.Pandoc.Readers.LaTeX.blockCommands
 * @param {object} ctx
 */
function title(ctx) {
  return alt(
    (c) => {
      if (skipopts(c) === FAIL) return FAIL;
      const ils = groupedInlines(c);
      if (ils === FAIL) return FAIL;
      addMeta(c, 'title', B.metaInlines(ils));
      return [];
    },
    (c) => {
      const bs = groupedBlock(c);
      if (bs === FAIL) return FAIL;
      addMeta(c, 'title', B.metaBlocks(bs));
      return [];
    },
  )(ctx);
}

/**
 * A metadata command: its argument's inlines into the metadata at `field`.
 *
 * @see Text.Pandoc.Readers.LaTeX.blockCommands
 * @param {string} field
 */
function metaTok(field) {
  return (ctx) => {
    if (skipopts(ctx) === FAIL) return FAIL;
    const ils = tok(ctx);
    if (ils === FAIL) return FAIL;
    addMeta(ctx, field, B.metaInlines(ils));
    return [];
  };
}

const andSeparator = controlSeq('and');

/**
 * `\author{A \and B}`: each author's blocks squashed into inlines, into
 * the metadata.
 *
 * @see Text.Pandoc.Readers.LaTeX.authors
 * @param {object} ctx
 */
function authors(ctx) {
  const oneAuthor = (c) => {
    const bs = many1((d) => block(d))(c);
    return bs === FAIL ? FAIL : blocksToInlines(bs.flat());
  };
  return attempt((c) => {
    if (bgroup(c) === FAIL) return FAIL;
    const auths = sepBy(oneAuthor, andSeparator)(c);
    if (auths === FAIL || egroup(c) === FAIL) return FAIL;
    const value = {
      t: 'MetaList',
      c: auths.map((a) => B.metaInlines(B.trimInlines(a))),
    };
    addMeta(c, 'author', value);
    return [];
  })(ctx);
}

/**
 * An item outside a list: nothing.
 *
 * @see Text.Pandoc.Readers.LaTeX.looseItem
 * @param {object} ctx
 */
function looseItem(ctx) {
  if (ctx.state.s.inListItem) return FAIL;
  return skipopts(ctx) === FAIL ? FAIL : [];
}

/**
 * `\epigraph{quote}{source}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.epigraph
 * @param {object} ctx
 * @param {number} start
 */
function epigraph(ctx, start) {
  const p1 = groupedBlock(ctx);
  if (p1 === FAIL) return FAIL;
  const p2 = groupedBlock(ctx);
  if (p2 === FAIL) return FAIL;
  return B.divWith(['', ['epigraph'], []], [...p1, ...p2], start, ctx.state.at);
}

const sectionLabel = attempt((ctx) => {
  if (spaces(ctx) === FAIL || controlSeq('label')(ctx) === FAIL) return FAIL;
  if (spaces(ctx) === FAIL) return FAIL;
  const t = braced(ctx);
  return t === FAIL ? FAIL : untokenize(t);
});

/**
 * A sectioning command at level `lvl`: numbered unless `unnumbered`, its
 * number the label's text, which follows it or is its identifier.
 *
 * @see Text.Pandoc.Readers.LaTeX.section
 * @param {[string, string[], [string, string][]]} attr
 * @param {number} lvl
 */
function section([ident, classes, kvs], lvl) {
  return (ctx, start) => {
    if (skipopts(ctx) === FAIL) return FAIL;
    const contents = groupedInlines(ctx);
    if (contents === FAIL) return FAIL;
    const lab = option(ident, sectionLabel)(ctx);
    if (lab === FAIL) return FAIL;
    if (lvl === 0) updateLaTeXState(ctx, { hasChapters: true });
    if (!classes.includes('unnumbered')) {
      const { lastHeaderNum, hasChapters, labels } = ctx.state.s;
      const num = incrementDottedNum(
        lvl + (hasChapters ? 1 : 0),
        lastHeaderNum,
      );
      updateLaTeXState(ctx, {
        lastHeaderNum: num,
        labels: new Map(labels).set(
          lab,
          B.str(renderDottedNum(num), start, start),
        ),
      });
    }
    const attr = registerHeader(ctx, [lab, classes, kvs], contents);
    return B.headerWith(attr, lvl, contents, start, ctx.state.at);
  };
}

// A paragraph of an argument, trimmed: `\opening` and `\centerline`.
function centered(ctx, start) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const ils = tok(ctx);
  if (ils === FAIL) return FAIL;
  return B.para(B.trimInlines(ils), start, ctx.state.at);
}

// An author's inlines, where they are blocks of one paragraph.
function extractInlines(value) {
  if (value.t !== 'MetaBlocks' || value.c.length !== 1) return [];
  const [b] = value.c;
  return b.t === 'Plain' || b.t === 'Para' ? b.c : [];
}

/**
 * A letter's `\closing{…}`, the authors' signatures after it.
 *
 * @see Text.Pandoc.Readers.LaTeX.closing
 * @param {object} ctx
 * @param {number} start
 */
function closing(ctx, start) {
  const contents = tok(ctx);
  if (contents === FAIL) return FAIL;
  const end = ctx.state.at;
  const author = ctx.state.s.meta.author;
  let sigs = [];
  if (author?.t === 'MetaList') {
    const lines = author.c
      .map(extractInlines)
      .flatMap((x, k) =>
        k === 0 ? x : [new Node('LineBreak', undefined, end, end), ...x],
      );
    // Made from the metadata: no text here.
    sigs = mapSpans(
      B.para(B.trimInlines(lines), end, end),
      () => end,
      () => end,
    );
  }
  return [...B.para(B.trimInlines(contents), start, end), ...sigs];
}

/**
 * `\parbox[pos]{width}{…}`: its blocks, read as outside a table cell.
 *
 * @see Text.Pandoc.Readers.LaTeX.parbox
 * @param {object} ctx
 */
function parbox(ctx) {
  return attempt((c) => {
    if (skipopts(c) === FAIL || braced(c) === FAIL) return FAIL;
    const old = c.state.s.inTableCell;
    // see #5711
    updateLaTeXState(c, { inTableCell: false });
    const res = groupedBlock(c);
    if (res === FAIL) return FAIL;
    updateLaTeXState(c, { inTableCell: old });
    return res;
  })(ctx);
}

/**
 * `\rule[raise]{width}{thickness}`: a horizontal rule, but of width 0,
 * which fixes spacing.
 *
 * @see Text.Pandoc.Readers.LaTeX.rule
 * @param {object} ctx
 * @param {number} start
 */
function rule(ctx, start) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const w = tok(ctx);
  if (w === FAIL) return FAIL;
  const width = /^[0-9.]*/.exec(stringify(w))[0];
  if (tok(ctx) === FAIL) return FAIL;
  // 0-width rules are used to fix spacing issues: Haskell's `read` of a
  // `Double`.
  const zero = /^[0-9]+(\.[0-9]+)?$/.test(width) && Number(width) === 0;
  return zero ? [] : B.horizontalRule(start, ctx.state.at);
}

// A horizontal rule after `n` braced arguments: memoir's breaks.
function bracedRule(n) {
  return (ctx, start) => {
    for (let k = 0; k < n; k++) if (braced(ctx) === FAIL) return FAIL;
    return B.horizontalRule(start, ctx.state.at);
  };
}

// `path` with its extension `ext`, as `System.FilePath.replaceExtension`.
function replaceExtension(path, ext) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const base = dot > slash ? path.slice(0, dot) : path;
  return `${base}.${ext}`;
}

/**
 * Bibliography files, each as `.bib`.
 *
 * @see Text.Pandoc.Readers.LaTeX.splitBibs
 * @param {string} t
 */
const splitBibs = (t) =>
  splitTextBy((c) => c === ',', t).map((x) =>
    B.str(replaceExtension(trim(x), 'bib')),
  );

// `\bibliography{a,b}` and `\addbibresource{…}`: the files in the metadata.
function bibliography(ctx) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const t = braced(ctx);
  if (t === FAIL) return FAIL;
  const bibs = splitBibs(untokenize(t)).map((x) => B.metaInlines(x));
  addMeta(ctx, 'bibliography', { t: 'MetaList', c: bibs });
  return [];
}

/**
 * `\endinput`: the rest of the file it is in skipped.
 *
 * @see Text.Pandoc.Readers.LaTeX.skipSameFileToks
 * @param {object} ctx
 */
function skipSameFileToks(ctx) {
  const source = ctx.state.input?.tok.source;
  const infile = satisfyTok((t) => t.source === source);
  return skipMany(infile)(ctx) === FAIL ? FAIL : [];
}

/**
 * `\hypertarget{name}{…}`: a div with the name for identifier, or the
 * section it holds, named so already.
 *
 * @see Text.Pandoc.Readers.LaTeX.hypertargetBlock
 * @param {object} ctx
 * @param {number} start
 */
function hypertargetBlock(ctx, start) {
  return attempt((c) => {
    const ref = braced(c);
    if (ref === FAIL) return FAIL;
    const name = untokenize(ref);
    const bs = groupedBlock(c);
    if (bs === FAIL) return FAIL;
    const [h] = bs;
    if (
      bs.length === 1 &&
      h.t === 'Header' &&
      h.c[0] === 1 &&
      h.c[1][0] === name
    ) {
      return bs;
    }
    return B.divWith([name, [], []], bs, start, c.state.at);
  })(ctx);
}

/**
 * A div styled `stylename: color`, its argument blocks, not inlines.
 *
 * @see Text.Pandoc.Readers.LaTeX.coloredBlock
 * @param {string} stylename
 */
function coloredBlock(stylename) {
  const notInlines = notFollowedBy(groupedInlines);
  return (ctx, start) =>
    attempt((c) => {
      if (skipopts(c) === FAIL) return FAIL;
      const color = braced(c);
      if (color === FAIL || notInlines(c) === FAIL) return FAIL;
      const bs = groupedBlock(c);
      if (bs === FAIL) return FAIL;
      const attr = ['', [], [['style', `${stylename}: ${untokenize(color)}`]]];
      return B.divWith(attr, bs, start, c.state.at);
    })(ctx);
}

const notDocument = notFollowedBy(begin_('document'));

/**
 * What precedes `\begin{document}`: macro definitions, and file contents,
 * read; the rest skipped.
 *
 * @see Text.Pandoc.Readers.LaTeX.preamble
 * @param {object} ctx
 */
function preamble(ctx) {
  const preambleBlock = alt(
    (c) => (spaces1(c) === FAIL ? FAIL : []),
    macroDef((t, start, end) => B.rawBlock('latex', t, start, end)),
    filecontents,
    (c) => (blockCommand(c) === FAIL ? FAIL : []),
    (c) => (braced(c) === FAIL ? FAIL : []),
    (c) => (notDocument(c) === FAIL || anyTok(c) === FAIL ? FAIL : []),
  );
  const bs = many(preambleBlock)(ctx);
  return bs === FAIL ? FAIL : bs.flat();
}

/**
 * `\begin{filecontents}{name}…`: the file's text, kept for `\input`.
 *
 * @see Text.Pandoc.Readers.LaTeX.filecontents
 * @param {object} ctx
 */
function filecontents(ctx) {
  return attempt((c) => {
    if (controlSeq('begin')(c) === FAIL) return FAIL;
    const nameToks = braced(c);
    if (nameToks === FAIL) return FAIL;
    const name = untokenize(nameToks);
    if (name !== 'filecontents' && name !== 'filecontents*') return FAIL;
    if (skipopts(c) === FAIL) return FAIL;
    const fp = braced(c);
    if (fp === FAIL) return FAIL;
    const txt = verbEnv(name)(c);
    if (txt === FAIL) return FAIL;
    const fileContents = new Map(c.state.s.fileContents).set(
      untokenize(fp),
      txt,
    );
    updateLaTeXState(c, { fileContents });
    return [];
  })(ctx);
}

const bracketedInlines = bracketed((ctx) => inline(ctx), B.concat);
const closingPunct = optional(symbolIn('.:;?!'));

/**
 * csquotes' block quote: its blocks, then its citation; in the language
 * `mblang` names where babel knows it.
 *
 * @see Text.Pandoc.Readers.LaTeX.blockquote
 * @param {boolean} cvariant Whether its citation is a cite, not text.
 * @param {string | null} mblang
 * @returns {(ctx: object, start: number) => Blocks | typeof FAIL}
 */
function blockquote(cvariant, mblang) {
  const citation = cites((ctx) => inline(ctx), { t: 'NormalCitation' }, false);
  const optionalText = option(null, (c) => bracketedInlines(c));
  return (ctx, start) => {
    const from = ctx.state.at;
    let citepar = [];
    if (cvariant) {
      const xs = citation(ctx);
      if (xs === FAIL) return FAIL;
      const to = ctx.state.at;
      citepar = B.para(B.cite(xs, [], from, to), from, to);
    } else {
      const ils = optionalText(ctx);
      if (ils === FAIL) return FAIL;
      if (ils !== null) citepar = B.para(ils, from, ctx.state.at);
    }
    const l = mblang === null ? null : babelLangToBCP47(mblang);
    // The closing punctuation is read and ignored, as Pandoc does.
    if (optionalText(ctx) === FAIL) return FAIL;
    const bs = groupedBlock(ctx);
    if (bs === FAIL || closingPunct(ctx) === FAIL) return FAIL;
    const end = ctx.state.at;
    const inner = [...bs, ...citepar];
    const quoted =
      l === null ? inner : B.divWith(langAttr(l), inner, start, end);
    return B.blockQuote(quoted, start, end);
  };
}

// A block quote in the language its braced argument names.
function foreignBlockquote(cvariant) {
  return (ctx, start) => {
    const name = braced(ctx);
    if (name === FAIL) return FAIL;
    return blockquote(cvariant, untokenize(name))(ctx, start);
  };
}

/** @see Text.Pandoc.Readers.LaTeX.isBlockCommand */
const isBlockCommand = (s) => BLOCK_COMMANDS.has(s) || TREAT_AS_BLOCK.has(s);

/** @see Text.Pandoc.Readers.LaTeX.treatAsBlock */
const TREAT_AS_BLOCK = new Set([
  'special',
  'pdfannot',
  'pdfstringdef',
  'bibliographystyle',
  'maketitle',
  'makeindex',
  'makeglossary',
  'addcontentsline',
  'addtocontents',
  'addtocounter',
  // \ignore{} is used conventionally in literate haskell for definitions
  // that are to be processed by the compiler but not printed.
  'ignore',
  'hyperdef',
  'markboth',
  'markright',
  'markleft',
  'hspace',
  'vspace',
  'newpage',
  'clearpage',
  'pagebreak',
  'titleformat',
  'listoffigures',
  'listoftables',
  'write',
]);

/** @see Text.Pandoc.Readers.LaTeX.isInlineCommand */
const isInlineCommand = (s) => INLINE_COMMANDS.has(s) || TREAT_AS_INLINE.has(s);

/** @see Text.Pandoc.Readers.LaTeX.treatAsInline */
const TREAT_AS_INLINE = new Set([
  'index',
  'hspace',
  'vspace',
  'noindent',
  'newpage',
  'clearpage',
  'pagebreak',
]);

/**
 * The first of `names` `table` holds, else `d`.
 *
 * @see Text.Pandoc.Readers.LaTeX.lookupListDefault
 */
function lookupListDefault(d, names, table) {
  for (const name of names) {
    const p = table.get(name);
    if (p !== undefined) return p;
  }
  return d;
}

const starAfter = option('', (ctx) =>
  symbol('*')(ctx) === FAIL || sp(ctx) === FAIL ? FAIL : '*',
);
const overlay = option('', overlaySpecification);

// The names a command is looked up by: as written, then plain.
const namesOf = (name, written) =>
  written === name ? [name] : [written, name];

/**
 * A command not `\begin`, `\end` or `\and`: by the table where it has an
 * entry, else raw where `raw_tex` is on and it is no block command.
 *
 * @see Text.Pandoc.Readers.LaTeX.inlineCommand'
 * @type {Parser<Inlines>}
 */
const inlineCommandPrime = attempt((ctx) => {
  const start = ctx.state.at;
  const cs = anyControlSeq(ctx);
  if (cs === FAIL) return FAIL;
  const { name, text: cmd } = cs;
  if (name === 'begin' || name === 'end' || name === 'and') return FAIL;
  const star = [...name].every(isAlphaNum) ? starAfter(ctx) : '';
  if (star === FAIL) return FAIL;
  const ov = overlay(ctx);
  if (ov === FAIL) return FAIL;
  const raw = (c) => {
    if (!(isInlineCommand(name) || !isBlockCommand(name))) return FAIL;
    const rawcommand = getRawCommand(name, cmd + star)(c);
    if (rawcommand === FAIL) return FAIL;
    // Pandoc warns of what it drops (`SkippedContent`).
    return enabled(c, 'raw_tex')
      ? B.rawInline('latex', rawcommand, start, c.state.at)
      : [];
  };
  const p = lookupListDefault(
    null,
    namesOf(name, name + star + ov),
    INLINE_COMMANDS,
  );
  return p === null ? raw(ctx) : p(ctx, start);
});

const startCommand = attempt((ctx) => {
  const t = anyControlSeq(ctx);
  return t === FAIL || !t.name.startsWith('start') ? FAIL : t;
});
const notStart = notFollowedBy(startCommand);
const moreBlockCommands = many((ctx) =>
  notStart(ctx) === FAIL ? FAIL : blockCommand(ctx),
);
const blockEnds = lookAhead(alt(blankline, startCommand));
const blockStar = option('', (ctx) =>
  symbol('*')(ctx) === FAIL || sp(ctx) === FAIL ? FAIL : '*',
);

/**
 * A command not `\begin`, `\end` or `\and`, as a block: by the table
 * where it has an entry; else raw where it is a block command, or where
 * it is no inline command and block commands follow it to a blank line or
 * a `\start…` (raw ConTeXt).
 *
 * @see Text.Pandoc.Readers.LaTeX.blockCommand
 * @type {Parser<Blocks>}
 */
export const blockCommand = attempt((ctx) => {
  const start = ctx.state.at;
  const cs = anyControlSeq(ctx);
  if (cs === FAIL) return FAIL;
  const { name, text: txt } = cs;
  if (name === 'begin' || name === 'end' || name === 'and') return FAIL;
  const star = blockStar(ctx);
  if (star === FAIL) return FAIL;
  const rawContents = (c) => {
    const rawcontents = getRawCommand(name, txt + star)(c);
    if (rawcontents === FAIL) return FAIL;
    // Pandoc warns of what it drops (`SkippedContent`).
    return enabled(c, 'raw_tex')
      ? B.rawBlock('latex', rawcontents, start, c.state.at)
      : [];
  };
  const rawDefiniteBlock = (c) =>
    isBlockCommand(name) ? rawContents(c) : FAIL;
  const rawMaybeBlock = attempt((c) => {
    if (isInlineCommand(name)) return FAIL;
    const curr = rawContents(c);
    if (curr === FAIL) return FAIL;
    const rest = moreBlockCommands(c);
    if (rest === FAIL || blockEnds(c) === FAIL) return FAIL;
    return [...curr, ...rest.flat()];
  });
  const p = lookupListDefault(null, namesOf(name, name + star), BLOCK_COMMANDS);
  return p === null ? alt(rawDefiniteBlock, rawMaybeBlock)(ctx) : p(ctx, start);
});

// ---------------------------------------------------------------------
// Environments

const begin = controlSeq('begin');

/**
 * `\begin{name}` to `\end{name}`: by the table, as a theorem, or else raw
 * where `raw_tex` is on and a div where it is off; an inline environment
 * is no block.
 *
 * @see Text.Pandoc.Readers.LaTeX.environment
 * @type {Parser<Blocks>}
 */
export const environment = attempt((ctx) => {
  const start = ctx.state.at;
  if (begin(ctx) === FAIL) return FAIL;
  const nameToks = braced(ctx);
  if (nameToks === FAIL) return FAIL;
  const name = untokenize(nameToks);
  const known = ENVIRONMENTS.get(name);
  return alt(
    (c) => (known === undefined ? FAIL : known(c, start)),
    langEnvironment(name, start),
    theoremEnvironment(blocks, inlines, opt, name, start),
    (c) =>
      INLINE_ENVIRONMENTS.has(name)
        ? FAIL
        : alt(attempt(rawEnv(name, start)), rawVerbEnv(name, start))(c),
  )(ctx);
});

// An environment's blocks made into others by `f`, spanning it all.
function envOf(name, f) {
  return (ctx, start) => {
    const bs = env(name, blocks)(ctx);
    return bs === FAIL ? FAIL : f(bs, start, ctx.state.at);
  };
}

/**
 * `document`: its blocks; what follows it skipped.
 *
 * @see Text.Pandoc.Readers.LaTeX.environments
 * @param {object} ctx
 */
function documentEnv(ctx) {
  const bs = env('document', blocks)(ctx);
  return bs === FAIL || skipMany(anyTok)(ctx) === FAIL ? FAIL : bs;
}

/**
 * `abstract`: its blocks into the metadata.
 *
 * @see Text.Pandoc.Readers.LaTeX.environments
 * @param {object} ctx
 */
function abstractEnv(ctx) {
  const bs = env('abstract', blocks)(ctx);
  if (bs === FAIL) return FAIL;
  addMeta(ctx, 'abstract', B.metaBlocks(bs));
  return [];
}

/**
 * `minipage[pos]{width}`: a div of its blocks.
 *
 * @see Text.Pandoc.Readers.LaTeX.environments
 * @param {object} ctx
 * @param {number} start
 */
function minipage(ctx, start) {
  const bs = env('minipage', (c) => {
    if (skipopts(c) === FAIL || spaces(c) === FAIL) return FAIL;
    if (optional(braced)(c) === FAIL || spaces(c) === FAIL) return FAIL;
    return blocks(c);
  })(ctx);
  if (bs === FAIL) return FAIL;
  return B.divWith(['', ['minipage'], []], bs, start, ctx.state.at);
}

/**
 * A letter's blocks, its address before them; the signature comes with
 * `\closing`.
 *
 * @see Text.Pandoc.Readers.LaTeX.letterContents
 * @param {object} ctx
 */
function letterContents(ctx) {
  const start = ctx.state.at;
  const bs = blocks(ctx);
  if (bs === FAIL) return FAIL;
  // add signature (author) and address (title)
  const address = ctx.state.s.meta.address;
  const [b] = address?.t === 'MetaBlocks' ? address.c : [];
  const addr =
    address?.c.length === 1 && b?.t === 'Plain'
      ? mapSpans(
          B.para(B.trimInlines(b.c)),
          () => start,
          () => start,
        )
      : [];
  return [...addr, ...bs];
}

// The caption's image placeholder dropped: the figure has the caption.
const dropImageCaption = (x) => {
  if (x.t !== 'Para' || x.c.length !== 1) return x;
  const [img] = x.c;
  if (img.t !== 'Image') return x;
  const [attr, alt, target] = img.c;
  if (alt.length !== 1 || alt[0].t !== 'Str' || alt[0].c !== 'image') return x;
  const image = new Node('Image', [attr, [], target], img.start, img.end);
  return new Node('Plain', [image], x.start, x.end);
};

const figureContent = many(
  alt(
    attempt((ctx) => (label(ctx) === FAIL ? FAIL : null)),
    (ctx) => block(ctx),
  ),
);

/**
 * A figure environment: its blocks, the caption and label they set, the
 * label numbered; a subfigure after its options and width.
 *
 * @see Text.Pandoc.Readers.LaTeX.figure'
 * @param {string} name
 * @param {boolean} sub
 */
function figureEnv(name, sub) {
  const figure = attempt((ctx) => {
    if (sp(ctx) === FAIL) return FAIL;
    const hint = option('', (c) => {
      const t = bracketedToks(c);
      return t === FAIL ? FAIL : untokenize(t);
    })(ctx);
    if (hint === FAIL || sp(ctx) === FAIL) return FAIL;
    resetCaption(ctx);
    const inner = figureContent(ctx);
    if (inner === FAIL) return FAIL;
    const content = walk(
      { block: dropImageCaption },
      inner.filter((x) => x !== null).flat(),
    );
    const { caption, lastLabel, labels } = ctx.state.s;
    if (lastLabel !== null) {
      const num = getNextNumber((s) => s.lastFigureNum)(ctx);
      const at = ctx.state.at;
      updateLaTeXState(ctx, {
        lastFigureNum: num,
        labels: new Map(labels).set(
          lastLabel,
          B.str(renderDottedNum(num), at, at),
        ),
      });
    }
    const kvs = hint === '' ? [] : [['latex-placement', hint]];
    return [[lastLabel ?? '', [], kvs], caption ?? B.emptyCaption, content];
  });
  const body = sub
    ? (ctx) =>
        skipopts(ctx) === FAIL || tok(ctx) === FAIL ? FAIL : figure(ctx)
    : figure;
  return (ctx, start) => {
    const r = env(name, body)(ctx);
    if (r === FAIL) return FAIL;
    const [attr, capt, content] = r;
    return B.figureWith(attr, capt, content, start, ctx.state.at);
  };
}

/**
 * The `alltt` environment's text as code: spaces raw, line breaks hard.
 *
 * @see Text.Pandoc.Readers.LaTeX.alltt
 * @param {Blocks} bs
 */
function alltt(bs) {
  return walk(
    {
      inline: (x) => {
        if (x.t === 'Str')
          return new Node('Code', [nullAttr, x.c], x.start, x.end);
        if (x.t === 'Space') {
          return new Node('RawInline', ['latex', '\\ '], x.start, x.end);
        }
        if (x.t === 'SoftBreak')
          return new Node('LineBreak', undefined, x.start, x.end);
        return x;
      },
    },
    bs,
  );
}

// Options as attributes: `firstnumber` as `startFrom`.
const renamedKvs = (options) =>
  options.map(([k, v]) => [k === 'firstnumber' ? 'startFrom' : k, v]);
const optionalKeyvals = option([], keyvals);

/**
 * fancyvrb's verbatim: code, its lines numbered on the left where asked.
 *
 * @see Text.Pandoc.Readers.LaTeX.fancyverbEnv
 * @param {string} name
 */
function fancyverbEnv(name) {
  return (ctx, start) => {
    const options = optionalKeyvals(ctx);
    if (options === FAIL) return FAIL;
    const numbered = options.find(([k]) => k === 'numbers')?.[1] === 'left';
    const attr = ['', numbered ? ['numberLines'] : [], renamedKvs(options)];
    const code = verbEnv(name)(ctx);
    return code === FAIL
      ? FAIL
      : B.codeBlockWith(attr, code, start, ctx.state.at);
  };
}

/**
 * listings' options as attributes: its label, line numbers and language.
 *
 * @see Text.Pandoc.Readers.LaTeX.parseListingsOptions
 * @param {[string, string][]} options
 */
function parseListingsOptions(options) {
  const classes = [];
  if (options.find(([k]) => k === 'numbers')?.[1] === 'left') {
    classes.push('numberLines');
  }
  const language = listingsLanguage(options);
  if (language !== null) classes.push(language);
  const ident = options.find(([k]) => k === 'label')?.[1] ?? '';
  return [ident, classes, renamedKvs(options)];
}

// `lstlisting`: code with listings' options.
function lstlisting(ctx, start) {
  const options = optionalKeyvals(ctx);
  if (options === FAIL) return FAIL;
  const code = verbEnv('lstlisting')(ctx);
  if (code === FAIL) return FAIL;
  return B.codeBlockWith(
    parseListingsOptions(options),
    code,
    start,
    ctx.state.at,
  );
}

/**
 * minted's options and language as attributes.
 *
 * @see Text.Pandoc.Readers.LaTeX.mintedAttr
 * @param {object} ctx
 */
function mintedAttr(ctx) {
  const options = optionalKeyvals(ctx);
  if (options === FAIL) return FAIL;
  const lang = braced(ctx);
  if (lang === FAIL) return FAIL;
  const l = untokenize(lang);
  const classes = l === '' ? [] : [l];
  if (options.find(([k]) => k === 'linenos')?.[1] === 'true') {
    classes.push('numberLines');
  }
  return ['', classes, renamedKvs(options)];
}

/** @see Text.Pandoc.Readers.LaTeX.minted */
function minted(ctx, start) {
  const attr = mintedAttr(ctx);
  if (attr === FAIL) return FAIL;
  const code = verbEnv('minted')(ctx);
  return code === FAIL
    ? FAIL
    : B.codeBlockWith(attr, code, start, ctx.state.at);
}

/**
 * `obeylines`: a paragraph, its line breaks hard, none at either end.
 *
 * @see Text.Pandoc.Readers.LaTeX.obeylines
 * @param {object} ctx
 * @param {number} start
 */
function obeylines(ctx, start) {
  const ils = env('obeylines', inlines)(ctx);
  if (ils === FAIL) return FAIL;
  const hard = walkInlines(
    {
      inline: (x) =>
        x.t === 'SoftBreak'
          ? new Node('LineBreak', undefined, x.start, x.end)
          : x,
    },
    ils,
  );
  let [from, to] = [0, hard.length];
  while (from < to && hard[from].t === 'LineBreak') from++;
  while (to > from && hard[to - 1].t === 'LineBreak') to--;
  return B.para(hard.slice(from, to), start, ctx.state.at);
}

/**
 * An item of a list: what precedes `\item` dropped.
 *
 * @see Text.Pandoc.Readers.LaTeX.item
 * @param {object} ctx
 */
function item(ctx) {
  if (blocks(ctx) === FAIL || controlSeq('item')(ctx) === FAIL) return FAIL;
  return skipopts(ctx) === FAIL ? FAIL : blocks(ctx);
}

/**
 * An item of a description: its term in brackets, its blocks.
 *
 * @see Text.Pandoc.Readers.LaTeX.descItem
 * @param {object} ctx
 */
function descItem(ctx) {
  if (optional(spaces1)(ctx) === FAIL) return FAIL;
  if (controlSeq('item')(ctx) === FAIL || sp(ctx) === FAIL) return FAIL;
  const ils = opt(ctx);
  if (ils === FAIL) return FAIL;
  const bs = blocks(ctx);
  return bs === FAIL ? FAIL : [ils, [bs]];
}

/**
 * A list environment, its items read as in a list item.
 *
 * @see Text.Pandoc.Readers.LaTeX.listenv
 * @param {string} name
 * @param {Parser<unknown>} p
 */
function listenv(name, p) {
  return attempt((ctx) => {
    const old = ctx.state.s.inListItem;
    updateLaTeXState(ctx, { inListItem: true });
    const res = env(name, p)(ctx);
    if (res === FAIL) return FAIL;
    updateLaTeXState(ctx, { inListItem: old });
    return res;
  });
}

// A list of `item`s made by `f`.
function listOf(name, f, itemParser) {
  const items = listenv(name, many(itemParser));
  return (ctx, start) => {
    const xs = items(ctx);
    return xs === FAIL ? FAIL : f(xs, start, ctx.state.at);
  };
}

const markerSpec = (ctx) => {
  if (symbol('[')(ctx) === FAIL) return FAIL;
  const ts = manyTill(anyTok, symbol(']'))(ctx);
  if (ts === FAIL) return FAIL;
  const text = untokenize(ts);
  const state = defaultParserState(readerOptions());
  const { value } = parse(anyOrderedListMarker, text, state);
  // Pandoc warns of the option it skips (`SkippedContent`).
  return value === FAIL ? [1, DefaultStyle, DefaultDelim] : value;
};
const itemindent = optional(
  attempt((ctx) => {
    if (controlSeq('setlength')(ctx) === FAIL) return FAIL;
    const g = grouped(count(1, controlSeq('itemindent')), (xs) => xs.flat())(
      ctx,
    );
    return g === FAIL ? FAIL : braced(ctx);
  }),
);
const setcounter = option(
  1,
  attempt((ctx) => {
    if (controlSeq('setcounter')(ctx) === FAIL) return FAIL;
    const ctrToks = braced(ctx);
    if (ctrToks === FAIL) return FAIL;
    const ctr = untokenize(ctrToks);
    if (!ctr.startsWith('enum')) return FAIL;
    if (![...ctr.slice(4)].every((c) => c === 'i' || c === 'v')) return FAIL;
    if (sp(ctx) === FAIL) return FAIL;
    const num = braced(ctx);
    if (num === FAIL) return FAIL;
    // Haskell's `read` of an `Int`; Pandoc warns of one it skips.
    const t = untokenize(num).trim();
    return /^-?[0-9]+$/.test(t) ? Number(BigInt.asIntN(64, BigInt(t))) + 1 : 1;
  }),
);
const enumerateItems = listenv('enumerate', many(item));

/**
 * `enumerate`: its marker's style from an option, its start from
 * `\setcounter`.
 *
 * @see Text.Pandoc.Readers.LaTeX.orderedList'
 * @param {object} ctx
 * @param {number} start
 */
function orderedListEnv(ctx, start) {
  return attempt((c) => {
    if (spaces(c) === FAIL) return FAIL;
    const marker = option([1, DefaultStyle, DefaultDelim], markerSpec)(c);
    if (marker === FAIL || spaces(c) === FAIL) return FAIL;
    if (itemindent(c) === FAIL || spaces(c) === FAIL) return FAIL;
    const first = setcounter(c);
    if (first === FAIL) return FAIL;
    const bs = enumerateItems(c);
    if (bs === FAIL) return FAIL;
    const [, style, delim] = marker;
    return B.orderedListWith([first, style, delim], bs, start, c.state.at);
  })(ctx);
}

const langAttr = (l) => ['', [], [['lang', renderLang(l)]]];

const otherlanguageBody = env('otherlanguage', (ctx) => {
  if (skipopts(ctx) === FAIL) return FAIL;
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const bs = blocks(ctx);
  return bs === FAIL ? FAIL : [babelLangToBCP47(untokenize(name)), bs];
});

/**
 * `otherlanguage`: a div in the language where babel knows it.
 *
 * @see Text.Pandoc.Readers.LaTeX.otherlanguageEnv
 * @param {object} ctx
 * @param {number} start
 */
function otherlanguageEnv(ctx, start) {
  const read = otherlanguageBody(ctx);
  if (read === FAIL) return FAIL;
  const [l, bs] = read;
  return l === null ? bs : B.divWith(langAttr(l), bs, start, ctx.state.at);
}

/**
 * An environment named for a babel language: a div in that language.
 *
 * @see Text.Pandoc.Readers.LaTeX.langEnvironment
 * @param {string} name
 * @param {number} start
 * @returns {Parser<Blocks>}
 */
function langEnvironment(name, start) {
  const l = babelLangToBCP47(name);
  if (l === null) return () => FAIL;
  const body = env(name, blocks);
  return (ctx) => {
    const bs = body(ctx);
    return bs === FAIL ? FAIL : B.divWith(langAttr(l), bs, start, ctx.state.at);
  };
}

const rawopts = many(rawopt);

/**
 * An environment Pandoc does not know: raw where `raw_tex` is on, else a
 * div of its blocks, classed by its name.
 *
 * @see Text.Pandoc.Readers.LaTeX.rawEnv
 * @param {string} name
 * @param {number} start
 * @returns {Parser<Blocks>}
 */
function rawEnv(name, start) {
  const body = env(name, blocks);
  const rawBody = withRaw(body);
  return (ctx) => {
    const opts = rawopts(ctx);
    if (opts === FAIL) return FAIL;
    const beginCommand = `\\begin{${name}}${opts.join('')}`;
    if (enabled(ctx, 'raw_tex')) {
      const read = rawBody(ctx);
      if (read === FAIL) return FAIL;
      const raw = beginCommand + untokenize(read[1]);
      return B.rawBlock('latex', raw, start, ctx.state.at);
    }
    const bs = body(ctx);
    if (bs === FAIL) return FAIL;
    // Pandoc warns of the `\begin` and `\end` it skips (`SkippedContent`).
    return B.divWith(['', [name], []], bs, start, ctx.state.at);
  };
}

/**
 * An environment read verbatim to its end: raw where `raw_tex` is on, else
 * nothing.
 *
 * @see Text.Pandoc.Readers.LaTeX.rawVerbEnv
 * @param {string} name
 * @param {number} start
 * @returns {Parser<Blocks>}
 */
function rawVerbEnv(name, start) {
  const read = withRaw(verbEnv(name));
  return (ctx) => {
    const r = read(ctx);
    if (r === FAIL) return FAIL;
    const raw = `\\begin{${name}}${untokenize(r[1])}`;
    // Pandoc warns of what it skips (`SkippedContent`).
    return enabled(ctx, 'raw_tex')
      ? B.rawBlock('latex', raw, start, ctx.state.at)
      : [];
  };
}

// ---------------------------------------------------------------------
// Blocks

const someInlines = many1(inline);

/**
 * Inlines to a paragraph; none where they are only space.
 *
 * @see Text.Pandoc.Readers.LaTeX.paragraph
 * @type {Parser<Blocks>}
 */
function paragraph(ctx) {
  const ils = someInlines(ctx);
  if (ils === FAIL) return FAIL;
  const x = B.trimInlines(B.concat(ils));
  return x.length === 0 ? [] : B.para(x, x[0].start, x.at(-1).end);
}

const skipSpaces = (ctx) => (spaces1(ctx) === FAIL ? FAIL : []);
const ctrlSeqBlock = alt(
  macroDef((t, start, end) => B.rawBlock('latex', t, start, end)),
  blockCommand,
);

/**
 * A block, by its first token; else a paragraph or a group of blocks.
 *
 * @see Text.Pandoc.Readers.LaTeX.block
 * @type {Parser<Blocks>}
 */
export function block(ctx) {
  const tk = peekTok(ctx);
  if (tk === FAIL) return FAIL;
  let first;
  switch (tk.type) {
    case 'Newline':
    case 'Spaces':
    case 'Comment':
      first = skipSpaces;
      break;
    case 'Word':
      first = paragraph;
      break;
    case 'CtrlSeq':
      first = tk.name === 'begin' ? environment : ctrlSeqBlock;
      break;
    default:
      first = () => FAIL;
  }
  return alt(first, paragraph, groupedBlock)(ctx);
}

const manyBlocks = many(block);

/**
 * @see Text.Pandoc.Readers.LaTeX.blocks
 * @type {Parser<Blocks>}
 */
export function blocks(ctx) {
  const bs = manyBlocks(ctx);
  return bs === FAIL ? FAIL : bs.flat();
}
