// Macro definitions: `\newcommand` and its kin, `\def` and its kin, `\let`,
// `\newif` and `\newenvironment`; recorded where `latex_macros` is on, kept
// raw where it is off.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Macro`.

import { alt, attempt, FAIL, many, many1, option, optional } from '../core.js';
import { message, report } from '../logging.js';
import {
  anyControlSeq,
  anyTok,
  braced,
  bracedOrToken,
  bracketedToks,
  controlSeq,
  isArgTok,
  parseFromToks,
  satisfyTok,
  singleChar,
  spaces,
  symbol,
  untokenize,
  updateLaTeXState,
  withRaw,
  withVerbatimMode,
} from './parsing.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('./parsing.js').Macro} Macro */

const macrosOn = (ctx) => ctx.state.s.options.extensions.has('latex_macros');

/**
 * A macro definition: recorded where `latex_macros` is on, giving nothing;
 * else `construct` of its text and span.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.macroDef
 * @template T
 * @param {(text: string, start: number, end: number) => T[]} construct
 * @returns {import('../core.js').Parser<T[]>}
 */
export const macroDef = (construct) => (ctx) => {
  const start = ctx.state.at;
  const read = withRaw(alt(commandDef, environmentDef))(ctx);
  if (read === FAIL) return FAIL;
  if (macrosOn(ctx)) return [];
  return construct(untokenize(read[1]), start, ctx.state.at);
};

const commandDefs = alt(
  newcommand,
  checkGlobal(alt(letmacro, edefmacro, defmacro, newif)),
);

function commandDef(ctx) {
  const pairs = commandDefs(ctx);
  if (pairs === FAIL) return FAIL;
  if (macrosOn(ctx)) for (const pair of pairs) insertMacro(ctx, pair);
  return undefined;
}

// `\newenvironment{envname}[n-args][default]{begin}{end}` is
// `\newcommand{\envname}[n-args][default]{begin}` and
// `\newcommand{\endenvname}{end}`.
function environmentDef(ctx) {
  const env = newenvironment(ctx);
  if (env === FAIL) return FAIL;
  if (env !== null && macrosOn(ctx)) {
    const [name, begin, end] = env;
    insertMacro(ctx, [name, begin]);
    insertMacro(ctx, [`end${name}`, end]);
  }
  return undefined;
}

/**
 * A macro into the table: a global one into every group's, any other into
 * the innermost's.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.insertMacro
 * @param {[string, Macro]} pair
 */
function insertMacro(ctx, [name, macro]) {
  const { macros } = ctx.state.s;
  const set = (m) => new Map(m).set(name, macro);
  updateLaTeXState(ctx, {
    macros:
      macro.scope === 'GlobalScope'
        ? macros.map(set)
        : [set(macros[0]), ...macros.slice(1)],
  });
}

/**
 * The macro `name` in the innermost table.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.lookupMacro
 * @returns {Macro | undefined}
 */
const lookupMacro = (ctx, name) => ctx.state.s.macros[0].get(name);

/** @returns {Macro} */
const makeMacro = (scope, expansionPoint, argspecs, optarg, body) => ({
  scope,
  expansionPoint,
  argspecs,
  optarg,
  body,
});

// A token made at `at`'s position.
const tokAt = (at, type, text, name) => ({
  type,
  text,
  ...(name !== undefined && { name }),
  line: at.line,
  column: at.column,
  start: at.start,
  end: at.end,
});
const ctrlSeqAt = (at, name, text = `\\${name}`) =>
  tokAt(at, 'CtrlSeq', text, name);

const equalsSign = optional(symbol('='));
const letTarget = alt(anyControlSeq, singleChar);

/**
 * `\let\name\target`: the target's macro, else the target itself. Read
 * verbatim, so a defined `\target` is not expanded first.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.letmacro
 */
function letmacro(ctx) {
  if (controlSeq('let')(ctx) === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const cs = anyControlSeq(c);
    if (cs === FAIL || equalsSign(c) === FAIL || spaces(c) === FAIL) {
      return FAIL;
    }
    const target = letTarget(c);
    if (target === FAIL) return FAIL;
    const m =
      target.type === 'CtrlSeq' ? lookupMacro(c, target.name) : undefined;
    return [
      [
        cs.name,
        m ?? makeMacro('GroupScope', 'ExpandWhenDefined', [], null, [target]),
      ],
    ];
  })(ctx);
}

/**
 * `p`, its macros made global after `\global`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.checkGlobal
 */
function checkGlobal(p) {
  return alt((ctx) => {
    if (controlSeq('global')(ctx) === FAIL) return FAIL;
    const pairs = p(ctx);
    if (pairs === FAIL) return FAIL;
    return pairs.map(([n, m]) => [n, { ...m, scope: 'GlobalScope' }]);
  }, p);
}

