// Citations in LaTeX: natbib's and biblatex's commands, their pre- and
// postnotes, and `\citetext`.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Citation`. Each
// command reads what follows its name, which starts at `start`.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import {
  alt,
  attempt,
  count,
  FAIL,
  many,
  many1,
  manyTill,
  notFollowedBy,
  optional,
  optionMaybe,
  sepBy1,
} from '../core.js';
import {
  addMeta,
  bgroup,
  bracketedToks,
  controlSeq,
  egroup,
  grouped,
  isWordTok,
  lpContext,
  parenWrapped,
  prepend,
  satisfyTok,
  sp,
  spaces,
  symbol,
  symbolIn,
  untokenize,
  withRaw,
} from './parsing.js';

/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {(ctx: object, start: number) => Inlines | typeof FAIL} Command */

/**
 * A citation, as Aeson encodes the record.
 *
 * @see Text.Pandoc.Definition.Citation
 * @typedef {object} Citation
 * @property {string} citationId
 * @property {Inlines} citationPrefix
 * @property {Inlines} citationSuffix
 * @property {{t: string}} citationMode
 * @property {number} citationNoteNum
 * @property {number} citationHash
 */

const NormalCitation = { t: 'NormalCitation' };
const SuppressAuthor = { t: 'SuppressAuthor' };
const AuthorInText = { t: 'AuthorInText' };

/**
 * natbib's and biblatex's citation commands, reading their inlines by
 * `inline`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.citationCommands
 * @param {Parser<Inlines>} inline
 * @returns {Map<string, Command>}
 */
