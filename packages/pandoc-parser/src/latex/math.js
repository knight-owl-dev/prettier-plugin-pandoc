// Math in LaTeX: `$` and `$$`, the math environments, and the theorem
// environments of amsthm.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Math`.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import { walk } from '../ast/walk.js';
import { alt, attempt, FAIL, manyTill, option, optional } from '../core.js';
import { trimMath } from '../shared.js';
import {
  anyTok,
  blankline,
  braced,
  bracketedToks,
  controlSeq,
  end_,
  env,
  getNextNumber,
  parseFromToks,
  removeLabel,
  renderDottedNum,
  resetCaption,
  sp,
  symbol,
  untokenize,
  updateLaTeXState,
} from './parsing.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {import('../ast/builder.js').Blocks} Blocks */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */

/**
 * `p` in math mode.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.withMathMode
 * @template T
 * @param {Parser<T>} p
 * @returns {Parser<T>}
 */
export const withMathMode = (p) => (ctx) => {
  const old = ctx.state.s.mathMode;
  updateLaTeXState(ctx, { mathMode: true });
  const result = p(ctx);
  if (result !== FAIL) updateLaTeXState(ctx, { mathMode: old });
  return result;
};

const dollar = symbol('$');
const display = option(false, (ctx) => (dollar(ctx) === FAIL ? FAIL : true));
const dollarsContents = attempt(withMathMode((ctx) => pDollarsMath(ctx)));

/**
 * `$…$` or `$$…$$`; `$$` with no math after it empty inline math.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.dollarsMath
 * @type {Parser<Inlines>}
 */
export function dollarsMath(ctx) {
  const start = ctx.state.at;
  if (dollar(ctx) === FAIL) return FAIL;
  const isDisplay = display(ctx);
  return alt(
    (c) => {
      const toks = dollarsContents(c);
      if (toks === FAIL) return FAIL;
      const contents = untokenize(toks);
      if (!isDisplay) return mathInline(contents, start, c.state.at);
      if (dollar(c) === FAIL) return FAIL;
      return mathDisplay(contents, start, c.state.at);
    },
    (c) => (isDisplay ? mathInline('', start, c.state.at) : FAIL),
  )(ctx);
}

/**
 * Math up to a `$` outside its groups; a group closed it never opened
 * fails it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.pDollarsMath
 * @returns {Tok[] | typeof FAIL}
 */
function pDollarsMath(ctx) {
  const out = [];
  for (let n = 0; ; ) {
    const tk = anyTok(ctx);
    if (tk === FAIL) return FAIL;
    if (tk.type === 'Symbol') {
      if (tk.text === '$' && n === 0) return out;
      if (tk.text === '\\') {
        const next = anyTok(ctx);
        if (next === FAIL) return FAIL;
        out.push(tk, next);
        continue;
      }
      if (tk.text === '{') n++;
      else if (tk.text === '}') {
        if (n === 0) return FAIL;
        n--;
      }
    }
    out.push(tk);
  }
}

/** @see Text.Pandoc.Readers.LaTeX.Math.mathDisplay */
export const mathDisplay = (t, start, end) =>
  B.displayMath(trimMath(t), start, end);

/** @see Text.Pandoc.Readers.LaTeX.Math.mathInline */
export const mathInline = (t, start, end) => B.math(trimMath(t), start, end);

/**
 * A math environment's contents as display math, in `innerEnv` where
 * given.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.mathEnvWith
 * @param {string | null} innerEnv
 * @param {string} name
 */
const mathEnvWith = (innerEnv, name) => {
  const p = mathEnv(name);
  return (ctx, start) => {
    const x = p(ctx);
    if (x === FAIL) return FAIL;
    const inner =
      innerEnv === null ? x : `\\begin{${innerEnv}}\n${x}\n\\end{${innerEnv}}`;
    return mathDisplay(inner, start, ctx.state.at);
  };
};

// Haskell's `trimr`: no spaces, tabs or line breaks at the end.
const trimr = (s) => s.replace(/[ \t\r\n]+$/, '');