const edefScope = alt(
  (ctx) => (controlSeq('edef')(ctx) === FAIL ? FAIL : 'GroupScope'),
  (ctx) => (controlSeq('xdef')(ctx) === FAIL ? FAIL : 'GlobalScope'),
);
const allToks = many(anyTok);

/**
 * `\edef` or `\xdef`: the body's macros expanded where it is defined. Read
 * verbatim first, then expanded.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.edefmacro
 */
function edefmacro(ctx) {
  const scope = edefScope(ctx);
  if (scope === FAIL) return FAIL;
  const def = withVerbatimMode((c) => {
    const cs = anyControlSeq(c);
    if (cs === FAIL) return FAIL;
    const contents = bracedOrToken(c);
    return contents === FAIL ? FAIL : [cs.name, contents];
  })(ctx);
  if (def === FAIL) return FAIL;
  const [name, contents] = def;
  const body = parseFromToks(allToks, contents)(ctx);
  if (body === FAIL) return FAIL;
  return [[name, makeMacro(scope, 'ExpandWhenDefined', [], null, body)]];
}

const defScope = alt(
  (ctx) => (controlSeq('def')(ctx) === FAIL ? FAIL : 'GroupScope'),
  (ctx) => (controlSeq('gdef')(ctx) === FAIL ? FAIL : 'GlobalScope'),
);
const argspecs = many(alt(argspecArg, argspecPattern));

/**
 * `\def` or `\gdef`: read verbatim, its macros expanded where it is used.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.defmacro
 */
function defmacro(ctx) {
  const scope = defScope(ctx);
  if (scope === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const cs = anyControlSeq(c);
    if (cs === FAIL) return FAIL;
    const specs = argspecs(c);
    if (specs === FAIL) return FAIL;
    const contents = bracedOrToken(c);
    if (contents === FAIL) return FAIL;
    return [
      [cs.name, makeMacro(scope, 'ExpandWhenUsed', specs, null, contents)],
    ];
  })(ctx);
}

/**
 * `\newif\iffoo`: `\iffoo` as `\iffalse`, `\footrue` defining it
 * `\iftrue`, `\foofalse` defining it `\iffalse`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.newif
 */
function newif(ctx) {
  if (controlSeq('newif')(ctx) === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const pos = anyControlSeq(c);
    if (pos === FAIL) return FAIL;
    const { name } = pos;
    const base = [...name].slice(2).join('');
    const define = (value) =>
      makeMacro('GroupScope', 'ExpandWhenUsed', [], null, [
        ctrlSeqAt(pos, 'def'),
        ctrlSeqAt(pos, name),
        tokAt(pos, 'Symbol', '{'),
        ctrlSeqAt(pos, value),
        tokAt(pos, 'Symbol', '}'),
      ]);
    return [
      [
        name,
        makeMacro('GroupScope', 'ExpandWhenUsed', [], null, [
          ctrlSeqAt(pos, 'iffalse'),
        ]),
      ],
      [`${base}true`, define('iftrue')],
      [`${base}false`, define('iffalse')],
    ];
  })(ctx);
}

const argTok = satisfyTok(isArgTok);

/** @see Text.Pandoc.Readers.LaTeX.Macro.argspecArg */
function argspecArg(ctx) {
  const t = argTok(ctx);
  return t === FAIL ? FAIL : { num: t.arg };
}

const patternToks = many1(
  satisfyTok(
    (t) =>
      (t.type === 'Symbol' || t.type === 'Word') &&
      t.text !== '{' &&
      t.text !== '\\' &&
      t.text !== '}',
  ),
);

/** @see Text.Pandoc.Readers.LaTeX.Macro.argspecPattern */
function argspecPattern(ctx) {
  const toks = patternToks(ctx);
  return toks === FAIL ? FAIL : { pattern: toks };
}

