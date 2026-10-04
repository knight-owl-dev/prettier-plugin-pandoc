// Inline commands of the LaTeX reader, by kind: verbatim and inline code,
// symbols and characters, accents, biblatex's, terms, references and
// acronyms.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Inline`. Each
// command reads what follows its name, which starts at `start`.

import * as B from '../ast/builder.js';
import { Node, nullAttr } from '../ast/nodes.js';
import {
  FAIL,
  many1,
  manyTill,
  notFollowedBy,
  option,
  optional,
} from '../core.js';
import { fromListingsLanguage } from '../highlighting.js';
import { NBSP, toRomanNumeral } from '../shared.js';
import { translateTerm } from '../translations.js';
import {
  anySymbol,
  anyTok,
  braced,
  getRawCommand,
  isWordTok,
  keyvals,
  newlineTok,
  prepend,
  rawopt,
  satisfyTok,
  setInput,
  skipopts,
  spaces,
  symbol,
  tokenize,
  untokenize,
  updateLaTeXState,
  withVerbatimMode,
} from './parsing.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {(ctx: object, start: number) => Inlines | typeof FAIL} Command */

const rawTex = (ctx) => ctx.state.s.options.extensions.has('raw_tex');

/**
 * The command raw where `raw_tex` is on, else `fallback`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.rawInlineOr
 * @param {string} name
 * @param {Command} fallback
 * @returns {Command}
 */
export const rawInlineOr = (name, fallback) => {
  const raw = getRawCommand(name, `\\${name}`);
  return (ctx, start) => {
    if (!rawTex(ctx)) return fallback(ctx, start);
    const t = raw(ctx);
    return t === FAIL ? FAIL : B.rawInline('latex', t, start, ctx.state.at);
  };
};

/**
 * `\label{…}`: an empty span with its identifier, the last label.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.dolabel
 * @type {Command}
 */
function dolabel(ctx, start) {
  const v = braced(ctx);
  if (v === FAIL) return FAIL;
  const refstr = untokenize(v);
  updateLaTeXState(ctx, { lastLabel: refstr });
  return B.spanWith([refstr, [], [['label', refstr]]], [], start, ctx.state.at);
}

/**
 * A reference: a link to the label, its text resolved after reading.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doref
 * @param {string} cls
 * @returns {Command}
 */
const doref = (cls) => (ctx, start) => {
  const v = braced(ctx);
  if (v === FAIL) return FAIL;
  const refstr = untokenize(v);
  const end = ctx.state.at;
  const attr = [
    '',
    [],
    [
      ['reference-type', cls],
      ['reference', refstr],
    ],
  ];
  const text = inBrackets(B.str(refstr, start, end), start, end);
  return B.linkWith(attr, `#${refstr}`, '', text, start, end);
};

/** @see Text.Pandoc.Readers.LaTeX.Inline.inBrackets */
const inBrackets = (x, start, end) =>
  B.concat([B.str('[', start, start), x, B.str(']', end, end)]);

/**
 * A term in the document's language.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doTerm
 * @param {import('../translations.js').Term} term
 * @returns {Command}
 */
const doTerm = (term) => (ctx, start) =>
  B.str(translateTerm(ctx.common, term), start, ctx.state.at);

/**
 * @see Text.Pandoc.Readers.LaTeX.Inline.lit
 * @param {string} t
 * @returns {Command}
 */
const lit = (t) => (ctx, start) => B.str(t, start, ctx.state.at);

// A single character as the delimiter of verbatim text.
const marker = (ctx) => {
  const t = anySymbol(ctx);
  return t === FAIL || [...t.text].length !== 1 ? FAIL : t.text;
};
const notNewline = notFollowedBy(newlineTok);

/**
 * `\verb|…|`: code to the next `|`, or whatever the delimiter is, on one
 * line.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doverb
 * @type {Command}
 */
function doverb(ctx, start) {
  const m = marker(ctx);
  if (m === FAIL) return FAIL;
  const body = manyTill(
    (c) => (notNewline(c) === FAIL ? FAIL : verbTok(m)(c)),
    symbol(m),
  );
  const toks = withVerbatimMode(body)(ctx);
  if (toks === FAIL) return FAIL;
  return B.code(untokenize(toks), start, ctx.state.at);
}