export function citationCommands(inline) {
  const citation = (name, mode, multi) =>
    citationWith(inline, name, mode, multi);
  const footnoted = (name, mode, multi) => inNote(citation(name, mode, multi));
  const tok = (ctx) => (spaces(ctx) === FAIL ? FAIL : groupedInline(ctx));
  const groupedInline = grouped(inline, B.concat);
  const citetextAhead = attempt((ctx) => {
    if (tok(ctx) === FAIL || sp(ctx) === FAIL) return FAIL;
    return controlSeq('citetext')(ctx);
  });
  const natbibAuthor = complexNatbibCitation(inline, AuthorInText);
  const author = citation('citeauthor', AuthorInText, false);
  const nocite = citation('nocite', NormalCitation, false);
  return new Map([
    ['cite', citation('cite', NormalCitation, false)],
    ['Cite', citation('Cite', NormalCitation, false)],
    ['citep', citation('citep', NormalCitation, false)],
    ['citep*', citation('citep*', NormalCitation, false)],
    ['citeal', citation('citeal', NormalCitation, false)],
    ['citealp', citation('citealp', NormalCitation, false)],
    ['citealp*', citation('citealp*', NormalCitation, false)],
    ['autocite', citation('autocite', NormalCitation, false)],
    ['smartcite', citation('smartcite', NormalCitation, false)],
    ['footcite', footnoted('footcite', NormalCitation, false)],
    ['parencite', citation('parencite', NormalCitation, false)],
    ['supercite', citation('supercite', NormalCitation, false)],
    ['footcitetext', footnoted('footcitetext', NormalCitation, false)],
    ['citeyearpar', citation('citeyearpar', SuppressAuthor, false)],
    ['citeyear', citation('citeyear', SuppressAuthor, false)],
    ['autocite*', citation('autocite*', SuppressAuthor, false)],
    ['cite*', citation('cite*', SuppressAuthor, false)],
    ['parencite*', citation('parencite*', SuppressAuthor, false)],
    ['textcite', citation('textcite', AuthorInText, false)],
    ['citet', citation('citet', AuthorInText, false)],
    ['citet*', citation('citet*', AuthorInText, false)],
    ['citealt', citation('citealt', AuthorInText, false)],
    ['citealt*', citation('citealt*', AuthorInText, false)],
    ['textcites', citation('textcites', AuthorInText, true)],
    ['cites', citation('cites', NormalCitation, true)],
    ['autocites', citation('autocites', NormalCitation, true)],
    ['footcites', footnoted('footcites', NormalCitation, true)],
    ['parencites', citation('parencites', NormalCitation, true)],
    ['supercites', citation('supercites', NormalCitation, true)],
    ['footcitetexts', footnoted('footcitetexts', NormalCitation, true)],
    ['Autocite', citation('Autocite', NormalCitation, false)],
    ['Smartcite', citation('Smartcite', NormalCitation, false)],
    ['Footcite', footnoted('Footcite', NormalCitation, false)],
    ['Parencite', citation('Parencite', NormalCitation, false)],
    ['Supercite', citation('Supercite', NormalCitation, false)],
    ['Footcitetext', footnoted('Footcitetext', NormalCitation, false)],
    ['Citeyearpar', citation('Citeyearpar', SuppressAuthor, false)],
    ['Citeyear', citation('Citeyear', SuppressAuthor, false)],
    ['Autocite*', citation('Autocite*', SuppressAuthor, false)],
    ['Cite*', citation('Cite*', SuppressAuthor, false)],
    ['Parencite*', citation('Parencite*', SuppressAuthor, false)],
    ['Textcite', citation('Textcite', AuthorInText, false)],
    ['Textcites', citation('Textcites', AuthorInText, true)],
    ['Cites', citation('Cites', NormalCitation, true)],
    ['Autocites', citation('Autocites', NormalCitation, true)],
    ['Footcites', footnoted('Footcites', NormalCitation, true)],
    ['Parencites', citation('Parencites', NormalCitation, true)],
    ['Supercites', citation('Supercites', NormalCitation, true)],
    ['Footcitetexts', footnoted('Footcitetexts', NormalCitation, true)],
    ['citetext', complexNatbibCitation(inline, NormalCitation)],
    [
      'citeauthor',
      (ctx, start) => {
        const at = ctx.pos;
        if (citetextAhead(ctx) !== FAIL) return natbibAuthor(ctx, start);
        return ctx.pos === at ? author(ctx, start) : FAIL;
      },
    ],
    [
      'nocite',
      (ctx, start) => {
        const c = nocite(ctx, start);
        if (c === FAIL) return FAIL;
        addMeta(ctx, 'nocite', B.metaInlines(c));
        return [];
      },
    ],
  ]);
}

/**
 * Citations with `p` before the first one's prefix.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.addPrefix
 * @param {Inlines} p
 * @param {Citation[]} ks
 * @returns {Citation[]}
 */
function addPrefix(p, ks) {
  if (ks.length === 0) return [];
  const [k, ...rest] = ks;
  return [{ ...k, citationPrefix: [...p, ...k.citationPrefix] }, ...rest];
}

/**
 * Citations with `s` after the last one's suffix.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.addSuffix
 * @param {Inlines} s
 * @param {Citation[]} ks
 * @returns {Citation[]}
 */
function addSuffix(s, ks) {
  if (ks.length === 0) return [];
  const k = ks.at(-1);
  return [
    ...ks.slice(0, -1),
    { ...k, citationSuffix: [...k.citationSuffix, ...s] },
  ];
}

const optToks = attempt((ctx) => {
  if (sp(ctx) === FAIL) return FAIL;
  const toks = bracketedToks(ctx);
  return toks === FAIL || sp(ctx) === FAIL ? FAIL : toks;
});

const bibtexKeyChar = ".:;?!`'()/*@_+=-&[]";
const keyToks = many1(alt(satisfyTok(isWordTok), symbolIn(bibtexKeyChar)));

/**
 * A citation key, and the comma after it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.citationLabel
 * @type {Parser<string>}
 */
function citationLabel(ctx) {
  if (sp(ctx) === FAIL) return FAIL;
  const toks = keyToks(ctx);
  if (toks === FAIL || sp(ctx) === FAIL) return FAIL;
  if (optional(symbol(','))(ctx) === FAIL || sp(ctx) === FAIL) return FAIL;
  return untokenize(toks);
}

