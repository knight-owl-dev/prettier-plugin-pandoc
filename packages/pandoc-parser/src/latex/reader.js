// Pandoc's LaTeX reader: TeX to Pandoc's AST, each block and inline with
// the span of the source it was read from.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX`. Its command and
// environment tables hold the math module's entries so far.

import * as B from '../ast/builder.js';
import { doc } from '../ast/document.js';
import { Node, nullAttr } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import { walk } from '../ast/walk.js';
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
} from '../core.js';
import { isAlphaNum, isAlpha as isLetter } from '../data-char.js';
import { readerInput } from '../input.js';
import { readerOptions } from '../options.js';
import { NBSP } from '../shared.js';
import { nameCommands } from './inline.js';
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
  skipopts,
  sp,
  spaces1,
  streamOf,
  symbol,
  tokenize,
  tokWith,
  untokenize,
  verbEnv,
  withRaw,
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

// The entries of `LaTeX.hs`'s own table.
const REST_COMMANDS = [
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
  ...inlineLanguageCommands(tok),
  ...enquoteCommands(tok),
  ...nameCommands,
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
const groupedBlocks = grouped(
  (ctx) => block(ctx),
  (xs) => xs.flat(),
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
  return alt(first, paragraph, groupedBlocks)(ctx);
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
