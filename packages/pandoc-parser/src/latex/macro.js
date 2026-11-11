// Macro definitions: `\newcommand` and its kin, `\def` and its kin, `\let`,
// `\newif`, `\newenvironment`, and LaTeX3's document commands and
// environments and their copies; recorded where `latex_macros` is on, kept
// raw where it is off.
//
// Ported from Pandoc's `Text.Pandoc.Readers.LaTeX.Macro`.

import { alt, attempt, FAIL, many, many1, option, optional } from '../core.js';
import { isAlpha as isLetter } from '../data-char.js';
import { message, report } from '../logging.js';
import { strip } from '../shared.js';
import {
  anyControlSeq,
  anyTok,
  braced,
  bracedOrToken,
  bracketedToks,
  controlSeq,
  isArgTok,
  parseFromToks,
  peekTok,
  satisfyTok,
  singleChar,
  spaces,
  symbol,
  tokenize,
  untokenize,
  updateLaTeXState,
  withRaw,
  withVerbatimMode,
} from './parsing.js';

/** @typedef {import('../tex.js').Tok} Tok */
/** @typedef {import('./parsing.js').Macro} Macro */
/** @typedef {import('./parsing.js').ArgSpec} ArgSpec */

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
  // Fail before trying each definition, unless the next token can begin
  // one.
  const t = peekTok(ctx);
  if (t === FAIL || t.type !== 'CtrlSeq' || !MACRO_DEF_COMMANDS.has(t.name)) {
    return FAIL;
  }
  const start = ctx.state.at;
  const read = withRaw(alt(commandDef, environmentDef))(ctx);
  if (read === FAIL) return FAIL;
  if (macrosOn(ctx)) return [];
  return construct(untokenize(read[1]), start, ctx.state.at);
};

/**
 * The control sequences a macro definition can begin with: each its
 * parsers can start with.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.macroDefCommands
 */