const keys = attempt((ctx) =>
  bgroup(ctx) === FAIL ? FAIL : manyTill(citationLabel, egroup)(ctx),
);

/**
 * `[prenote][postnote]{key,…}`: the citations, the notes around them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.simpleCiteArgs
 * @param {Parser<Inlines>} inline
 * @returns {Parser<Citation[]>}
 */
function simpleCiteArgs(inline) {
  // The bracketed option read as inlines on its own, as `LaTeX.hs`'s `opt`.
  const opt = (ctx) => {
    const toks = optToks(ctx);
    if (toks === FAIL) return FAIL;
    const sub = lpContext(
      prepend(toks, null),
      ctx.state.s,
      toks.at(-1)?.end,
      ctx.common,
    );
    const ils = many(inline)(sub);
    if (ils === FAIL) {
      throw new Error(
        `the LaTeX reader failed in an option at offset ${sub.state.at}`,
      );
    }
    return B.concat(ils);
  };
  const note = optionMaybe(opt);
  return attempt((ctx) => {
    const first = note(ctx);
    if (first === FAIL) return FAIL;
    const second = note(ctx);
    if (second === FAIL) return FAIL;
    const ks = keys(ctx);
    if (ks === FAIL) return FAIL;
    let [pre, suf] = [[], []];
    if (first !== null && second === null) suf = first;
    else if (first !== null && second !== null) [pre, suf] = [first, second];
    const conv = (k) => ({
      citationId: k,
      citationPrefix: [],
      citationSuffix: [],
      citationMode: NormalCitation,
      citationNoteNum: 0,
      citationHash: 0,
    });
    return addPrefix(pre, addSuffix(suf, ks.map(conv)));
  });
}

/**
 * Citations in `mode`, all of them or, in text, the first; `multi` reads
 * several groups, each with its notes, after notes for them all in
 * parentheses.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.cites
 * @param {Parser<Inlines>} inline
 * @param {{t: string}} mode
 * @param {boolean} multi
 * @returns {Parser<Citation[]>}
 */
export function cites(inline, mode, multi) {
  const paropt = optionMaybe(parenWrapped(inline, B.concat));
  const args = simpleCiteArgs(inline);
  const several = many1(args);
  const one = count(1, args);
  // The multi-prenote, a space after it where the first has a prefix too.
  const addMprenote = (mpn, ks) => {
    if (ks.length === 0) return [];
    const k = ks[0];
    const mpnfinal =
      k.citationPrefix.length > 0 && mpn.length > 0
        ? [...mpn, spaceAfter(mpn)]
        : mpn;
    return addPrefix(mpnfinal, ks);
  };
  // The multi-postnote, a comma and space before it.
  const addMpostnote = (mpn, ks) =>
    addSuffix(mpn.length === 0 ? [] : [...commaBefore(mpn), ...mpn], ks);
  return attempt((ctx) => {
    let cits;
    if (multi) {
      const multiprenote = paropt(ctx);
      if (multiprenote === FAIL) return FAIL;
      const multipostnote = paropt(ctx);
      if (multipostnote === FAIL) return FAIL;
      let [pre, suf] = [[], []];
      if (multiprenote !== null && multipostnote === null) suf = multiprenote;
      else if (multiprenote === null && multipostnote !== null) {
        suf = multipostnote;
      } else if (multiprenote !== null && multipostnote !== null) {
        [pre, suf] = [multiprenote, multipostnote];
      }
      const tempCits = several(ctx);
      if (tempCits === FAIL) return FAIL;
      const [k, ...ks] = tempCits;
      cits =
        ks.length > 0
          ? [
              addMprenote(pre, k),
              ...ks.slice(0, -1),
              addMpostnote(suf, ks.at(-1)),
            ]
          : [addMprenote(pre, addMpostnote(suf, k))];
    } else {
      cits = one(ctx);
      if (cits === FAIL) return FAIL;
    }
    const cs = cits.flat();
    if (mode.t === 'AuthorInText') {
      return cs.length === 0
        ? []
        : [{ ...cs[0], citationMode: mode }, ...cs.slice(1)];
    }
    return cs.map((c) => ({ ...c, citationMode: mode }));
  });
}