/**
 * A math environment's contents, as written.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.mathEnv
 * @param {string} name
 * @returns {Parser<string>}
 */
function mathEnv(name) {
  const body = manyTill(anyTok, end_(name));
  return withMathMode((ctx) => {
    if (optional(blankline)(ctx) === FAIL) return FAIL;
    const res = body(ctx);
    return res === FAIL ? FAIL : trimr(untokenize(res));
  });
}

const begin = controlSeq('begin');

/**
 * `\begin` of an environment `inlineEnvironments` holds, to its end.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.inlineEnvironment
 * @type {Parser<Inlines>}
 */
export const inlineEnvironment = attempt((ctx) => {
  const start = ctx.state.at;
  if (begin(ctx) === FAIL) return FAIL;
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const p = INLINE_ENVIRONMENTS.get(untokenize(name));
  return p === undefined ? FAIL : p(ctx, start);
});

const mathEnvironment = (name) => {
  const p = mathEnv(name);
  return (ctx, start) => {
    const x = p(ctx);
    return x === FAIL ? FAIL : B.math(x, start, ctx.state.at);
  };
};

/**
 * The environments read as inline math, each given where its `\begin`
 * starts.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.inlineEnvironments
 * @type {Map<string, (ctx: object, start: number) => Inlines | typeof FAIL>}
 */
export const INLINE_ENVIRONMENTS = new Map([
  ['displaymath', mathEnvWith(null, 'displaymath')],
  ['math', mathEnvironment('math')],
  ['equation', mathEnvWith('equation', 'equation')],
  ['equation*', mathEnvWith('equation*', 'equation*')],
  ['gather', mathEnvWith('gather', 'gather')],
  ['gather*', mathEnvWith('gather*', 'gather*')],
  ['multline', mathEnvWith('multline', 'multline')],
  ['multline*', mathEnvWith('multline*', 'multline*')],
  ['eqnarray', mathEnvWith('eqnarray', 'eqnarray')],
  ['eqnarray*', mathEnvWith('eqnarray*', 'eqnarray*')],
  ['align', mathEnvWith('align', 'align')],
  ['align*', mathEnvWith('align*', 'align*')],
  ['alignat', mathEnvWith('alignat', 'alignat')],
  ['alignat*', mathEnvWith('alignat*', 'alignat*')],
  ['flalign', mathEnvWith('flalign', 'flalign')],
  ['flalign*', mathEnvWith('flalign*', 'flalign*')],
  // the following are not yet handled by texmath, so we use substitutes:
  ['dmath', mathEnvWith(null, 'dmath')],
  ['dmath*', mathEnvWith(null, 'dmath*')],
  ['dgroup', mathEnvWith('aligned', 'dgroup')],
  ['dgroup*', mathEnvWith('aligned', 'dgroup*')],
  ['darray', mathEnvWith('aligned', 'darray')],
  ['darray*', mathEnvWith('aligned', 'darray*')],
  ['subequations', mathEnvWith(null, 'subequations')],
]);

const THEOREM_STYLES = {
  plain: 'PlainStyle',
  definition: 'DefinitionStyle',
  remark: 'RemarkStyle',
};

/**
 * `\theoremstyle{…}`: the style of theorems defined after it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.theoremstyle
 * @type {Parser<Blocks>}
 */
export function theoremstyle(ctx) {
  const name = braced(ctx);
  if (name === FAIL) return FAIL;
  const style = Object.hasOwn(THEOREM_STYLES, untokenize(name))
    ? THEOREM_STYLES[untokenize(name)]
    : null;
  if (style !== null) updateLaTeXState(ctx, { lastTheoremStyle: style });
  return [];
}

const starred = (ctx) => (symbol('*')(ctx) === FAIL ? FAIL : sp(ctx));
const numbered = option(true, (ctx) => (starred(ctx) === FAIL ? FAIL : false));
const bracketedName = option(null, (ctx) => {
  const toks = bracketedToks(ctx);
  return toks === FAIL ? FAIL : untokenize(toks);
});
const showNameOf = alt(braced, (ctx) => {
  const t = anyTok(ctx);
  return t === FAIL ? FAIL : [t];
});

