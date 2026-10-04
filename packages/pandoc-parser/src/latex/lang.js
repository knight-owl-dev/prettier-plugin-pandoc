// Languages in LaTeX: babel's and polyglossia's names as BCP 47 tags,
// the commands and environments setting a passage's language, and quotes
// by csquotes.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Lang`.

import * as B from '../ast/builder.js';
import { lang, renderLang } from '../collate/lang.js';
import { FAIL, option } from '../core.js';
import { extractSpaces } from '../shared.js';
import { setTranslations } from '../translations.js';
import {
  braced,
  rawopt,
  skipopts,
  untokenize,
  updateLaTeXState,
  withQuoteContext,
} from './parsing.js';

/** @typedef {import('../collate/lang.js').Lang} Lang */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {(ctx: object, start: number) => Inlines | typeof FAIL} Command */

const langAttr = (l) => ['', [], [['lang', renderLang(l)]]];

/**
 * `tok` quoted, in single quotes where starred or within double quotes,
 * in language `mblang` where it names one.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.enquote
 * @param {Parser<Inlines>} tok
 * @param {boolean} starred
 * @param {string | null} mblang
 * @returns {Command}
 */
function enquote(tok, starred, mblang) {
  const inSingle = withQuoteContext('InSingleQuote', tok);
  const inDouble = withQuoteContext('InDoubleQuote', tok);
  return (ctx, start) => {
    if (skipopts(ctx) === FAIL) return FAIL;
    const l = mblang === null ? null : babelLangToBCP47(mblang);
    const single = starred || ctx.state.s.quoteContext === 'InDoubleQuote';
    const ils = (single ? inSingle : inDouble)(ctx);
    if (ils === FAIL) return FAIL;
    const end = ctx.state.at;
    const inner = l === null ? ils : B.spanWith(langAttr(l), ils, start, end);
    return (single ? B.singleQuoted : B.doubleQuoted)(inner, start, end);
  };
}

// A quote in the language its braced argument names.
const foreign = (tok, starred) => (ctx, start) => {
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  return enquote(tok, starred, untokenize(name))(ctx, start);
};

/**
 * csquotes' quotes.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.enquoteCommands
 * @param {Parser<Inlines>} tok
 * @returns {Map<string, Command>}
 */
export const enquoteCommands = (tok) =>
  new Map([
    ['enquote*', enquote(tok, true, null)],
    ['enquote', enquote(tok, false, null)],
    // foreignquote is supposed to use native quote marks
    ['foreignquote*', foreign(tok, true)],
    ['foreignquote', foreign(tok, false)],
    // hyphenquote uses regular quotes
    ['hyphenquote*', foreign(tok, true)],
    ['hyphenquote', foreign(tok, false)],
  ]);

/**
 * `\foreignlanguage{lang}{…}`: a span in the language where babel knows
 * it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.foreignlanguage
 * @param {Parser<Inlines>} tok
 * @returns {Command}
 */
const foreignlanguage = (tok) => (ctx, start) => {
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const l = babelLangToBCP47(untokenize(name));
  const ils = tok(ctx);
  if (ils === FAIL || l === null) return ils;
  return B.spanWith(langAttr(l), ils, start, ctx.state.at);
};

/**
 * `\foreignlanguage`, and polyglossia's `\text<language>`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.inlineLanguageCommands
 * @param {Parser<Inlines>} tok
 * @returns {Map<string, Command>}
 */
export const inlineLanguageCommands = (tok) =>
  new Map([
    ['foreignlanguage', foreignlanguage(tok)],
    ...[...POLYGLOSSIA].map(([name, f]) => [
      `text${name}`,
      inlineLanguage(tok, f),
    ]),
  ]);

// An option in brackets, as written, without its brackets.
const bareOption = option('', (ctx) => {
  const o = rawopt(ctx);
  return o === FAIL ? FAIL : o.replace(/[[\]]/g, '');
});

/**
 * A span in the language `bcp47Func` makes of the option.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.inlineLanguage
 * @param {Parser<Inlines>} tok
 * @param {(o: string) => Lang} bcp47Func
 * @returns {Command}
 */