const MACRO_DEF_COMMANDS = new Set([
  'global', // see checkGlobal
  'let',
  'edef',
  'xdef',
  'def',
  'gdef',
  'newif',
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareMathOperator',
  'DeclareRobustCommand',
  'NewDocumentCommand',
  'RenewDocumentCommand',
  'ProvideDocumentCommand',
  'DeclareDocumentCommand',
  'NewExpandableDocumentCommand',
  'RenewExpandableDocumentCommand',
  'ProvideExpandableDocumentCommand',
  'DeclareExpandableDocumentCommand',
  'NewDocumentEnvironment',
  'RenewDocumentEnvironment',
  'ProvideDocumentEnvironment',
  'DeclareDocumentEnvironment',
  'NewCommandCopy',
  'RenewCommandCopy',
  'DeclareCommandCopy',
  'NewEnvironmentCopy',
  'RenewEnvironmentCopy',
  'DeclareEnvironmentCopy',
  'newenvironment',
  'renewenvironment',
  'provideenvironment',
]);

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
const newif = attempt((ctx) => {
  if (controlSeq('newif')(ctx) === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const pos = anyControlSeq(c);
    if (pos === FAIL || !pos.name.startsWith('if')) return FAIL;
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
});

const argTok = satisfyTok(isArgTok);

/** @see Text.Pandoc.Readers.LaTeX.Macro.argspecArg */
function argspecArg(ctx) {
  const t = argTok(ctx);
  return t === FAIL ? FAIL : { kind: 'ArgNum', num: t.arg };
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
  return toks === FAIL ? FAIL : { kind: 'Pattern', toks };
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
const numbered = (n) =>
  Array.from({ length: n }, (_, k) => ({ kind: 'ArgNum', num: k + 1 }));

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

// What a definition of `name` gives where a macro of that name exists:
// nothing for `\Provide…`, nothing and a log for `\New…`, else `result`
// for `\Renew…` and `\Declare…`.
function redefine(ctx, pos, mtype, name, result, fields) {
  if (lookupMacro(ctx, name) === undefined) return result;
  if (mtype.startsWith('Provide')) return [];
  if (mtype.startsWith('New')) {
    report(
      ctx,
      message('MacroAlreadyDefined', pos.start, ctx.state.at, fields),
    );
    return [];
  }
  return result;
}

const seqOf = (names) => alt(...names.map(controlSeq));
const documentCommandSeq = seqOf(
  ['', 'Expandable'].flatMap((x) =>
    ['New', 'Renew', 'Provide', 'Declare'].map(
      (y) => `${y}${x}DocumentCommand`,
    ),
  ),
);
const spacedCommandName = (ctx) =>
  spaces(ctx) === FAIL ? FAIL : commandName(ctx);

/**
 * `\NewDocumentCommand\cmd{argspec}{body}` and its kin, with xparse's
 * argument specifiers.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.newDocumentCommand
 */
const newDocumentCommand = attempt((ctx) => {
  const pos = documentCommandSeq(ctx);
  if (pos === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const cs = spacedCommandName(c);
    if (cs === FAIL || spaces(c) === FAIL) return FAIL;
    const specs = xparseArgSpecs(false)(c);
    if (specs === FAIL || spaces(c) === FAIL) return FAIL;
    const contents = bracedOrToken(c);
    if (contents === FAIL) return FAIL;
    const m = makeMacro(
      'GroupScope',
      'ExpandWhenUsed',
      specs[0],
      null,
      contents,
    );
    return redefine(c, pos, pos.name, cs.name, [[cs.name, m]], {
      name: cs.text,
    });
  })(ctx);
});

const documentEnvironmentSeq = seqOf(
  ['New', 'Renew', 'Provide', 'Declare'].map((y) => `${y}DocumentEnvironment`),
);
const spacedBracedOrToken = (ctx) =>
  spaces(ctx) === FAIL ? FAIL : bracedOrToken(ctx);

/**
 * `\NewDocumentEnvironment{name}{argspec}{begin}{end}` and its kin, with
 * xparse's argument specifiers, the arguments in the end code too: the
 * begin defines a macro of the end, its arguments in place, which the end
 * expands; in a group, so environments nest. A `b` argument, the body,
 * reads to `\end{name}`, begin and end one macro.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.newDocumentEnvironment
 */
const newDocumentEnvironment = attempt((ctx) => {
  const pos = documentEnvironmentSeq(ctx);
  if (pos === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    if (spaces(c) === FAIL) return FAIL;
    const nameToks = braced(c);
    if (nameToks === FAIL || spaces(c) === FAIL) return FAIL;
    const name = strip(untokenize(nameToks));
    const specs = xparseArgSpecs(true)(c);
    if (specs === FAIL) return FAIL;
    const [argspecs, usesBody] = specs;
    const begin = spacedBracedOrToken(c);
    if (begin === FAIL) return FAIL;
    const end = spacedBracedOrToken(c);
    if (end === FAIL) return FAIL;
    const bg = ctrlSeqAt(pos, 'bgroup', '\\bgroup ');
    const eg = ctrlSeqAt(pos, 'egroup', '\\egroup ');
    const helperName = `pandocxparseenvend${letterize(name)}`;
    const helper = ctrlSeqAt(pos, helperName, `\\${helperName} `);
    const defHelper = [
      ctrlSeqAt(pos, 'def'),
      helper,
      tokAt(pos, 'Symbol', '{'),
      ...end,
      tokAt(pos, 'Symbol', '}'),
    ];
    const macro = (specs_, body) =>
      makeMacro('GroupScope', 'ExpandWhenUsed', specs_, null, body);
    const result = usesBody
      ? [
          [
            name,
            macro(
              [
                ...argspecs,
                { kind: 'Pattern', toks: toksAt(pos, `\\end{${name}}`) },
              ],
              [bg, ...defHelper, ...begin, helper, eg],
            ),
          ],
        ]
      : [
          [name, macro(argspecs, [bg, ...defHelper, ...begin])],
          [`end${name}`, macro([], [helper, eg])],
        ];
    return redefine(c, pos, pos.name, name, result, { name });
  })(ctx);
});

const commandCopySeq = seqOf(
  ['New', 'Renew', 'Declare'].map((y) => `${y}CommandCopy`),
);

/**
 * `\NewCommandCopy\new\old` and its kin: as `\let`, of control sequences
 * only.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.commandCopy
 */