/**
 * A theorem environment's spec: its name's tokens, style, the counter it
 * shares, the counter it is numbered within, whether it is numbered, and
 * its last number.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.TheoremSpec
 * @typedef {object} TheoremSpec
 * @property {Tok[]} name
 * @property {'PlainStyle' | 'DefinitionStyle' | 'RemarkStyle'} style
 * @property {string | null} series
 * @property {string | null} syncTo
 * @property {boolean} number
 * @property {number[]} lastNum
 */

/**
 * `\newtheorem{name}[series]{Title}[within]`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.newtheorem
 * @type {Parser<Blocks>}
 */
export function newtheorem(ctx) {
  const number = numbered(ctx);
  if (number === FAIL) return FAIL;
  const nameToks = braced(ctx);
  if (nameToks === FAIL || sp(ctx) === FAIL) return FAIL;
  const series = bracketedName(ctx);
  if (series === FAIL || sp(ctx) === FAIL) return FAIL;
  const showName = showNameOf(ctx);
  if (showName === FAIL || sp(ctx) === FAIL) return FAIL;
  const syncTo = bracketedName(ctx);
  if (syncTo === FAIL) return FAIL;
  const { theoremMap, lastTheoremStyle } = ctx.state.s;
  /** @type {TheoremSpec} */
  const spec = {
    name: showName,
    style: lastTheoremStyle,
    series,
    syncTo,
    number,
    lastNum: [0],
  };
  updateLaTeXState(ctx, {
    theoremMap: new Map(theoremMap).set(untokenize(nameToks), spec),
  });
  return [];
}

const labelOf = ([, , kvs]) => kvs.find(([k]) => k === 'label')?.[1];

/**
 * A paragraph's first label, from a span among its inlines.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.extractLabelFromBlock
 * @returns {string | undefined}
 */
function extractLabelFromBlock(block) {
  if (block.t !== 'Para') return undefined;
  for (const x of block.c) {
    const lbl = x.t === 'Span' ? labelOf(x.c[0]) : undefined;
    if (lbl !== undefined) return lbl;
  }
  return undefined;
}

// Inlines no text of the source: empty spans at `at`.
const at = (ils, offset) =>
  mapSpans(
    ils,
    () => offset,
    () => offset,
  );

/**
 * A theorem environment defined by `\newtheorem`, its `\begin{name}` read
 * from `start`: its title, number and optional note before its body, which
 * is italic in the plain style.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.theoremEnvironment
 * @param {Parser<Blocks>} blocks
 * @param {Parser<Inlines>} inlines
 * @param {Parser<Inlines>} opt
 * @param {string} name
 * @param {number} start
 * @returns {Parser<Blocks>}
 */