/**
 * The next token, cut at `stopchar` where it holds one: the rest put back,
 * the stop character a symbol of its own and what follows tokenized
 * again.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.verbTok
 * @param {string} stopchar
 * @returns {Parser<Tok>}
 */
const verbTok = (stopchar) => (ctx) => {
  const t = anyTok(ctx);
  if (t === FAIL) return FAIL;
  const chars = [...t.text];
  const i = chars.indexOf(stopchar);
  if (i === -1) return t;
  const t1 = chars.slice(0, i).join('');
  const t2 = chars.slice(i + 1).join('');
  // A token from an expansion spans nothing; its pieces neither.
  const at = (k) => (t.end === t.start ? t.start : t.start + k);
  const stopAt = at(t1.length);
  const stop = {
    type: 'Symbol',
    text: stopchar,
    line: t.line,
    column: t.column + i,
    start: stopAt,
    end: at(t1.length + stopchar.length),
  };
  const restAt = at(t1.length + stopchar.length);
  const rest = [
    ...tokenize(t2, 0, { line: t.line, column: t.column + i + 1 }),
  ].map((x) => ({
    ...x,
    start: t.end === t.start ? t.start : restAt + x.start,
    end: t.end === t.start ? t.start : restAt + x.end,
  }));
  setInput(ctx, prepend([stop, ...rest], ctx.state.input), ctx.state.expanded);
  return { ...t, text: t1, end: stopAt };
};

/**
 * The language among listings' options, as skylighting names it where it
 * knows it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.listingsLanguage
 * @param {[string, string][]} opts
 * @returns {string | null}
 */
export function listingsLanguage(opts) {
  const l = opts.find(([k]) => k === 'language')?.[1];
  return l === undefined ? null : (fromListingsLanguage(l) ?? l);
}

const lstOptions = option([], keyvals);

/**
 * `\lstinline[options]|…|`: code in the options' language.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.dolstinline
 * @type {Command}
 */
function dolstinline(ctx, start) {
  const options = lstOptions(ctx);
  if (options === FAIL) return FAIL;
  const language = listingsLanguage(options);
  return doinlinecode(language === null ? [] : [language])(ctx, start);
}

/**
 * `\mintinline{language}|…|`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.domintinline
 * @type {Command}
 */
function domintinline(ctx, start) {
  if (skipopts(ctx) === FAIL) return FAIL;
  const cls = braced(ctx);
  if (cls === FAIL) return FAIL;
  return doinlinecode([untokenize(cls)])(ctx, start);
}

/**
 * Inline code to the delimiter, `}` for `{`, its newlines spaces.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doinlinecode
 * @param {string[]} classes
 * @returns {Command}
 */
const doinlinecode = (classes) => (ctx, start) => {
  const m = marker(ctx);
  if (m === FAIL) return FAIL;
  const stopchar = m === '{' ? '}' : m;
  const toks = withVerbatimMode(manyTill(verbTok(stopchar), symbol(stopchar)))(
    ctx,
  );
  if (toks === FAIL) return FAIL;
  const code = untokenize(toks).replaceAll('\n', ' ');
  return B.codeWith(['', classes, []], code, start, ctx.state.at);
};

/** @see Text.Pandoc.Readers.LaTeX.Inline.romanNumeralUpper */
function romanNumeralUpper(ctx, start) {
  const n = romanNumeralArg(ctx);
  return n === FAIL ? FAIL : B.str(toRomanNumeral(n), start, ctx.state.at);
}

/** @see Text.Pandoc.Readers.LaTeX.Inline.romanNumeralLower */
function romanNumeralLower(ctx, start) {
  const n = romanNumeralArg(ctx);
  if (n === FAIL) return FAIL;
  return B.str(toRomanNumeral(n).toLowerCase(), start, ctx.state.at);
}

const words = many1(satisfyTok(isWordTok));