const commandCopy = attempt((ctx) => {
  const pos = commandCopySeq(ctx);
  if (pos === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const cs = spacedCommandName(c);
    if (cs === FAIL || spaces(c) === FAIL) return FAIL;
    const target = anyControlSeq(c);
    if (target === FAIL) return FAIL;
    const m =
      lookupMacro(c, target.name) ??
      makeMacro('GroupScope', 'ExpandWhenDefined', [], null, [target]);
    return redefine(c, pos, pos.name, cs.name, [[cs.name, m]], {
      name: cs.text,
    });
  })(ctx);
});

const environmentCopySeq = seqOf(
  ['New', 'Renew', 'Declare'].map((y) => `${y}EnvironmentCopy`),
);
const spacedBracedText = (ctx) => {
  if (spaces(ctx) === FAIL) return FAIL;
  const ts = braced(ctx);
  return ts === FAIL ? FAIL : untokenize(ts);
};

/**
 * `\NewEnvironmentCopy{new}{old}` and its kin: the begin and end macros
 * copied; where the old is no macro, `\begin{old}` and `\end{old}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.environmentCopy
 */
const environmentCopy = attempt((ctx) => {
  const pos = environmentCopySeq(ctx);
  if (pos === FAIL) return FAIL;
  return withVerbatimMode((c) => {
    const name = spacedBracedText(c);
    if (name === FAIL) return FAIL;
    const target = spacedBracedText(c);
    if (target === FAIL) return FAIL;
    const copyOne = (to, from, fallback) => [
      to,
      lookupMacro(c, from) ??
        makeMacro(
          'GroupScope',
          'ExpandWhenUsed',
          [],
          null,
          toksAt(pos, fallback),
        ),
    ];
    const result = [
      copyOne(name, target, `\\begin{${target}}`),
      copyOne(`end${name}`, `end${target}`, `\\end{${target}}`),
    ];
    return redefine(c, pos, pos.name, name, result, { name });
  })(ctx);
});

// `text`'s tokens, at `at`'s position.
const toksAt = (at, text) =>
  [...tokenize(text, 0, at)].map((t) => ({
    ...t,
    start: at.start,
    end: at.start,
  }));

/**
 * A text in letters only, to name a control sequence that survives being
 * tokenized again: any other character `x` and its code, digits as `a`
 * to `j`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.letterize
 * @param {string} t
 */
function letterize(t) {
  const letter = (d) => String.fromCharCode(d.charCodeAt(0) + 49);
  let out = '';
  for (const c of t) {
    out += isLetter(c)
      ? c
      : `x${[...String(c.codePointAt(0))].map(letter).join('')}`;
  }
  return out;
}

/**
 * A braced xparse argument specification, `{s O{default} m}`: its specs,
 * and whether it ends in a body, `b` or `c`, which only an environment's
 * may (`allowBody`).
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.xparseArgSpecs
 * @param {boolean} allowBody
 * @returns {import('../core.js').Parser<[ArgSpec[], boolean]>}
 */
const xparseArgSpecs = (allowBody) => (ctx) => {
  if (symbol('{')(ctx) === FAIL) return FAIL;
  const specs = [];
  for (let n = 1; ; ) {
    if (spaces(ctx) === FAIL) return FAIL;
    if (symbol('}')(ctx) !== FAIL) return [specs, false];
    const r = xparseArgSpec(allowBody, n)(ctx);
    if (r === FAIL) return FAIL;
    const [spec, isBody] = r;
    specs.push(spec);
    if (isBody) {
      if (spaces(ctx) === FAIL || symbol('}')(ctx) === FAIL) return FAIL;
      return [specs, true];
    }
    n += numslots(spec);
  }
};

// How many arguments a spec binds: an embellishment one each.
const numslots = (spec) =>
  spec.kind === 'EmbellishArg'
    ? spec.embs.length
    : spec.kind === 'ProcessedArg'
      ? numslots(spec.spec)
      : 1;

const specTok = (ctx) => (spaces(ctx) === FAIL ? FAIL : singleChar(ctx));
const embTokens = (ts) =>
  ts.filter((t) => !['Spaces', 'Newline', 'Comment'].includes(t.type));