export const theoremEnvironment = (blocks, inlines, opt, name, start) => {
  const body = env(name, blocks);
  const note = option(null, opt);
  return (ctx) => {
    resetCaption(ctx);
    const tspec = ctx.state.s.theoremMap.get(name);
    if (tspec === undefined) return FAIL;
    const optFrom = ctx.state.at;
    const x = note(ctx);
    if (x === FAIL) return FAIL;
    const optTitle =
      x === null
        ? []
        : B.concat([
            B.space(optFrom, optFrom),
            B.str('(', optFrom, optFrom),
            x,
            B.str(')', ctx.state.at, ctx.state.at),
          ]);
    const titleEnd = ctx.state.at;
    const bs = body(ctx);
    if (bs === FAIL) return FAIL;
    let mblabel;
    for (const b of bs) {
      mblabel = extractLabelFromBlock(b);
      if (mblabel !== undefined) break;
    }

    let number = [];
    if (tspec.number) {
      const series = tspec.series ?? name;
      const num = getNextNumber(
        (s) => s.theoremMap.get(series)?.lastNum ?? [0],
      )(ctx);
      const { theoremMap, labels } = ctx.state.s;
      const spec = theoremMap.get(series);
      if (spec !== undefined) {
        updateLaTeXState(ctx, {
          theoremMap: new Map(theoremMap).set(series, {
            ...spec,
            lastNum: num,
          }),
        });
      }
      if (mblabel !== undefined) {
        updateLaTeXState(ctx, {
          labels: new Map(labels).set(
            mblabel,
            B.str(renderDottedNum(num), start, start),
          ),
        });
      }
      number = B.concat([B.space(), B.text(renderDottedNum(num))]);
    }
    const titleEmph = tspec.style === 'RemarkStyle' ? B.emph : B.strong;
    const tname = parseFromToks(inlines, tspec.name)(ctx);
    if (tname === FAIL) return FAIL;
    const title = B.concat([
      titleEmph(at(B.concat([tname, number]), start), start, start),
      optTitle,
      B.str('.', titleEnd, titleEnd),
      B.space(titleEnd, titleEnd),
    ]);
    const styled =
      tspec.style === 'PlainStyle' ? walk({ block: italicize }, bs) : bs;
    const unlabeled =
      mblabel === undefined ? styled : removeLabel(mblabel, styled);
    return B.divWith(
      [mblabel ?? '', [name], []],
      addTitle(title, unlabeled),
      start,
      ctx.state.at,
    );
  };
};

/**
 * The `proof` environment, its `\begin` read from `start`: its title,
 * "Proof" unless given, and a QED sign after its body.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.proof
 * @param {Parser<Blocks>} blocks
 * @param {Parser<Inlines>} opt
 * @returns {(ctx: object, start: number) => Blocks | typeof FAIL}
 */
export const proof = (blocks, opt) => {
  const body = env('proof', blocks);
  const title = option(null, opt);
  return (ctx, start) => {
    const given = title(ctx);
    if (given === FAIL) return FAIL;
    const ils = given ?? at(B.text('Proof'), start);
    const titleEnd = ctx.state.at;
    const bs = body(ctx);
    if (bs === FAIL) return FAIL;
    const end = ctx.state.at;
    const emphasized = B.concat([ils, B.str('.', titleEnd, titleEnd)]);
    return B.divWith(
      ['', ['proof'], []],
      addQed(
        addTitle(B.emph(emphasized, emphasized[0].start, titleEnd), bs),
        end,
      ),
      start,
      end,
    );
  };
};

/**
 * `ils` before the first paragraph's inlines, a space between; else a
 * paragraph of them first. A paragraph's span reaches back to them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.addTitle
 * @param {Inlines} ils
 * @param {Blocks} bs
 * @returns {Blocks}
 */
function addTitle(ils, bs) {
  const [first, ...rest] = bs;
  const from = ils[0].start;
  const to = ils.at(-1).end;
  if (first?.t === 'Para') {
    const xs = [...ils, ...B.space(to, to), ...first.c];
    return [...B.para(xs, Math.min(from, first.start), first.end), ...rest];
  }
  return [...B.para(ils, from, to), ...bs];
}

/**
 * A QED sign at the end of the last paragraph; else a paragraph of it
 * last, at `end`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.addQed
 * @param {Blocks} bs
 * @param {number} end
 * @returns {Blocks}
 */
function addQed(bs, end) {
  const last = bs.at(-1);
  if (last?.t === 'Para') {
    const sign = B.str(' ◻', last.end, last.end);
    return [
      ...bs.slice(0, -1),
      ...B.para([...last.c, ...sign], last.start, last.end),
    ];
  }
  return [...bs, ...B.para(B.str(' ◻', end, end), end, end)];
}

const isImage = (ils) => ils.length === 1 && ils[0].t === 'Image';

/**
 * A paragraph's inlines emphasized, but a lone image (#6925).
 *
 * @see Text.Pandoc.Readers.LaTeX.Math.italicize
 */
function italicize(x) {
  if ((x.t === 'Para' || x.t === 'Plain') && !isImage(x.c)) {
    return new Node(x.t, B.emph(x.c, x.start, x.end), x.start, x.end);
  }
  return x;
}
