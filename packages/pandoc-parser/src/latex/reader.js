// Pandoc's LaTeX reader: TeX to Pandoc's AST, each block and inline with
// the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX`. Its command and
// environment tables hold the math module's entries so far.

import * as B from '../ast/builder.js';
import { doc } from '../ast/document.js';
import { Node, nullAttr } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import { walk, walkInlines } from '../ast/walk.js';
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
} from '../core.js';
import { isAlphaNum, isAlpha as isLetter } from '../data-char.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { extractSpaces, formatCode, NBSP, toLower } from '../shared.js';
import { citationCommands, cites } from './citation.js';
import {
  accentCommands,
  acronymCommands,
  biblatexInlineCommands,
  charCommands,
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
  anyControlSeq,
  anyTok,
  blankline,
  braced,
  bracedUrl,
  bracketed,
  bracketedToks,
  controlSeq,
  defaultLaTeXState,
  endline,
  env,
  getRawCommand,
  grouped,
  isNewlineTok,
  lpContext,
  overlaySpecification,
  peekTok,
  prepend,
  primEscape,
  rawopt,
  satisfyTok,
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

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {import('../ast/builder.js').Blocks} Blocks */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

const enabled = (ctx, ext) => ctx.state.s.options.extensions.has(ext);

/**
 * Read `source` as Pandoc's LaTeX reader does.
 *
 * Not ported yet: the command and environment tables but math's, and
 * metadata.
 *
 * @see Text.Pandoc.Readers.LaTeX.readLaTeX
 * @param {string} source
 * @param {{tabStop?: number, extensions?: string[], lang?: string}} [options]
 *   `lang` is the BCP 47 tag of the language terms are translated to, as
 *   `-M lang=…` gives it.
 */
export function readLaTeX(source, options) {
  const opts = readerOptions({ ...options, format: 'latex' });
  const { text, toSource } = readerInput(source, opts.tabStop, 1);
  const input = streamOf(tokenize(text));
  const common = commonState({ lang: options?.lang });
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
const closing = (c) =>
  attempt((ctx) => (symbol(c)(ctx) === FAIL ? FAIL : notLetter(ctx)));

/**
 * ‘Single quotes’: `…' or ‘…’, the closing one before no letter.
 *
 * @see Text.Pandoc.Readers.LaTeX.singleQuote
 * @type {Parser<Inlines>}
 */
const singleQuote = alt(
  quoted(B.singleQuoted, tokens(symbol('`')), closing("'")),
  quoted(B.singleQuoted, tokens(symbol('‘')), closing('’')),
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
  // Not ported yet: `\includegraphics` and `\includesvg`, which probe
  // files.
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
  // Not ported yet: `\input`, which reads a file.
  // soul package
  ['st', extracting((ctx) => tok(ctx), B.strikeout)],
  ['ul', tokThen(B.underline)],
  ['hl', extracting((ctx) => tok(ctx), classed('mark'))],
  // ulem package
  ['sout', extracting((ctx) => tok(ctx), B.strikeout)],
  ['uline', tokThen(B.underline)],
  // plain tex stuff that should just be passed through as raw tex
  ['ifdim', ifdim],
  // Not ported yet: `\today`, generally only used in `\date`, which reads
  // the clock.
  // this is used internally by pandoc but the definition is too complicated
  // for pandoc to handle (see #11140):
  ['pandocbounded', (ctx) => tok(ctx)],
];

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
  // Not ported yet: siunitx.
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
  ['newtheorem', newtheorem],
  ['theoremstyle', theoremstyle],
  // polyglossia
  ['setdefaultlanguage', setDefaultLanguage],
  ['setmainlanguage', setDefaultLanguage],
  // csquotes
  ['blockquote', blockquote(false, null)],
  ['blockcquote', blockquote(true, null)],
  ['foreignblockquote', foreignBlockquote(false)],
  ['foreignblockcquote', foreignBlockquote(true)],
  ['hyphenblockquote', foreignBlockquote(false)],
  ['hyphenblockcquote', foreignBlockquote(true)],
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
  // amsthm
  ['proof', proof(blocks, opt)],
  // other
  ['otherlanguage', otherlanguageEnv],
]);

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