const inlineLanguage = (tok, bcp47Func) => (ctx, start) => {
  const o = bareOption(ctx);
  if (o === FAIL) return FAIL;
  const attr = langAttr(bcp47Func(o));
  const ils = tok(ctx);
  if (ils === FAIL) return FAIL;
  return extractSpaces(
    (xs, from, to) => B.spanWith(attr, xs, from, to),
    ils,
    start,
    ctx.state.at,
  );
};

/**
 * `\setdefaultlanguage[options]{language}`: the document's language, for
 * its terms and metadata.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.setDefaultLanguage
 * @param {object} ctx
 * @param {number} start
 */
export function setDefaultLanguage(ctx, start) {
  const o = bareOption(ctx);
  if (o === FAIL) return FAIL;
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const f = POLYGLOSSIA.get(untokenize(name));
  if (f === undefined) return [];
  const l = f(o);
  setTranslations(ctx.common, l);
  const value = B.str(renderLang(l), start, start);
  updateLaTeXState(ctx, { meta: B.setMeta('lang', value, ctx.state.s.meta) });
  return [];
}

const simpleLang = (code) => lang(code);

// A language whose options choose among tags, spaces in them ignored.
const byOption = (choices, fallback) => (o) =>
  choices[o.replaceAll(' ', '')] ?? fallback;

/**
 * Polyglossia's languages, each a function of its options.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.polyglossiaLangToBCP47
 * @type {Map<string, (o: string) => Lang>}
 */