// A space after a note: no text of the source, an empty span at its end.
const spaceAfter = (ils) => {
  const end = ils.at(-1).end;
  return new Node('Space', undefined, end, end);
};
// `,` and a space before a note, spanning nothing where it starts.
const commaBefore = (ils) => {
  const { start } = ils[0];
  return [
    new Node('Str', ',', start, start),
    new Node('Space', undefined, start, start),
  ];
};

/**
 * A citation command: the citations, the command raw for their text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.citationWith
 * @param {Parser<Inlines>} inline
 * @param {string} name
 * @param {{t: string}} mode
 * @param {boolean} multi
 * @returns {Command}
 */
function citationWith(inline, name, mode, multi) {
  const read = withRaw(cites(inline, mode, multi));
  return (ctx, start) => {
    const r = read(ctx);
    if (r === FAIL) return FAIL;
    const [c, raw] = r;
    const end = ctx.state.at;
    const text = B.rawInline(
      'latex',
      `\\${name}${untokenize(raw)}`,
      start,
      end,
    );
    return B.cite(c, text, start, end);
  };
}

/**
 * A part of `\citetext`: the citations of its cite, the inlines before it
 * their prefix and after it their suffix.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.handleCitationPart
 * @param {Inlines} ils
 * @returns {Citation[]}
 */
function handleCitationPart(ils) {
  const i = ils.findIndex((x) => x.t === 'Cite');
  if (i === -1) return [];
  return addPrefix(ils.slice(0, i), addSuffix(ils.slice(i + 1), ils[i].c[0]));
}

/**
 * natbib's `\citetext{…; …}`: the cites in its parts, with the text around
 * each.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.complexNatbibCitation
 * @param {Parser<Inlines>} inline
 * @param {{t: string}} mode
 * @returns {Command}
 */
function complexNatbibCitation(inline, mode) {
  const semicolon = symbol(';');
  const notSemicolon = notFollowedBy(semicolon);
  const part = many1((c) => (notSemicolon(c) === FAIL ? FAIL : inline(c)));
  const parts = sepBy1(part, semicolon);
  const read = withRaw((ctx) => {
    if (bgroup(ctx) === FAIL) return FAIL;
    // Pandoc's `mconcat` applies to the parts' list, not each part's
    // inlines (`sepBy1` binds tighter than `<$>`): each inline is a part,
    // and a cite gets no text around it.
    const items = parts(ctx);
    if (items === FAIL || egroup(ctx) === FAIL) return FAIL;
    return items.flat().flatMap(handleCitationPart);
  });
  return (ctx, start) =>
    attempt((c) => {
      const r = read(c);
      if (r === FAIL) return FAIL;
      const [cs, raw] = r;
      if (cs.length === 0) return FAIL;
      const end = c.state.at;
      const text = B.rawInline(
        'latex',
        `\\citetext${untokenize(raw)}`,
        start,
        end,
      );
      return B.cite(
        [{ ...cs[0], citationMode: mode }, ...cs.slice(1)],
        text,
        start,
        end,
      );
    })(ctx);
}

/**
 * Citations in a note, a period after them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Citation.inNote
 * @param {Command} p
 * @returns {Command}
 */
const inNote = (p) => (ctx, start) => {
  const ils = p(ctx, start);
  if (ils === FAIL) return FAIL;
  const end = ctx.state.at;
  const para = B.para(B.concat([ils, B.str('.', end, end)]), start, end);
  return B.note(para, start, end);
};