const spacedBraced = (ctx) => (spaces(ctx) === FAIL ? FAIL : braced(ctx));
const embDefaults = (ctx) => {
  if (symbol('{')(ctx) === FAIL) return FAIL;
  const ds = many(attempt(spacedBraced))(ctx);
  if (ds === FAIL || spaces(ctx) === FAIL || symbol('}')(ctx) === FAIL) {
    return FAIL;
  }
  return ds;
};

/**
 * One xparse argument specifier, the `n`th argument, with its modifiers:
 * the spec, and whether it is a body.
 *
 * @see Text.Pandoc.Readers.LaTeX.Macro.xparseArgSpec
 * @param {boolean} allowBody
 * @param {number} n
 * @returns {import('../core.js').Parser<[ArgSpec, boolean]>}
 */
const xparseArgSpec = (allowBody, n) => (ctx) => {
  // `!` turns off the spaces skipped before an optional argument, and the
  // trimming of a body.
  let noBang = true;
  const procs = [];
  for (;;) {
    const t = singleChar(ctx);
    if (t === FAIL) return FAIL;
    const plain = (spec) =>
      procs.length === 0
        ? [spec, false]
        : [{ kind: 'ProcessedArg', procs, spec }, false];
    const delim = (open, close, dflt) =>
      plain({ kind: 'DelimArg', skipSp: noBang, open, close, dflt });
    const delimSpec = (withDefault) => {
      const open = specTok(ctx);
      if (open === FAIL) return FAIL;
      const close = specTok(ctx);
      if (close === FAIL) return FAIL;
      const dflt = withDefault ? spacedBraced(ctx) : null;
      return dflt === FAIL ? FAIL : delim(open, close, dflt);
    };
    const bracket = (text) => setposTok(t, text);
    switch (t.text) {
      case '+': // "long": no difference
        break;
      case '!':
        noBang = false;
        break;
      case '=': // a key-value interface for the argument: not modeled
        if (spacedBraced(ctx) === FAIL) return FAIL;
        break;
      case '>': {
        const proc = spacedBraced(ctx);
        if (proc === FAIL) return FAIL;
        procs.push(proc);
        break;
      }
      case 'm':
        return plain({ kind: 'ArgNum', num: n });
      case 'o':
        return delim(bracket('['), bracket(']'), null);
      case 'O': {
        const dflt = spacedBraced(ctx);
        return dflt === FAIL ? FAIL : delim(bracket('['), bracket(']'), dflt);
      }
      case 's':
        return plain({ kind: 'BoolArg', skipSp: noBang, tok: bracket('*') });
      case 't': {
        const tok = specTok(ctx);
        return tok === FAIL
          ? FAIL
          : plain({ kind: 'BoolArg', skipSp: noBang, tok });
      }
      case 'd':
      case 'r':
        return delimSpec(false);
      case 'D':
      case 'R':
        return delimSpec(true);
      case 'v':
        return plain({ kind: 'VerbArg' });
      case 'e':
      case 'E': {
        const embtoks = spacedBraced(ctx);
        if (embtoks === FAIL) return FAIL;
        let defaults = [];
        if (t.text === 'E') {
          if (spaces(ctx) === FAIL) return FAIL;
          defaults = embDefaults(ctx);
          if (defaults === FAIL) return FAIL;
        }
        const embs = embTokens(embtoks).map((e, k) => [e, defaults[k] ?? null]);
        return plain({ kind: 'EmbellishArg', embs });
      }
      case 'b':
      case 'c':
        if (!allowBody) return FAIL;
        // Processors do not apply to a body.
        return [
          {
            kind: t.text === 'b' ? 'BodyArg' : 'VerbBodyArg',
            trim: noBang,
            num: n,
          },
          true,
        ];
      default:
        return FAIL; // an xparse specifier not supported
    }
    if (spaces(ctx) === FAIL) return FAIL;
  }
};

// A symbol at a token's position.
const setposTok = (at, text) => tokAt(at, 'Symbol', text);

const commandDefs = alt(
  newcommand,
  newDocumentCommand,
  newDocumentEnvironment,
  commandCopy,
  environmentCopy,
  checkGlobal(alt(letmacro, edefmacro, defmacro, newif)),
);

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