export const POLYGLOSSIA = new Map([
  [
    'arabic',
    byOption(
      {
        'locale=algeria': lang('ar', { region: 'DZ' }),
        'locale=mashriq': lang('ar', { region: 'SY' }),
        'locale=libya': lang('ar', { region: 'LY' }),
        'locale=morocco': lang('ar', { region: 'MA' }),
        'locale=mauritania': lang('ar', { region: 'MR' }),
        'locale=tunisia': lang('ar', { region: 'TN' }),
      },
      lang('ar'),
    ),
  ],
  [
    'german',
    byOption(
      {
        'spelling=old': lang('de', { region: 'DE', variants: ['1901'] }),
        'variant=austrian,spelling=old': lang('de', {
          region: 'AT',
          variants: ['1901'],
        }),
        'variant=austrian': lang('de', { region: 'AT' }),
        'variant=swiss,spelling=old': lang('de', {
          region: 'CH',
          variants: ['1901'],
        }),
        'variant=swiss': lang('de', { region: 'CH' }),
      },
      lang('de'),
    ),
  ],
  ['lsorbian', () => lang('dsb')],
  [
    'greek',
    byOption(
      {
        'variant=poly': lang('el', { region: 'polyton' }),
        'variant=ancient': lang('grc'),
      },
      lang('el'),
    ),
  ],
  [
    'english',
    byOption(
      {
        'variant=australian': lang('en', { region: 'AU' }),
        'variant=canadian': lang('en', { region: 'CA' }),
        'variant=british': lang('en', { region: 'GB' }),
        'variant=newzealand': lang('en', { region: 'NZ' }),
        'variant=american': lang('en', { region: 'US' }),
      },
      lang('en'),
    ),
  ],
  ['usorbian', () => lang('hsb')],
  [
    'latin',
    byOption(
      { 'variant=classic': lang('la', { variants: ['x-classic'] }) },
      lang('la'),
    ),
  ],
  ['slovenian', () => lang('sl')],
  ['serbianc', () => lang('sr', { script: 'Cyrl' })],
  ['pinyin', () => lang('zh', { script: 'Latn', variants: ['pinyin'] })],
  ...[
    ['afrikaans', 'af'],
    ['amharic', 'am'],
    ['assamese', 'as'],
    ['asturian', 'ast'],
    ['bulgarian', 'bg'],
    ['bengali', 'bn'],
    ['tibetan', 'bo'],
    ['breton', 'br'],
    ['catalan', 'ca'],
    ['welsh', 'cy'],
    ['czech', 'cs'],
    ['coptic', 'cop'],
    ['danish', 'da'],
    ['divehi', 'dv'],
    ['esperanto', 'eo'],
    ['spanish', 'es'],
    ['estonian', 'et'],
    ['basque', 'eu'],
    ['farsi', 'fa'],
    ['finnish', 'fi'],
    ['french', 'fr'],
    ['friulan', 'fur'],
    ['irish', 'ga'],
    ['scottish', 'gd'],
    ['ethiopic', 'gez'],
    ['galician', 'gl'],
    ['hebrew', 'he'],
    ['hindi', 'hi'],
    ['croatian', 'hr'],
    ['magyar', 'hu'],
    ['armenian', 'hy'],
    ['gujarati', 'gu'],
    ['interlingua', 'ia'],
    ['indonesian', 'id'],
    ['icelandic', 'is'],
    ['italian', 'it'],
    ['japanese', 'ja'],
    ['khmer', 'km'],
    ['kurmanji', 'kmr'],
    ['kannada', 'kn'],
    ['korean', 'ko'],
    ['lao', 'lo'],
    ['lithuanian', 'lt'],
    ['latvian', 'lv'],
    ['malayalam', 'ml'],
    ['mongolian', 'mn'],
    ['marathi', 'mr'],
    ['dutch', 'nl'],
    ['nynorsk', 'nn'],
    ['norsk', 'no'],
    ['nko', 'nqo'],
    ['occitan', 'oc'],
    ['oriya', 'or'],
    ['punjabi', 'pa'],
    ['polish', 'pl'],
    ['piedmontese', 'pms'],
    ['portuguese', 'pt'],
    ['romansh', 'rm'],
    ['romanian', 'ro'],
    ['russian', 'ru'],
    ['sanskrit', 'sa'],
    ['samin', 'se'],
    ['slovak', 'sk'],
    ['albanian', 'sq'],
    ['serbian', 'sr'],
    ['swedish', 'sv'],
    ['syriac', 'syr'],
    ['tamil', 'ta'],
    ['telugu', 'te'],
    ['thai', 'th'],
    ['turkmen', 'tk'],
    ['turkish', 'tr'],
    ['ukrainian', 'uk'],
    ['urdu', 'ur'],
    ['vietnamese', 'vi'],
  ].map(([name, code]) => [name, () => simpleLang(code)]),
]);

const BABEL = new Map([
  ['austrian', lang('de', { region: 'AT', variants: ['1901'] })],
  ['naustrian', lang('de', { region: 'AT' })],
  ['swissgerman', lang('de', { region: 'CH', variants: ['1901'] })],
  ['nswissgerman', lang('de', { region: 'CH' })],
  ['german', lang('de', { region: 'DE', variants: ['1901'] })],
  ['ngerman', lang('de', { region: 'DE' })],
  ['lowersorbian', lang('dsb')],
  ['uppersorbian', lang('hsb')],
  ['polytonicgreek', lang('el', { variants: ['polyton'] })],
  ['polutonikogreek', lang('el', { variants: ['polyton'] })],
  ['slovene', simpleLang('sl')],
  ['australian', lang('en', { region: 'AU' })],
  ['canadian', lang('en', { region: 'CA' })],
  ['british', lang('en', { region: 'GB' })],
  ['newzealand', lang('en', { region: 'NZ' })],
  ['american', lang('en', { region: 'US' })],
  ['classiclatin', lang('la', { variants: ['x-classic'] })],
]);

/**
 * A babel language's tag; else polyglossia's with no options; else null.
 *
 * @see Text.Pandoc.Readers.LaTeX.Lang.babelLangToBCP47
 * @param {string} s
 * @returns {Lang | null}
 */
export function babelLangToBCP47(s) {
  const babel = BABEL.get(s);
  if (babel !== undefined) return babel;
  const f = POLYGLOSSIA.get(s);
  return f === undefined ? null : f('');
}