const newcommandSeq = alt(
  controlSeq('newcommand'),
  controlSeq('renewcommand'),
  controlSeq('providecommand'),
  controlSeq('DeclareMathOperator'),
  controlSeq('DeclareRobustCommand'),
);
const star = optional(symbol('*'));
const bracedName = (ctx) => {
  if (symbol('{')(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
  const cs = anyControlSeq(ctx);
  if (cs === FAIL || spaces(ctx) === FAIL || symbol('}')(ctx) === FAIL) {
    return FAIL;
  }
  return cs;
};
const commandName = alt(anyControlSeq, bracedName);
const numArgs = option(0, attempt(bracketedNum));
const optArg = option(null, attempt(bracketedToks));

// Arguments 1 to `n`.
const numbered = (n) => Array.from({ length: n }, (_, k) => ({ num: k + 1 }));

/**
 * `\newcommand` and its kin: read verbatim, its macros expanded where it
 * is used; an existing macro kept unless renewed, and logged unless
 * provided.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.newcommand
 */
function newcommand(ctx) {
  const pos = newcommandSeq(ctx);
  if (pos === FAIL) return FAIL;
  const mtype = pos.name;
  return withVerbatimMode((c) => {
    if (star(c) === FAIL) return FAIL;
    const cs = commandName(c);
    if (cs === FAIL || spaces(c) === FAIL) return FAIL;
    const numargs = numArgs(c);
    if (numargs === FAIL || spaces(c) === FAIL) return FAIL;
    const optarg = optArg(c);
    if (optarg === FAIL || spaces(c) === FAIL) return FAIL;
    const contents = bracedOrToken(c);
    if (contents === FAIL) return FAIL;
    const body =
      mtype === 'DeclareMathOperator'
        ? [
            ctrlSeqAt(pos, 'mathop'),
            tokAt(pos, 'Symbol', '{'),
            ctrlSeqAt(pos, 'mathrm'),
            tokAt(pos, 'Symbol', '{'),
            ...contents,
            tokAt(pos, 'Symbol', '}'),
            tokAt(pos, 'Symbol', '}'),
          ]
        : contents;
    const m = makeMacro(
      'GroupScope',
      'ExpandWhenUsed',
      numbered(numargs),
      optarg,
      body,
    );
    if (lookupMacro(c, cs.name) === undefined) return [[cs.name, m]];
    if (mtype === 'renewcommand') return [[cs.name, m]];
    if (mtype !== 'providecommand') {
      const fields = { name: cs.text };
      report(c, message('MacroAlreadyDefined', pos.start, c.state.at, fields));
    }
    return [];
  })(ctx);
}

const newenvironmentSeq = alt(
  controlSeq('newenvironment'),
  controlSeq('renewenvironment'),
  controlSeq('provideenvironment'),
);

/**
 * `\newenvironment` and its kin: the environment's name, and its begin
 * and end as macros, in a group so macros defined inside it end with it;
 * null where it exists and is not renewed.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.newenvironment
 * @returns {import('../core.js').Parser<[string, Macro, Macro] | null>}
 */
function newenvironment(ctx) {
  // Pandoc's `getPosition`: where the next token starts.
  const { line, column, at } = ctx.state;
  const seq = newenvironmentSeq(ctx);
  if (seq === FAIL) return FAIL;
  const pos = { line, column, start: at, end: at };
  const mtype = seq.name;
  return withVerbatimMode((c) => {
    if (star(c) === FAIL || spaces(c) === FAIL) return FAIL;
    const nameToks = braced(c);
    if (nameToks === FAIL || spaces(c) === FAIL) return FAIL;
    const name = untokenize(nameToks);
    const numargs = numArgs(c);
    if (numargs === FAIL || spaces(c) === FAIL) return FAIL;
    const optarg = optArg(c);
    if (optarg === FAIL || spaces(c) === FAIL) return FAIL;
    const startcontents = bracedOrToken(c);
    if (startcontents === FAIL || spaces(c) === FAIL) return FAIL;
    const endcontents = bracedOrToken(c);
    if (endcontents === FAIL) return FAIL;
    const bg = ctrlSeqAt(pos, 'bgroup', '\\bgroup ');
    const eg = ctrlSeqAt(pos, 'egroup', '\\egroup ');
    const result = [
      name,
      makeMacro('GroupScope', 'ExpandWhenUsed', numbered(numargs), optarg, [
        bg,
        ...startcontents,
      ]),
      makeMacro('GroupScope', 'ExpandWhenUsed', [], null, [...endcontents, eg]),
    ];
    if (lookupMacro(c, name) === undefined) return result;
    if (mtype === 'renewenvironment') return result;
    if (mtype !== 'provideenvironment') {
      report(c, message('MacroAlreadyDefined', at, c.state.at, { name }));
    }
    return null;
  })(ctx);
}

/**
 * A bracketed number of arguments; 0 where it is no number.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.bracketedNum
 */
function bracketedNum(ctx) {
  const toks = bracketedToks(ctx);
  return toks === FAIL ? FAIL : safeReadInt(untokenize(toks));
}

// Arguments past this many are never read: no input holds them all.
const MAX_ARGS = 1 << 16;

/**
 * Haskell's `read` of an `Int`, as Pandoc's `safeRead`: spaces and
 * parentheses around a decimal, `0x` or `0o` literal, wrapped to 64 bits;
 * a negative number left as 0, which reads no argument either.
 *
 * @see Text.Pandoc.Shared.safeRead
 * @param {string} s
 */
export function safeReadInt(s) {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  if (!/^(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|[0-9]+)$/.test(t)) return 0;
  const n = BigInt.asIntN(64, BigInt(t.replace(/^0[oO]/, '0o')));
  return n <= 0n ? 0 : Number(n > BigInt(MAX_ARGS) ? MAX_ARGS : n);
}