// Digits as Haskell's `safeRead` of an `Int` reads them: wrapped to 64
// bits.
const readInt = (digits) => Number(BigInt.asIntN(64, BigInt(digits)));

const romanNumber = (ctx) => {
  const ws = words(ctx);
  if (ws === FAIL) return FAIL;
  const s = untokenize(ws);
  // Non-digits in argument to \Rn or \RN.
  return /^[0-9]+$/.test(s) ? readInt(s) : FAIL;
};

/**
 * The number `\RN` and `\Rn` take, braced or not.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.romanNumeralArg
 * @returns {number | typeof FAIL}
 */
function romanNumeralArg(ctx) {
  if (spaces(ctx) === FAIL) return FAIL;
  const at = ctx.pos;
  const n = romanNumber(ctx);
  if (n !== FAIL || ctx.pos !== at) return n;
  if (symbol('{')(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  const m = romanNumber(ctx);
  if (m === FAIL || spaces(ctx) === FAIL || symbol('}')(ctx) === FAIL) {
    return FAIL;
  }
  return m;
}

/**
 * An accent on `tok`'s first character, composed where Unicode has the
 * character; alone, as `fallBack` or the combining mark, on nothing or a
 * space.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.accentWith
 * @param {Parser<Inlines>} tok
 * @param {string} combiningAccent
 * @param {string | null} fallBack
 * @returns {Command}
 */
const accentWith = (tok, combiningAccent, fallBack) => {
  const arg = option([], tok);
  return (ctx, start) => {
    const ils = arg(ctx);
    if (ils === FAIL) return FAIL;
    const [first, ...rest] = ils;
    if (first?.t === 'Str' && first.c !== '') {
      const [x, ...xs] = [...first.c];
      const c = `${x}${combiningAccent}`.normalize('NFC') + xs.join('');
      return [new Node('Str', c, first.start, first.end), ...rest];
    }
    if (ils.length === 0 || (ils.length === 1 && first.t === 'Space')) {
      return B.str(fallBack ?? combiningAccent, start, ctx.state.at);
    }
    return ils;
  };
};

/**
 * @see Text.Pandoc.Readers.LaTeX.Inline.verbCommands
 * @type {Map<string, Command>}
 */
export const verbCommands = new Map([
  ['verb', doverb],
  ['lstinline', dolstinline],
  ['mintinline', domintinline],
  ['Verb', doverb],
]);

/**
 * @see Text.Pandoc.Readers.LaTeX.Inline.miscCommands
 * @type {Map<string, Command>}
 */
export const miscCommands = new Map(
  [
    ['pounds', '£'],
    ['euro', '€'],
    ['copyright', '©'],
    ['textasciicircum', '^'],
    ['textasciitilde', '~'],
    ['textbaht', '฿'],
    ['textblank', '␢'],
    ['textbigcircle', '○'],
    ['textbrokenbar', '¦'],
    ['textbullet', '•'],
    ['textcentoldstyle', '¢'],
    ['textcopyright', '©'],
    ['textdagger', '†'],
    ['textdegree', '°'],
    ['textdollar', '$'],
    ['textdong', '₫'],
    ['textlira', '₤'],
    ['textmu', 'μ'],
    ['textmusicalnote', '♪'],
    ['textonehalf', '½'],
    ['textonequarter', '¼'],
    ['textparagraph', '¶'],
    ['textpertenthousand', '‱'],
    ['textpeso', '₱'],
    ['textquotesingle', "'"],
    ['textregistered', '®'],
    ['textsection', '§'],
    ['textsterling', '£'],
    ['textthreequarters', '¾'],
    ['textthreesuperior', '³'],
    ['texttwosuperior', '²'],
    ['textyen', '¥'],
  ].map(([name, t]) => [name, lit(t)]),
);

/**
 * Accents, and letters with them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.accentCommands
 * @param {Parser<Inlines>} tok
 * @returns {Map<string, Command>}
 */
export const accentCommands = (tok) => {
  const accent = (c, fallBack = null) => accentWith(tok, c, fallBack);
  return new Map([
    ['aa', lit('å')],
    ['AA', lit('Å')],
    ['ss', lit('ß')],
    ['o', lit('ø')],
    ['O', lit('Ø')],
    ['L', lit('Ł')],
    ['l', lit('ł')],
    ['ae', lit('æ')],
    ['AE', lit('Æ')],
    ['oe', lit('œ')],
    ['OE', lit('Œ')],
    ['H', accent('\u030b')], // hungarumlaut
    ['`', accent('\u0300', '`')], // grave
    ["'", accent('\u0301', "'")], // acute
    ['^', accent('\u0302', '^')], // circ
    ['~', accent('\u0303', '~')], // tilde
    ['"', accent('\u0308')], // umlaut
    ['.', accent('\u0307')], // dot
    ['=', accent('\u0304')], // macron
    ['|', accent('\u030d')], // vertical line above
    ['b', accent('\u0331')], // macron below
    ['c', accent('\u0327')], // cedilla
    ['G', accent('\u030f')], // doublegrave
    ['h', accent('\u0309')], // hookabove
    ['d', accent('\u0323')], // dotbelow
    ['f', accent('\u0311')], // inverted breve
    ['r', accent('\u030a')], // ringabove
    ['t', accent('\u0361')], // double inverted breve
    ['U', accent('\u030e')], // double vertical line above
    ['v', accent('\u030c')], // hacek
    ['u', accent('\u0306')], // breve
    ['k', accent('\u0328')], // ogonek
    ['textogonekcentered', accent('\u0328')], // ogonek
    ['i', lit('ı')], // dotless i
    ['j', lit('ȷ')], // dotless j
    ['newtie', accent('\u0311')], // inverted breve
    ['textcircled', accent('\u20dd')], // combining circle
  ]);
};

const optRawopt = optional(rawopt);
const notInTableCell = (ctx) => (ctx.state.s.inTableCell ? FAIL : undefined);

/**
 * `\\`: a line break, but in a table cell.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.charCommands
 * @type {Command}
 */
function newline(ctx, start) {
  if (notInTableCell(ctx) === FAIL || optRawopt(ctx) === FAIL) return FAIL;
  if (spaces(ctx) === FAIL) return FAIL;
  return B.linebreak(start, ctx.state.at);
}

const nothing = () => [];

/**
 * @see Text.Pandoc.Readers.LaTeX.Inline.charCommands
 * @type {Map<string, Command>}
 */
export const charCommands = new Map([
  ['ldots', lit('…')],
  ['vdots', lit('\u22ee')],
  ['dots', lit('…')],
  ['mdots', lit('…')],
  ['sim', lit('~')],
  ['sep', lit(',')],
  ['P', lit('¶')],
  ['S', lit('§')],
  ['$', lit('$')],
  ['%', lit('%')],
  ['&', lit('&')],
  ['#', lit('#')],
  ['_', lit('_')],
  ['{', lit('{')],
  ['}', lit('}')],
  ['-', lit('\u00ad')], // soft hyphen
  // Haskell reads Pandoc's "\a0\x25FB" as BEL, `0` and the sign.
  ['qed', lit('\u00070\u25fb')],
  ['lq', lit('‘')],
  ['rq', lit('’')],
  ['textquoteleft', lit('‘')],
  ['textquoteright', lit('’')],
  ['textquotedblleft', lit('“')],
  ['textquotedblright', lit('”')],
  ['/', nothing], // italic correction
  ['\\', newline],
  [',', lit('\u2006')],
  ['@', nothing],
  [' ', lit(NBSP)],
  [
    'ps',
    (ctx, start) =>
      B.concat([
        B.str('PS.', start, ctx.state.at),
        B.space(ctx.state.at, ctx.state.at),
      ]),
  ],
  ['TeX', lit('TeX')],
  ['LaTeX', lit('LaTeX')],
  ['bar', lit('|')],
  ['textless', lit('<')],
  ['textgreater', lit('>')],
  ['textbackslash', lit('\\')],
  ['backslash', lit('\\')],
  ['slash', lit('/')],
  // fontawesome
  ['faCheck', lit('\u2713')],
  ['faClose', lit('\u2717')],
  // hyphenat
  ['bshyp', lit('\\\u00ad')],
  ['fshyp', lit('/\u00ad')],
  ['dothyp', lit('.\u00ad')],
  ['colonhyp', lit(':\u00ad')],
  ['hyp', lit('-')],
  // ngerman (babel)
  ['glq', lit('‚')],
  ['grq', lit('‘')],
  ['glqq', lit('„')],
  ['grqq', lit('“')],
  ['flq', lit('‹')],
  ['frq', lit('›')],
  ['flqq', lit('«')],
  ['frqq', lit('»')],
  ['dq', lit('"')],
  // fontspec
  ['guillemetleft', lit('«')],
  ['guillemotleft', lit('«')],
  ['guillemetright', lit('»')],
  ['guillemotright', lit('»')],
  ['guilsinglleft', lit('‹')],
  ['guilsinglright', lit('›')],
  ['quotedblbase', lit('„')],
  ['quotesinglbase', lit(',')],
  ['textquotedbl', lit('"')],
]);

// `tok`'s inlines made into others by `f`, which spans what it makes.
const wrap = (tok, f) => (ctx, start) => {
  const ils = tok(ctx);
  return ils === FAIL ? FAIL : f(ils, start, ctx.state.at);
};
const plainSpan = (ils, start, end) => B.spanWith(nullAttr, ils, start, end);
const between = (open, close) => (ils, start, end) =>
  plainSpan(
    B.concat([B.str(open, start, start), ils, B.str(close, end, end)]),
    start,
    end,
  );

/**
 * biblatex's inline commands.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.biblatexInlineCommands
 * @param {Parser<Inlines>} tok
 * @returns {Map<string, Command>}
 */
export const biblatexInlineCommands = (tok) =>
  new Map([
    // biblatex misc
    ['RN', romanNumeralUpper],
    ['Rn', romanNumeralLower],
    [
      'mkbibquote',
      wrap(tok, (ils, start, end) =>
        plainSpan(B.doubleQuoted(ils, start, end), start, end),
      ),
    ],
    ['mkbibemph', wrap(tok, (ils, s, e) => plainSpan(B.emph(ils, s, e), s, e))],
    [
      'mkbibitalic',
      wrap(tok, (ils, s, e) => plainSpan(B.emph(ils, s, e), s, e)),
    ],
    [
      'mkbibbold',
      wrap(tok, (ils, s, e) => plainSpan(B.strong(ils, s, e), s, e)),
    ],
    ['mkbibparens', wrap(tok, between('(', ')'))],
    ['mkbibbrackets', wrap(tok, between('[', ']'))],
    ['autocap', wrap(tok, plainSpan)],
    [
      'textnormal',
      wrap(tok, (ils, s, e) => B.spanWith(['', ['nodecor'], []], ils, s, e)),
    ],
    [
      'bibstring',
      (ctx, start) => {
        const v = braced(ctx);
        if (v === FAIL) return FAIL;
        const x = untokenize(v);
        const end = ctx.state.at;
        return B.spanWith(
          ['', [], [['bibstring', x]]],
          B.str(x, start, end),
          start,
          end,
        );
      },
    ],
    ['adddot', lit('.')],
    [
      'adddotspace',
      (ctx, start) => {
        const end = ctx.state.at;
        const ils = B.concat([B.str('.', start, end), B.space(end, end)]);
        return plainSpan(ils, start, end);
      },
    ],
    ['addabbrvspace', (ctx, start) => B.space(start, ctx.state.at)],
    ['hyphen', lit('-')],
  ]);

/**
 * `\proofname` and its kin.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.nameCommands
 * @type {Map<string, Command>}
 */
export const nameCommands = new Map([
  ['figurename', doTerm('Figure')],
  ['prefacename', doTerm('Preface')],
  ['refname', doTerm('References')],
  ['bibname', doTerm('Bibliography')],
  ['chaptername', doTerm('Chapter')],
  ['partname', doTerm('Part')],
  ['contentsname', doTerm('Contents')],
  ['listfigurename', doTerm('ListOfFigures')],
  ['listtablename', doTerm('ListOfTables')],
  ['indexname', doTerm('Index')],
  ['abstractname', doTerm('Abstract')],
  ['tablename', doTerm('Table')],
  ['enclname', doTerm('Encl')],
  ['ccname', doTerm('Cc')],
  ['headtoname', doTerm('To')],
  ['pagename', doTerm('Page')],
  ['seename', doTerm('See')],
  ['seealsoname', doTerm('SeeAlso')],
  ['proofname', doTerm('Proof')],
  ['glossaryname', doTerm('Glossary')],
  ['lstlistingname', doTerm('Listing')],
]);

/**
 * Labels, and references to them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.refCommands
 * @type {Map<string, Command>}
 */
export const refCommands = new Map([
  ['label', rawInlineOr('label', dolabel)],
  ['ref', rawInlineOr('ref', doref('ref'))],
  ['cref', rawInlineOr('cref', doref('ref+label'))], // from cleveref.sty
  ['Cref', rawInlineOr('Cref', doref('ref+Label'))], // from cleveref.sty
  ['vref', rawInlineOr('vref', doref('ref'))], // from varioref.sty
  ['eqref', rawInlineOr('eqref', doref('eqref'))], // from amsmath.sty
  ['autoref', rawInlineOr('autoref', doref('ref+label'))], // from hyperref.sty
]);

/**
 * An acronym, singular, in `form`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doAcronym
 * @param {string} form
 * @returns {Command}
 */
const doAcronym = (form) => acronym(`singular+${form}`, '');

/**
 * An acronym, plural, in `form`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doAcronymPlural
 * @param {string} form
 * @returns {Command}
 */
const doAcronymPlural = (form) => acronym(`plural+${form}`, 's');

const acronym = (form, suffix) => (ctx, start) => {
  const acro = braced(ctx);
  if (acro === FAIL) return FAIL;
  const label = untokenize(acro);
  const end = ctx.state.at;
  const attr = [
    '',
    [],
    [
      ['acronym-label', label],
      ['acronym-form', form],
    ],
  ];
  const text = B.concat([
    B.str(label, start, end),
    suffix === '' ? [] : B.str(suffix, end, end),
  ]);
  return B.spanWith(attr, text, start, end);
};

/**
 * The glossaries and acronym packages' commands.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.acronymCommands
 * @type {Map<string, Command>}
 */
export const acronymCommands = new Map([
  // glossaries package
  ['gls', doAcronym('short')],
  ['Gls', doAcronym('short')],
  ['glsdesc', doAcronym('long')],
  ['Glsdesc', doAcronym('long')],
  ['GLSdesc', doAcronym('long')],
  ['acrlong', doAcronym('long')],
  ['Acrlong', doAcronym('long')],
  ['acrfull', doAcronym('full')],
  ['Acrfull', doAcronym('full')],
  ['acrshort', doAcronym('abbrv')],
  ['Acrshort', doAcronym('abbrv')],
  ['glspl', doAcronymPlural('short')],
  ['Glspl', doAcronymPlural('short')],
  ['glsdescplural', doAcronymPlural('long')],
  ['Glsdescplural', doAcronymPlural('long')],
  ['GLSdescplural', doAcronymPlural('long')],
  // acronyms package
  ['ac', doAcronym('short')],
  ['acf', doAcronym('full')],
  ['acs', doAcronym('abbrv')],
  ['acl', doAcronym('long')],
  ['acp', doAcronymPlural('short')],
  ['acfp', doAcronymPlural('full')],
  ['acsp', doAcronymPlural('abbrv')],
  ['aclp', doAcronymPlural('long')],
  ['Ac', doAcronym('short')],
  ['Acf', doAcronym('full')],
  ['Acs', doAcronym('abbrv')],
  ['Acl', doAcronym('long')],
  ['Acp', doAcronymPlural('short')],
  ['Acfp', doAcronymPlural('full')],
  ['Acsp', doAcronymPlural('abbrv')],
  ['Aclp', doAcronymPlural('long')],
]);
