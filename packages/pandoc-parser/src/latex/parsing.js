// The LaTeX reader's parsing toolkit: TeX tokenized, and tokens written
// back as text.
//
// Ported from Pandoc's `Text.Pandoc.Readers.LaTeX.Parsing`.

import * as B from '../ast/builder.js';
import { Node } from '../ast/nodes.js';
import { walk } from '../ast/walk.js';
import { codePointLength } from '../code-points.js';
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
  skipMany,
  skipMany1,
} from '../core.js';
import { isAlphaNum, isAlpha as isLetter } from '../data-char.js';
import { logOf, message, report } from '../logging.js';
import { readInt } from '../parsing/lists.js';
import { getPosition } from '../parsing/state.js';
import { addMetaField, strip, uniqueIdent } from '../shared.js';
import { evalFpeval, evalInteval } from './eval.js';

/** @typedef {import('../tex.js').Tok} Tok */

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isSpaceOrTab */
const isSpaceOrTab = (c) => c === ' ' || c === '\t';

/**
 * A letter in a control word: `@` where `\makeatletter` made it one, `:`
 * and `_` where `\ExplSyntaxOn` did.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.isLetter'
 * @param {{atIsLetter: boolean, explSyntax: boolean}} st
 * @param {string} c
 */
function isLetterIn(st, c) {
  if (c === '@') return st.atIsLetter;
  if (c === ':' || c === '_') return st.explSyntax;
  return isLetter(c);
}

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isLetterOrAt */
const isLetterOrAt = (c) => isLetter(c) || c === '@';

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isLowerHex */
const isLowerHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');

const isDigit = (c) => c >= '0' && c <= '9';

/**
 * The tokens of `text` from `from`, the first at Pandoc's position `line`
 * and `column`, made on demand: a consumer of the first ones tokenizes no
 * further. Positions move as Pandoc's do, drifts and all: a control space
 * before a non-blank line and `^^` before a newline leave later positions
 * behind the text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.tokenize
 * @param {string} text
 * @param {number} [from]
 * @param {{line: number, column: number}} [start]
 * @returns {Generator<Tok>}
 */
export function* tokenize(text, from = 0, start = { line: 1, column: 1 }) {
  let { line, column } = start;
  let at = from;
  const st = { atIsLetter: false, explSyntax: false };
  // The code point at `i`; null at the end.
  const charAt = (i) =>
    i < text.length ? String.fromCodePoint(text.codePointAt(i)) : null;
  // Where the run of characters `test` holds of ends, and how many.
  const span = (i, test) => {
    let n = 0;
    for (let c = charAt(i); c !== null && test(c); c = charAt(i)) {
      i += c.length;
      n++;
    }
    return [i, n];
  };
  const tok = (type, s, e, extra) => ({
    type,
    text: text.slice(s, e),
    ...extra,
    line,
    column,
    start: s,
    end: e,
  });

  while (at < text.length) {
    const c = charAt(at);
    const rest = at + c.length;
    if (c === '\n') {
      yield tok('Newline', at, rest);
      [line, column, at] = [line + 1, 1, rest];
    } else if (isSpaceOrTab(c)) {
      const [end, n] = span(at, isSpaceOrTab);
      yield tok('Spaces', at, end);
      [column, at] = [column + n, end];
    } else if (isAlphaNum(c)) {
      const [end, n] = span(at, isAlphaNum);
      yield tok('Word', at, end);
      [column, at] = [column + n, end];
    } else if (c === '%') {
      const nl = text.indexOf('\n', rest);
      const end = nl === -1 ? text.length : nl;
      yield tok('Comment', at, end);
      [column, at] = [column + 1 + codePoints(text, rest, end), end];
    } else if (c === '\\') {
      const d = charAt(rest);
      if (d === null) {
        yield tok('CtrlSeq', at, rest, { name: ' ' });
        return;
      }
      if (isLetterIn(st, d)) {
        const [wordEnd, wn] = span(rest, (x) => isLetterIn(st, x));
        const [end, sn] = span(wordEnd, isSpaceOrTab);
        const name = text.slice(rest, wordEnd);
        yield tok('CtrlSeq', at, end, { name });
        if (name === 'makeatletter') st.atIsLetter = true;
        else if (name === 'makeatother') st.atIsLetter = false;
        else if (name === 'ExplSyntaxOn') st.explSyntax = true;
        else if (name === 'ExplSyntaxOff') st.explSyntax = false;
        [column, at] = [column + 1 + wn + sn, end];
      } else if (isSpaceOrTab(d) || d === '\n') {
        // A control space: `\`, spaces, a newline and the next line's
        // leading spaces. Before a blank line, `\` and its spaces alone.
        const [r1, n1] = span(rest, isSpaceOrTab);
        let [r3, n2, n3] = [r1, 0, 0];
        if (text[r1] === '\n') {
          [r3, n3] = span(r1 + 1, isSpaceOrTab);
          n2 = 1;
        }
        const width = 1 + n1 + n2 + n3;
        if (text[r3] === '\n') {
          yield tok('CtrlSeq', at, r1, { name: ' ' });
          [column, at] = [column + width, r1];
        } else {
          // Pandoc's position misses the newline: later lines drift.
          yield tok('CtrlSeq', at, r3, { name: ' ' });
          [column, at] = [column + width, r3];
        }
      } else {
        const end = rest + d.length;
        yield tok('CtrlSeq', at, end, { name: d });
        [column, at] = [column + 2, end];
      }
    } else if (c === '#') {
      if (text[rest] === '#') {
        const [end, n] = span(rest + 1, isDigit);
        if (n > 0) {
          const arg = readInt(text.slice(rest + 1, end));
          yield tok('DeferredArg', at, end, { arg });
          [column, at] = [column + 2 + n, end];
        } else {
          yield tok('Symbol', at, rest);
          column++;
          yield tok('Symbol', rest, rest + 1);
          [column, at] = [column + 1, rest + 1];
        }
      } else {
        const [end, n] = span(rest, isDigit);
        if (n > 0) {
          const arg = readInt(text.slice(rest, end));
          yield tok('Arg', at, end, { arg });
          [column, at] = [column + 1 + n, end];
        } else {
          yield tok('Symbol', at, rest);
          [column, at] = [column + 1, rest];
        }
      }
    } else if (c === '^') {
      const d = text[rest] === '^' ? charAt(rest + 1) : null;
      if (text[rest] !== '^') {
        yield tok('Symbol', at, rest);
        [column, at] = [column + 1, rest];
      } else if (
        d !== null &&
        isLowerHex(d) &&
        isLowerHex(text[rest + 2] ?? '')
      ) {
        yield tok('Esc2', at, rest + 3);
        [column, at] = [column + 4, rest + 3];
      } else if (d !== null && (isLowerHex(d) || d.codePointAt(0) < 0x80)) {
        // `^^` and a newline too: Pandoc's position misses it.
        const end = rest + 1 + d.length;
        yield tok('Esc1', at, end);
        [column, at] = [column + 3, end];
      } else {
        yield tok('Symbol', at, rest);
        column++;
        yield tok('Symbol', rest, rest + 1);
        [column, at] = [column + 1, rest + 1];
      }
    } else {
      yield tok('Symbol', at, rest);
      [column, at] = [column + 1, rest];
    }
  }
}

// How many code points `text` has from `start` to `end`.
function codePoints(text, start, end) {
  let n = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0xdc00 || code > 0xdfff) n++;
  }
  return n;
}

/**
 * Tokens as text: a space after a control word before a letter, where
 * writing them together would make one control word (#5836).
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untokenize
 * @param {Iterable<Tok>} toks
 */
export function untokenize(toks) {
  const list = Array.isArray(toks) ? toks : [...toks];
  let out = '';
  for (let k = 0; k < list.length; k++) {
    const { type, text } = list[k];
    out += text;
    if (
      type === 'CtrlSeq' &&
      text !== '' &&
      isLetter(lastChar(text)) &&
      nextStartsWithLetter(list, k + 1)
    ) {
      out += ' ';
    }
  }
  return out;
}

// The last code point of a non-empty text.
const lastChar = (t) => {
  const code = t.charCodeAt(t.length - 1);
  return code >= 0xdc00 && code <= 0xdfff && t.length > 1
    ? t.slice(-2)
    : t.slice(-1);
};

// Whether the first text from `list[k]` on starts with a letter.
function nextStartsWithLetter(list, k) {
  for (; k < list.length; k++) {
    const { text } = list[k];
    if (text !== '') return isLetter(String.fromCodePoint(text.codePointAt(0)));
  }
  return false;
}

/**
 * One token as text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untoken
 * @param {Tok} tok
 */
export const untoken = (tok) => tok.text;

// ---------------------------------------------------------------------
// The token stream and the parser state

/**
 * A token stream: a token and the stream after it, made on demand; null
 * at the end. Persistent: macro expansion conses tokens onto a tail, and
 * every stream that shares the tail sees the same tokens.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.TokStream
 * @typedef {{tok: Tok, next: TokList | null | (() => TokList | null)}} TokCell
 * @typedef {TokCell | null} TokList
 */

/**
 * The stream after `cell`'s token, made once.
 *
 * @param {TokCell} cell
 * @returns {TokList}
 */
export function tail(cell) {
  if (typeof cell.next === 'function') cell.next = cell.next();
  return cell.next;
}

/**
 * The stream of an iterator's tokens, read as they are asked for.
 *
 * @param {Iterator<Tok>} tokens
 * @returns {TokList}
 */
export function streamOf(tokens) {
  const next = tokens.next();
  return next.done ? null : { tok: next.value, next: () => streamOf(tokens) };
}

/**
 * `toks` before `rest`.
 *
 * @param {Tok[]} toks
 * @param {TokList} rest
 * @returns {TokList}
 */
export const prepend = (toks, rest) =>
  toks.reduceRight((list, tok) => ({ tok, next: list }), rest);

/**
 * The stream's tokens, every one of them.
 *
 * @param {TokList} list
 * @returns {Tok[]}
 */
export function tokensOf(list) {
  const out = [];
  for (let cell = list; cell !== null; cell = tail(cell)) out.push(cell.tok);
  return out;
}

/** @see Text.Pandoc.Readers.LaTeX.Parsing.DottedNum */
export const renderDottedNum = (ns) => ns.join('.');

/**
 * The number after `ns` at `level`, the levels below dropped.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.incrementDottedNum
 * @param {number} level
 * @param {number[]} ns
 */
export function incrementDottedNum(level, ns) {
  const kept = [...ns, ...Array(Math.max(0, level - ns.length)).fill(0)].slice(
    0,
    level,
  );
  if (kept.length === 0) return [];
  kept[kept.length - 1]++;
  return kept;
}

/**
 * The LaTeX reader's state. A macro table per open group, innermost first.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.LaTeXState
 * @param {import('../options.js').ReaderOptions} options
 */
export const defaultLaTeXState = (options) => ({
  options,
  meta: {},
  quoteContext: 'NoQuote',
  macros: [new Map()],
  containers: [],
  identifiers: new Set(),
  verbatimMode: false,
  mathMode: false,
  caption: null,
  inListItem: false,
  inTableCell: false,
  lastHeaderNum: [],
  lastFigureNum: [],
  lastTableNum: [],
  lastNoteNum: 0,
  footnoteTexts: new Map(),
  theoremMap: new Map(),
  lastTheoremStyle: 'PlainStyle',
  lastLabel: null,
  labels: new Map(),
  hasChapters: false,
  toggles: new Map(),
  fileContents: new Map(),
  enableWithRaw: true,
  ligatures: true,
  caseExclusions: new Map(),
  lastExpansion: null,
});

/**
 * A parse's context over tokens: `pos` counts the tokens read, which is
 * how Parsec tells consuming from not; the state holds the input with the
 * reader's state, so backtracking puts back what macro expansion rewrote,
 * as Parsec's `setInput` is undone. `line` and `column` are Pandoc's
 * position, `at` the true offset it stands for; `rawToks` the tokens read
 * while `rawScopes` `withRaw`s are open, latest first, `rawCount` of them.
 *
 * @typedef {object} LPState
 * @property {TokList} input
 * @property {boolean} expanded Whether macros are expanded at the input's
 *   head.
 * @property {number} line
 * @property {number} column
 * @property {number} at
 * @property {number | undefined} end Where the input ends, for `at` there.
 * @property {TokList} rawToks
 * @property {number} rawCount
 * @property {number} rawScopes
 * @property {ReturnType<typeof defaultLaTeXState>} s
 */

// No `withRaw` open.
const NO_RAW = { rawToks: null, rawCount: 0, rawScopes: 0 };

/**
 * A context reading `input` in state `s`, at its first token's position;
 * `end` where the input ends, else its last token's end. `common` is the
 * run's state, which backtracking leaves alone.
 *
 * @param {TokList} input
 * @param {ReturnType<typeof defaultLaTeXState>} s
 * @param {number} [end]
 * @param {import('../common-state.js').CommonState} [common]
 */
export function lpContext(input, s, end, common) {
  const first = input?.tok;
  return {
    pos: 0,
    state: {
      input,
      expanded: false,
      line: first?.line ?? 1,
      column: first?.column ?? 1,
      at: first?.start ?? end ?? 0,
      end,
      ...NO_RAW,
      s,
    },
    common,
  };
}

/**
 * Replace the reader's state with `fields` changed.
 *
 * @param {{state: LPState}} ctx
 * @param {object} fields
 */
export function updateLaTeXState(ctx, fields) {
  ctx.state = { ...ctx.state, s: { ...ctx.state.s, ...fields } };
}

/**
 * Replace the input: no token read.
 *
 * @see Text.Parsec.Prim.setInput
 * @param {{state: LPState}} ctx
 * @param {TokList} input
 * @param {boolean} expanded Whether macros are expanded at its head.
 */
export const setInput = (ctx, input, expanded) => {
  ctx.state = { ...ctx.state, input, expanded };
};

/**
 * The next token where `f` holds of it, macros at the input's head
 * expanded first; the position moved to the token after it, or past it at
 * the end; the token recorded by every open `withRaw`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.satisfyTok
 * @param {(tok: Tok) => boolean} f
 * @returns {import('../core.js').Parser<Tok>}
 */
export function satisfyTok(f) {
  return (ctx) => {
    doMacros(ctx);
    const cell = ctx.state.input;
    if (cell === null || !f(cell.tok)) return FAIL;
    const tok = cell.tok;
    const rest = tail(cell);
    const after = rest?.tok;
    const st = ctx.state;
    ctx.state = {
      ...st,
      input: rest,
      expanded: false,
      line: after ? after.line : st.line,
      column: after
        ? after.column
        : st.column + codePoints(tok.text, 0, tok.text.length),
      at: after ? after.start : (st.end ?? tok.end),
      ...(st.rawScopes > 0 &&
        st.s.enableWithRaw && {
          rawToks: { tok, next: st.rawToks },
          rawCount: st.rawCount + 1,
        }),
    };
    ctx.pos++;
    return tok;
  };
}

/**
 * The next token, read and put back.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.peekTok
 */
export const peekTok = (ctx) => {
  doMacros(ctx);
  return ctx.state.input?.tok ?? FAIL;
};

/**
 * `parser` run on `toks`, at the first one's position, the open
 * `withRaw`s set aside; the input and position put back after.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.parseFromToks
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 * @param {Tok[]} toks
 */
export const parseFromToks = (parser, toks) => (ctx) => {
  const outer = ctx.state;
  const first = toks[0];
  ctx.state = {
    ...outer,
    input: prepend(toks, null),
    expanded: false,
    ...(first && { line: first.line, column: first.column, at: first.start }),
    end: toks.at(-1)?.end,
    ...NO_RAW,
  };
  const result = parser(ctx);
  ctx.state = {
    ...ctx.state,
    input: outer.input,
    expanded: outer.expanded,
    line: outer.line,
    column: outer.column,
    at: outer.at,
    end: outer.end,
    rawToks: outer.rawToks,
    rawCount: outer.rawCount,
    rawScopes: outer.rawScopes,
  };
  return result;
};

/**
 * `parser` with `withRaw` recording nothing.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.disablingWithRaw
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 */
export const disablingWithRaw = (parser) => (ctx) => {
  const outer = ctx.state.s.enableWithRaw;
  updateLaTeXState(ctx, { enableWithRaw: false });
  const result = parser(ctx);
  if (result !== FAIL) updateLaTeXState(ctx, { enableWithRaw: outer });
  return result;
};

/**
 * `parser` in quote context `context`, the old context put back after it:
 * the LaTeX state's instance of `HasQuoteContext`.
 *
 * @see Text.Pandoc.Parsing.Capabilities.withQuoteContext
 * @template T
 * @param {'NoQuote' | 'InSingleQuote' | 'InDoubleQuote'} context
 * @param {import('../core.js').Parser<T>} parser
 */
export const withQuoteContext = (context, parser) => (ctx) => {
  const outer = ctx.state.s.quoteContext;
  updateLaTeXState(ctx, { quoteContext: context });
  const result = parser(ctx);
  if (result !== FAIL) updateLaTeXState(ctx, { quoteContext: outer });
  return result;
};

/**
 * `parser` with macros left unexpanded: TeX read as written.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.withVerbatimMode
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 */
export const withVerbatimMode = (parser) => (ctx) => {
  const outer = ctx.state.s.verbatimMode;
  updateLaTeXState(ctx, { verbatimMode: true });
  const result = parser(ctx);
  if (result !== FAIL) updateLaTeXState(ctx, { verbatimMode: outer });
  return result;
};

/**
 * `parser`'s value, and the tokens it read.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.withRaw
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 * @returns {import('../core.js').Parser<[T, Tok[]]>}
 */
export const withRaw = (parser) => (ctx) => {
  const startCount = ctx.state.rawCount;
  ctx.state = { ...ctx.state, rawScopes: ctx.state.rawScopes + 1 };
  const result = parser(ctx);
  if (result === FAIL) return FAIL;
  const st = ctx.state;
  const raw = [];
  let cell = st.rawToks;
  for (let k = st.rawCount - startCount; k > 0; k--) {
    raw.push(cell.tok);
    cell = cell.next;
  }
  ctx.state =
    st.rawScopes <= 1
      ? { ...st, ...NO_RAW }
      : { ...st, rawScopes: st.rawScopes - 1 };
  return [result, raw.reverse()];
};

// ---------------------------------------------------------------------
// Macros

/**
 * A macro: its scope, when its body expands, its arguments, the default
 * of an optional first argument, and its body.
 *
 * @see Text.Pandoc.TeX.Macro
 * @typedef {object} Macro
 * @property {'GlobalScope' | 'GroupScope'} scope
 * @property {'ExpandWhenDefined' | 'ExpandWhenUsed'} expansionPoint
 * @property {ArgSpec[]} argspecs
 * @property {Tok[] | null} optarg
 * @property {Tok[]} body
 */

/**
 * A macro's argument: numbered, or tokens to match; xparse's kinds bind
 * the next number. `skipSp` false and `trim` false are the `!` modifier.
 *
 * @see Text.Pandoc.TeX.ArgSpec
 * @typedef {{kind: 'ArgNum', num: number}
 *   | {kind: 'Pattern', toks: Tok[]}
 *   | {kind: 'BoolArg', skipSp: boolean, tok: Tok}
 *   | {kind: 'DelimArg', skipSp: boolean, open: Tok, close: Tok, dflt: Tok[] | null}
 *   | {kind: 'VerbArg'}
 *   | {kind: 'EmbellishArg', embs: [Tok, Tok[] | null][]}
 *   | {kind: 'ProcessedArg', procs: Tok[][], spec: ArgSpec}
 *   | {kind: 'BodyArg', trim: boolean, num: number}
 *   | {kind: 'VerbBodyArg', trim: boolean, num: number}} ArgSpec
 */

// A token at another's position, as Pandoc's line and column; its text no
// text of the source, an empty span where the other starts.
const setpos = (at, tok) => ({
  ...tok,
  source: at.source,
  line: at.line,
  column: at.column,
  start: at.start,
  end: at.start,
});

/**
 * Macros at the input's head expanded, unless the head is no control
 * sequence, is expanded already, or the reader is in verbatim mode.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.doMacros
 * @param {{state: LPState}} ctx
 */
export function doMacros(ctx) {
  const { input, expanded, s } = ctx.state;
  if (expanded || input?.tok.type !== 'CtrlSeq' || s.verbatimMode) return;
  setInput(ctx, doMacrosOn(ctx, 1, input), true);
}

// The `n`th expansion of the macro at the head of `input`: its tokens
// before the rest, or `input` itself where there is none.
// @see Text.Pandoc.Readers.LaTeX.Parsing.doMacros'
function doMacrosOn(ctx, n, input) {
  const t = input?.tok;
  if (t === undefined || t.type !== 'CtrlSeq') return input;
  if (t.name === 'begin' || t.name === 'end') {
    const [open, word, close, rest] = take3(input);
    if (
      open?.type === 'Symbol' &&
      open.text === '{' &&
      word?.type === 'Word' &&
      close?.type === 'Symbol' &&
      close.text === '}'
    ) {
      const name = t.name === 'begin' ? word.text : `end${word.text}`;
      return handleMacros(ctx, n, t, name, rest) ?? input;
    }
  }
  if (t.name === 'expandafter') {
    const next = tail(input);
    if (next !== null) {
      return combineTok(next.tok, doMacrosOn(ctx, n, tail(next)));
    }
  }
  return handleMacros(ctx, n, t, t.name, tail(input)) ?? input;
}

// The three tokens after the head, and the stream after them.
function take3(input) {
  const toks = [];
  let cell = tail(input);
  for (let k = 0; k < 3 && cell !== null; k++) {
    toks.push(cell.tok);
    cell = tail(cell);
  }
  return [toks[0], toks[1], toks[2], cell];
}

// `\expandafter`'s token before the expansion after it: a control word
// joined with a word of letters that follows, its spaces kept after.
function combineTok(t, list) {
  const w = list?.tok;
  if (
    t.type === 'CtrlSeq' &&
    w?.type === 'Word' &&
    [...w.text].every(isLetterOrAt)
  ) {
    const space = t.text.search(/[ \t]/);
    const [x1, x2] =
      space === -1
        ? [t.text, '']
        : [t.text.slice(0, space), t.text.slice(space)];
    const tok = { ...t, name: t.name + w.text, text: x1 + w.text + x2 };
    return { tok, next: tail(list) };
  }
  return { tok: t, next: list };
}

/**
 * The expansion of macro `name` at `at`, its arguments read from `rest`;
 * null where it is no macro or its arguments do not parse.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.handleMacros
 */
function handleMacros(ctx, n, at, name, rest) {
  if (n > 20) throw new Error(`PandocMacroLoop: ${name}`);
  const macro = ctx.state.s.macros[0].get(name);
  if (macro === undefined) {
    // What a special macro gives may begin with a macro.
    const special = trySpecialMacro(ctx, name, rest);
    return special === null ? null : doMacrosOn(ctx, n + 1, special);
  }
  // A macro expanding to itself after an unknown command expands again at
  // the same position, each time in a fresh `doMacros` (#11088).
  const last = ctx.state.s.lastExpansion;
  const count =
    last?.name === name &&
    last.source === at.source &&
    last.line === at.line &&
    last.column === at.column
      ? last.count + 1
      : 1;
  if (count > 1000) throw new Error(`PandocMacroLoop: ${name}`);
  const { source, line, column } = at;
  const lastExpansion = { name, source, line, column, count };
  const read = (c) => {
    const args =
      macro.optarg === null
        ? getargs(1, new Map(), macro.argspecs)(c)
        : (() => {
            const x = option(macro.optarg, bracketedToks)(c);
            return x === FAIL
              ? FAIL
              : getargs(2, new Map([[1, x]]), macro.argspecs.slice(1))(c);
          })();
    return args;
  };
  const sub = {
    pos: 0,
    state: { ...ctx.state, input: rest, expanded: false },
    common: ctx.common,
  };
  const args =
    macro.expansionPoint === 'ExpandWhenUsed'
      ? withVerbatimMode(read)(sub)
      : read(sub);
  if (args === FAIL) return null;
  updateLaTeXState(ctx, { lastExpansion });
  const after = sub.state.input;
  let result = after;
  const body = trailingNewlineAsSpace(macro.body, after);
  const resolved = resolveArgs(args);
  for (let k = body.length - 1; k >= 0; k--) {
    result = addTok(false, resolved, at, body[k], result);
  }
  return macro.expansionPoint === 'ExpandWhenUsed'
    ? doMacrosOn(ctx, n + 1, result)
    : result;
}

// Each argument with the arguments it names, as a default may (`O{#2}`),
// substituted; one naming itself, through others or not, left as written.
function resolveArgs(args) {
  const resolve = (visited, xs) =>
    xs.flatMap((t) =>
      t.type === 'Arg' && !visited.includes(t.arg) && args.has(t.arg)
        ? resolve([t.arg, ...visited], args.get(t.arg))
        : [t],
    );
  return new Map([...args].map(([i, xs]) => [i, resolve([i], xs)]));
}

// A body's one final newline a space where a newline follows the use, as
// TeX reads it: no blank line.
function trailingNewlineAsSpace(body, after) {
  const [last, prev] = [body.at(-1), body.at(-2)];
  if (last?.type !== 'Newline' || prev?.type === 'Newline') return body;
  let cell = after;
  while (cell?.tok.type === 'Spaces' || cell?.tok.type === 'Comment') {
    cell = tail(cell);
  }
  if (cell?.tok.type !== 'Newline') return body;
  return [...body.slice(0, -1), { ...last, type: 'Spaces', text: ' ' }];
}

const matchTok = ({ type, text }) =>
  satisfyTok((t) => t.type === type && t.text === text);
const matchPattern = (toks) =>
  attempt((ctx) => {
    for (const t of toks) if (matchTok(t)(ctx) === FAIL) return FAIL;
    return undefined;
  });

// A control sequence at another token's position.
const ctrlSeqAt = (at, name) =>
  setpos(at, { type: 'CtrlSeq', name, text: `\\${name} ` });

const rawBracedOrOneTok = alt(
  (ctx) => {
    const r = withRaw(attempt(braced))(ctx);
    return r === FAIL ? FAIL : r[1];
  },
  (ctx) => {
    const t = anyTok(ctx);
    return t === FAIL ? FAIL : [t];
  },
);
// The tokens up to `pattern`, each part read by `part`.
const upTo = (part, pattern) =>
  attempt((ctx) => {
    const parts = manyTill(part, matchPattern(pattern))(ctx);
    return parts === FAIL ? FAIL : parts.flat();
  });
const spacedBracedOrToken = attempt((ctx) =>
  spaces(ctx) === FAIL ? FAIL : bracedOrToken(ctx),
);
// `p` after `sp`, or with no spaces skipped where `skipSp` is false (`!`).
const afterSp = (skipSp, p) =>
  attempt((ctx) => (skipSp && sp(ctx) === FAIL ? FAIL : p(ctx)));

/**
 * A macro's arguments by their specs, into `argmap`: `num` the number the
 * next one binds where its spec carries none.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.doMacros'
 * @param {number} num
 * @param {Map<number, Tok[]>} argmap
 * @param {ArgSpec[]} specs
 */
function getargs(num, argmap, specs) {
  return (ctx) => {
    const map = new Map(argmap);
    for (let k = 0; k < specs.length; k++) {
      const spec = specs[k];
      const next = specs[k + 1];
      switch (spec.kind) {
        case 'Pattern':
          if (matchPattern(spec.toks)(ctx) === FAIL) return FAIL;
          break;
        case 'ArgNum':
        case 'BodyArg':
        case 'VerbBodyArg': {
          let x;
          if (next?.kind === 'Pattern') {
            // A body to `\end{name}`, its groups kept whole.
            const part =
              spec.kind === 'ArgNum' ? bracedOrOne : rawBracedOrOneTok;
            x = upTo(part, next.toks)(ctx);
            if (x === FAIL) return FAIL;
            if (spec.kind === 'BodyArg' && spec.trim) x = trimSpaceToks(x);
            if (spec.kind === 'VerbBodyArg') x = verbatimBodyToks(spec.trim, x);
            k++;
          } else {
            x = spacedBracedOrToken(ctx);
            if (x === FAIL) return FAIL;
          }
          map.set(spec.num, x);
          num = spec.num + 1;
          break;
        }
        case 'BoolArg': {
          const yes = option(false, (c) =>
            afterSp(spec.skipSp, matchTok(spec.tok))(c) === FAIL ? FAIL : true,
          )(ctx);
          const value = yes ? 'BooleanTrue' : 'BooleanFalse';
          map.set(num++, [ctrlSeqAt(spec.tok, value)]);
          break;
        }
        case 'DelimArg': {
          const missing = spec.dflt ?? [ctrlSeqAt(spec.open, 'NoValue')];
          const delimited = delimitedToks(spec.open, spec.close);
          map.set(num++, option(missing, afterSp(spec.skipSp, delimited))(ctx));
          break;
        }
        case 'VerbArg': {
          const x = verbatimArg(ctx);
          if (x === FAIL) return FAIL;
          map.set(num++, x);
          break;
        }
        case 'EmbellishArg': {
          const seen = grabEmbellishments(spec.embs)(ctx);
          spec.embs.forEach(([t, dflt], i) => {
            map.set(num + i, seen.get(i) ?? dflt ?? [ctrlSeqAt(t, 'NoValue')]);
          });
          num += spec.embs.length;
          break;
        }
        case 'ProcessedArg': {
          const newargs = getargs(num, new Map(), [spec.spec])(ctx);
          if (newargs === FAIL) return FAIL;
          for (const [i, x] of newargs) {
            const y = applyArgProcessors(ctx, spec.procs, x);
            map.set(i, y);
          }
          num += newargs.size;
          break;
        }
      }
    }
    return map;
  };
}

// Embellishments, in any order, each once: their arguments by index.
function grabEmbellishments(embs) {
  return (ctx) => {
    const seen = new Map();
    while (seen.size < embs.length) {
      const got = attempt((c) => {
        if (sp(c) === FAIL) return FAIL;
        const i = alt(
          ...embs
            .map(([t], j) => [t, j])
            .filter(([, j]) => !seen.has(j))
            .map(
              ([t, j]) =>
                (d) =>
                  matchTok(t)(d) === FAIL ? FAIL : j,
            ),
        )(c);
        if (i === FAIL) return FAIL;
        const x = bracedOrOne(c);
        return x === FAIL ? FAIL : [i, x];
      })(ctx);
      if (got === FAIL) break;
      seen.set(got[0], got[1]);
    }
    return seen;
  };
}

// A macro body's token before `acc`, at the macro's position: an argument
// replaced by its tokens, a deferred one made an argument, and a control
// word before a word spaced from it (#4007).
// @see Text.Pandoc.Readers.LaTeX.Parsing.addTok
function addTok(inArg, args, at, t, acc) {
  if (!inArg && t.type === 'DeferredArg') {
    return { tok: setpos(at, { ...t, type: 'Arg' }), next: acc };
  }
  if (!inArg && t.type === 'Arg') {
    const xs = args.get(t.arg);
    // Haskell's `mzero` in the list: nothing, what follows dropped too.
    if (xs === undefined) return null;
    let out = acc;
    for (let k = xs.length - 1; k >= 0; k--)
      out = addTok(true, args, at, xs[k], out);
    return out;
  }
  if (
    t.type === 'CtrlSeq' &&
    acc?.tok.type === 'Word' &&
    t.text !== '' &&
    isLetter([...t.text].at(-1))
  ) {
    return { tok: setpos(at, { ...t, text: `${t.text} ` }), next: acc };
  }
  return { tok: setpos(at, t), next: acc };
}

/**
 * The expansion of a macro Pandoc handles itself, low-level TeX its macro
 * type cannot hold: `\xspace`, `\iftrue`, `\iffalse`, `\ifmmode`,
 * `\ifstrequal`. Null for any other.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.trySpecialMacro
 */
function trySpecialMacro(ctx, name, rest) {
  switch (name) {
    case 'xspace': {
      const expanded = doMacrosOn(ctx, 1, rest);
      const w = expanded?.tok;
      if (w?.type === 'Word' && isAlphaNum([...w.text][0] ?? '')) {
        const space = { ...w, type: 'Spaces', text: ' ', end: w.start };
        return { tok: space, next: expanded };
      }
      return expanded;
    }
    case 'iftrue':
      return doIf(ctx, true, rest);
    case 'iffalse':
      return doIf(ctx, false, rest);
    case 'ifmmode':
      return doIf(ctx, ctx.state.s.mathMode, rest);
    case 'ifstrequal':
      return handleIf(ctx, ifStrequalParser, rest);
    case 'ProcessList':
      return handleIf(ctx, processListParser, rest);
    case 'UseName':
      return handleIf(ctx, useNameParser, rest);
    case 'ExpandArgs':
      return handleIf(ctx, expandArgsParser, rest);
    case 'inteval':
      return handleEval(ctx, evalInteval, rest);
    case 'fpeval':
      return handleEval(ctx, evalFpeval, rest);
    // Dimensions are not evaluated: the expression in their place.
    case 'dimeval':
    case 'skipeval':
      return handleEval(ctx, strip, rest);
    default: {
      const xparseIf = XPARSE_IFS.get(name);
      return xparseIf === undefined ? null : handleIf(ctx, xparseIf, rest);
    }
  }
}

// What a conditional leaves of `rest`, read in a fresh state; null where
// it does not parse.
// @see Text.Pandoc.Readers.LaTeX.Parsing.handleIf
function handleIf(ctx, parser, rest) {
  const { options } = ctx.state.s;
  const sub = lpContext(
    rest,
    defaultLaTeXState(options),
    undefined,
    ctx.common,
  );
  const result = parser(sub);
  return result === FAIL ? null : result;
}

const PRIMITIVE_CONDITIONALS = new Set([
  'if',
  'ifcase',
  'ifcat',
  'ifcsname',
  'ifdefined',
  'ifdim',
  'ifeof',
  'iffalse',
  'iffontchar',
  'ifhbox',
  'ifhmode',
  'ifincsname',
  'ifinner',
  'ifmmode',
  'ifnum',
  'ifodd',
  'iftrue',
  'ifvbox',
  'ifvmode',
  'ifvoid',
  'ifx',
]);

/**
 * A conditional's branch `b` takes, before what follows its `\fi`; the
 * other skipped unexpanded, as TeX skips it. A macro that is one primitive
 * conditional, as `\newif` makes, nests as one. Null where no `\fi` ends
 * it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.doIf
 * @param {boolean} b
 * @param {TokList} rest
 */
function doIf(ctx, b, rest) {
  const conditionals = new Set(PRIMITIVE_CONDITIONALS);
  for (const table of ctx.state.s.macros) {
    for (const [name, m] of table) {
      if (
        m.argspecs.length === 0 &&
        m.optarg === null &&
        m.body.length === 1 &&
        m.body[0].type === 'CtrlSeq' &&
        PRIMITIVE_CONDITIONALS.has(m.body[0].name)
      ) {
        conditionals.add(name);
      }
    }
  }
  const split = splitConditional(conditionals, rest);
  if (split === null) return null;
  const [ifToks, elseToks, after] = split;
  return prepend(b ? ifToks : elseToks, after);
}

/**
 * A conditional's tokens before its `\else` or `\fi`, those of its
 * `\else` branch, and the stream after its `\fi`; null where no `\fi` ends
 * it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.splitConditional
 * @param {Set<string>} conditionals
 * @param {TokList} list
 * @returns {[Tok[], Tok[], TokList] | null}
 */
function splitConditional(conditionals, list) {
  const branches = [[]];
  let depth = 0;
  for (let cell = list; cell !== null; cell = tail(cell)) {
    const t = cell.tok;
    if (t.type === 'CtrlSeq') {
      if (t.name === 'fi' && depth === 0) {
        return [branches[0], branches[1] ?? [], tail(cell)];
      }
      if (t.name === 'else' && depth === 0 && branches.length === 1) {
        branches.push([]);
        continue;
      }
      if (t.name === 'fi') depth--;
      else if (conditionals.has(t.name)) depth++;
    }
    branches.at(-1).push(t);
  }
  return null;
}

const bracedOrOne = alt(
  (ctx) => braced(ctx),
  (ctx) => {
    const t = anyTok(ctx);
    return t === FAIL ? FAIL : [t];
  },
);

/**
 * `\ifstrequal{a}{b}{yes}{no}`: the branch the strings' equality takes.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.ifStrequalParser
 */
function ifStrequalParser(ctx) {
  const str1 = bracedOrOne(ctx);
  if (str1 === FAIL) return FAIL;
  const str2 = bracedOrOne(ctx);
  if (str2 === FAIL) return FAIL;
  const yes = withVerbatimMode(bracedOrOne)(ctx);
  if (yes === FAIL) return FAIL;
  const no = withVerbatimMode(bracedOrOne)(ctx);
  if (no === FAIL) return FAIL;
  const equal = untokenize(str1) === untokenize(str2);
  return prepend(equal ? yes : no, ctx.state.input);
}

// Where the parse is: Pandoc's `getPosition`, as a token's position.
const here = (ctx) => ({
  line: ctx.state.line,
  column: ctx.state.column,
  start: ctx.state.at,
});
const braceGroupAt = (at, ts) => [
  setpos(at, { type: 'Symbol', text: '{' }),
  ...ts,
  setpos(at, { type: 'Symbol', text: '}' }),
];

const isSpaceLike = (t) =>
  t.type === 'Spaces' || t.type === 'Newline' || t.type === 'Comment';
const nonSpace = (ts) => ts.filter((t) => !isSpaceLike(t));

/**
 * An xparse conditional, `\IfNoValueTF` and its kin: the branch the test
 * of its first argument takes; `hasTrue` and `hasFalse` whether it has a
 * true and a false branch.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.xparseIf
 * @param {(arg: Tok[]) => boolean} test
 * @param {boolean} hasTrue
 * @param {boolean} hasFalse
 */
function xparseIf(test, hasTrue, hasFalse) {
  // Spaces and comments may come between the arguments.
  const grabArg = withVerbatimMode((ctx) =>
    spaces(ctx) === FAIL ? FAIL : bracedOrOne(ctx),
  );
  const branch = (has) => (has ? grabArg : () => []);
  const [yes, no] = [branch(hasTrue), branch(hasFalse)];
  return (ctx) => {
    const arg = grabArg(ctx);
    if (arg === FAIL) return FAIL;
    const trueToks = yes(ctx);
    if (trueToks === FAIL) return FAIL;
    const falseToks = no(ctx);
    if (falseToks === FAIL) return FAIL;
    return prepend(test(arg) ? trueToks : falseToks, ctx.state.input);
  };
}

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isNoValueArg */
function isNoValueArg(toks) {
  const ts = nonSpace(toks);
  if (ts.length === 1)
    return ts[0].type === 'CtrlSeq' && ts[0].name === 'NoValue';
  return (
    ts.length === 3 &&
    ts[0].type === 'Symbol' &&
    ts[0].text === '-' &&
    ts[1].type === 'Word' &&
    ts[1].text === 'NoValue' &&
    ts[2].type === 'Symbol' &&
    ts[2].text === '-'
  );
}

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isBooleanTrueArg */
function isBooleanTrueArg(toks) {
  const ts = nonSpace(toks);
  return (
    ts.length === 1 && ts[0].type === 'CtrlSeq' && ts[0].name === 'BooleanTrue'
  );
}

/**
 * Whether an argument is empty or blanks only, as `\IfBlankTF` tests.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.isBlankArg
 */
const isBlankArg = (toks) => toks.every(isSpaceLike);

const XPARSE_IFS = new Map(
  [
    ['NoValue', isNoValueArg],
    ['Value', (ts) => !isNoValueArg(ts)],
    ['Boolean', isBooleanTrueArg],
    ['Blank', isBlankArg],
  ].flatMap(([kind, test]) => [
    [`If${kind}TF`, xparseIf(test, true, true)],
    [`If${kind}T`, xparseIf(test, true, false)],
    [`If${kind}F`, xparseIf(test, false, true)],
  ]),
);

/**
 * `\ProcessList{list}{tokens}`: the tokens before each item of the list,
 * braced.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.processListParser
 */
const processListParser = withVerbatimMode((ctx) => {
  const pos = here(ctx);
  if (spaces(ctx) === FAIL) return FAIL;
  const list = bracedOrOne(ctx);
  if (list === FAIL || spaces(ctx) === FAIL) return FAIL;
  const fn = bracedOrOne(ctx);
  if (fn === FAIL) return FAIL;
  const out = [];
  for (let g = tokGroup(list); g !== null; g = tokGroup(g[1])) {
    out.push(...fn, ...braceGroupAt(pos, g[0]));
  }
  return prepend(out, ctx.state.input);
});

/**
 * `\UseName{string}`: the control sequence the string names.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.useNameParser
 */
function useNameParser(ctx) {
  const pos = here(ctx);
  const name = withVerbatimMode(spacedBraced)(ctx);
  if (name === FAIL) return FAIL;
  return { tok: ctrlSeqAt(pos, untokenize(name)), next: ctx.state.input };
}
const spacedBraced = (ctx) => (spaces(ctx) === FAIL ? FAIL : braced(ctx));
const EXPAND_ARG = {
  // a string made a control sequence
  c: (ctx) => {
    const pos = here(ctx);
    const name = spacedBraced(ctx);
    return name === FAIL ? FAIL : [ctrlSeqAt(pos, untokenize(name))];
  },
  // a braced argument as it is
  n: (ctx) => {
    const pos = here(ctx);
    const toks = spacedBraced(ctx);
    return toks === FAIL ? FAIL : braceGroupAt(pos, toks);
  },
  // a single token as it is
  N: (ctx) => {
    if (spaces(ctx) === FAIL) return FAIL;
    const t = anyTok(ctx);
    return t === FAIL ? FAIL : [t];
  },
};

/**
 * `\ExpandArgs{spec}\cmd{arg1}…`: the command before its arguments, each
 * made as its letter of the spec says.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.expandArgsParser
 */
const expandArgsParser = withVerbatimMode((ctx) => {
  const spec = spacedBraced(ctx);
  if (spec === FAIL || spaces(ctx) === FAIL) return FAIL;
  const cmd = anyTok(ctx);
  if (cmd === FAIL) return FAIL;
  const args = [];
  for (const c of untokenize(spec)) {
    const transform = EXPAND_ARG[c];
    const x = transform === undefined ? FAIL : transform(ctx);
    if (x === FAIL) return FAIL;
    args.push(...x);
  }
  return { tok: cmd, next: prepend(args, ctx.state.input) };
});

/**
 * A LaTeX3 evaluator, `\inteval` and its kin: its braced argument, macros
 * in it expanded as it is read, evaluated in its place; where it will not
 * evaluate, its text, logged as skipped.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.handleEval
 * @param {(arg: string) => string | null} evaluator
 * @param {TokList} rest
 */
function handleEval(ctx, evaluator, rest) {
  const sub = {
    pos: 0,
    state: { ...ctx.state, input: rest, expanded: false },
    common: ctx.common,
  };
  const { line, column, at, source } = sub.state;
  const toks = braced(sub);
  if (toks === FAIL) return null;
  const arg = untokenize(toks);
  let result = evaluator(arg);
  if (result === null) {
    const fields = { contents: `evaluation of ${arg}`, pos: at };
    report(ctx, message('SkippedContent', at, sub.state.at, fields));
    result = arg;
  }
  const made = [...tokenize(result, 0, { line, column })].map((t) => ({
    ...t,
    source,
    start: at,
    end: at,
  }));
  return prepend(made, sub.state.input);
}

// ---------------------------------------------------------------------
// Tokens and arguments

const isCtrlSeq = (t) => t.type === 'CtrlSeq';
const isSymbolTok = (t) => t.type === 'Symbol';
/** @see Text.Pandoc.Readers.LaTeX.Parsing.isNewlineTok */
export const isNewlineTok = (t) => t.type === 'Newline';
/** @see Text.Pandoc.Readers.LaTeX.Parsing.isWordTok */
export const isWordTok = (t) => t.type === 'Word';
/** @see Text.Pandoc.Readers.LaTeX.Parsing.isArgTok */
export const isArgTok = (t) => t.type === 'Arg';
const isSpaceTok = (t) => t.type === 'Spaces';
const isCommentTok = (t) => t.type === 'Comment';

/** @see Text.Pandoc.Readers.LaTeX.Parsing.anyControlSeq */
export const anyControlSeq = satisfyTok(isCtrlSeq);
/** @see Text.Pandoc.Readers.LaTeX.Parsing.anySymbol */
export const anySymbol = satisfyTok(isSymbolTok);
/** @see Text.Pandoc.Readers.LaTeX.Parsing.anyTok */
export const anyTok = satisfyTok(() => true);

/**
 * Whether a token is of one of `types`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.tokTypeIn
 * @param {string[]} types
 */
export const tokTypeIn = (types) => (t) => types.includes(t.type);

const spaceLike = satisfyTok(tokTypeIn(['Comment', 'Spaces', 'Newline']));
/** @see Text.Pandoc.Readers.LaTeX.Parsing.spaces */
export const spaces = skipMany(spaceLike);
/** @see Text.Pandoc.Readers.LaTeX.Parsing.spaces1 */
export const spaces1 = skipMany1(spaceLike);

const controlSeqs = new Map();
/**
 * The control sequence `name`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.controlSeq
 * @param {string} name
 */
export function controlSeq(name) {
  let p = controlSeqs.get(name);
  if (p === undefined) {
    p = satisfyTok((t) => t.type === 'CtrlSeq' && t.name === name);
    controlSeqs.set(name, p);
  }
  return p;
}

const symbols = new Map();
/**
 * A symbol starting with `c`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.symbol
 * @param {string} c
 */
export function symbol(c) {
  let p = symbols.get(c);
  if (p === undefined) {
    p = satisfyTok((t) => t.type === 'Symbol' && t.text[0] === c);
    symbols.set(c, p);
  }
  return p;
}

/**
 * A symbol starting with one of `cs`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.symbolIn
 * @param {string} cs
 */
export const symbolIn = (cs) =>
  satisfyTok(
    (t) => t.type === 'Symbol' && t.text !== '' && cs.includes(t.text[0]),
  );

/** @see Text.Pandoc.Readers.LaTeX.Parsing.whitespace */
const spaceToken = satisfyTok(isSpaceTok);
export const whitespace = (ctx) =>
  spaceToken(ctx) === FAIL ? FAIL : undefined;
/** @see Text.Pandoc.Readers.LaTeX.Parsing.newlineTok */
const newlineToken = satisfyTok(isNewlineTok);
export const newlineTok = (ctx) =>
  newlineToken(ctx) === FAIL ? FAIL : undefined;
/** @see Text.Pandoc.Readers.LaTeX.Parsing.comment */
const commentToken = satisfyTok(isCommentTok);
export const comment = (ctx) => (commentToken(ctx) === FAIL ? FAIL : undefined);

/**
 * Blank space: spaces and tabs, then a newline.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.blankline
 */
export const blankline = attempt((ctx) =>
  skipMany(whitespace)(ctx) === FAIL ? FAIL : newlineTok(ctx),
);

const notBlankline = notFollowedBy(blankline);

/**
 * A newline before more input that is no blank line.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.endline
 */
export const endline = attempt((ctx) => {
  if (newlineTok(ctx) === FAIL || lookAhead(anyTok)(ctx) === FAIL) return FAIL;
  return notBlankline(ctx);
});

const spacesOrComments = skipMany(alt(whitespace, comment));

/**
 * Spaces and comments, then one newline and more of them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.sp
 */
export const sp = (ctx) => {
  if (optional(spacesOrComments)(ctx) === FAIL) return FAIL;
  return optional((c) => (endline(c) === FAIL ? FAIL : spacesOrComments(c)))(
    ctx,
  );
};

/** @see Text.Pandoc.Readers.LaTeX.Parsing.specialChars */
export const SPECIAL_CHARS = new Set('#$%&~_^\\{}');

const singleCharTok = satisfyTok(
  (t) =>
    (t.type === 'Word' && [...t.text].length === 1) ||
    (t.type === 'Symbol' && ![...t.text].some((c) => SPECIAL_CHARS.has(c))),
);

/**
 * A one-character word or a symbol not special; else a word's first
 * character, the rest of it put back.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.singleChar
 */
export const singleChar = alt(singleCharTok, (ctx) => {
  const t = disablingWithRaw(satisfyTok(isWordTok))(ctx);
  if (t === FAIL) return FAIL;
  const first = String.fromCodePoint(t.text.codePointAt(0));
  const split = t.start + first.length;
  const head = { ...t, text: first, end: split };
  const rest = {
    ...t,
    text: t.text.slice(first.length),
    column: t.column + 1,
    start: split,
  };
  setInput(ctx, prepend([head, rest], ctx.state.input), ctx.state.expanded);
  return anyTok(ctx);
});

/**
 * A `^^` escape's character.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.primEscape
 */
export function primEscape(ctx) {
  const t = satisfyTok(tokTypeIn(['Esc1', 'Esc2']))(ctx);
  if (t === FAIL) return FAIL;
  if (t.type === 'Esc1') {
    const code = t.text.codePointAt(2);
    return String.fromCodePoint(
      code >= 64 && code <= 127 ? code - 64 : code + 64,
    );
  }
  return String.fromCodePoint(Number.parseInt(t.text.slice(2), 16));
}

const pushGroup = (ctx) => {
  const { macros } = ctx.state.s;
  updateLaTeXState(ctx, { macros: [macros[0], ...macros] });
};
const popGroup = (ctx) => {
  const { macros } = ctx.state.s;
  if (macros.length > 1) updateLaTeXState(ctx, { macros: macros.slice(1) });
};

const openGroup = alt(
  symbol('{'),
  controlSeq('bgroup'),
  controlSeq('begingroup'),
);
const closeGroup = alt(
  symbol('}'),
  controlSeq('egroup'),
  controlSeq('endgroup'),
);

/**
 * A group's opening, a copy of the macro table pushed for it.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.bgroup
 */
export const bgroup = attempt((ctx) => {
  if (optional(sp)(ctx) === FAIL) return FAIL;
  const t = openGroup(ctx);
  if (t === FAIL) return FAIL;
  pushGroup(ctx);
  return t;
});

/**
 * A group's closing, its macro table popped.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.egroup
 */
export const egroup = (ctx) => {
  const t = closeGroup(ctx);
  if (t === FAIL) return FAIL;
  popGroup(ctx);
  return t;
};

/**
 * `parser`'s values in a group, joined by `mconcat`; `{{a}}` read as
 * `{a}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.grouped
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 * @param {(xs: T[]) => T} mconcat
 */
export function grouped(parser, mconcat) {
  const body = manyTill(parser, egroup);
  const self = attempt((ctx) => {
    if (bgroup(ctx) === FAIL) return FAIL;
    const inner = attempt((c) => {
      const x = self(c);
      return x === FAIL || egroup(c) === FAIL ? FAIL : x;
    })(ctx);
    if (inner !== FAIL) return inner;
    const xs = body(ctx);
    return xs === FAIL ? FAIL : mconcat(xs);
  });
  return self;
}

/**
 * A brace group's tokens, nested braces kept, each read by `getTok`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.braced'
 * @param {import('../core.js').Parser<Tok>} getTok
 * @returns {import('../core.js').Parser<Tok[]>}
 */
export function bracedWith(getTok) {
  const open = symbol('{');
  return (ctx) => {
    if (open(ctx) === FAIL) return FAIL;
    const out = [];
    for (let depth = 1; ; ) {
      const t = getTok(ctx);
      if (t === FAIL) return FAIL;
      if (t.type === 'Symbol' && t.text === '}') {
        if (depth === 1) return out;
        depth--;
      } else if (t.type === 'Symbol' && t.text === '{') {
        depth++;
      }
      out.push(t);
    }
  };
}

/** @see Text.Pandoc.Readers.LaTeX.Parsing.braced */
export const braced = bracedWith(anyTok);

/**
 * A comment in a URL re-read as text: `%`, then its text tokenized again
 * (#5844).
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.retokenizeComment
 */
function retokenizeComment(ctx) {
  const at = ctx.pos;
  const t = satisfyTok(isCommentTok)(ctx);
  if (t === FAIL) return ctx.pos === at ? undefined : FAIL;
  const shifted = [
    ...tokenize(t.text, 1, { line: t.line, column: t.column + 1 }),
  ].map((x) => ({ ...x, start: t.start + x.start, end: t.start + x.end }));
  const percent = { ...t, type: 'Symbol', text: '%', end: t.start + 1 };
  setInput(
    ctx,
    prepend([percent, ...shifted], ctx.state.input),
    ctx.state.expanded,
  );
  return undefined;
}

/**
 * A URL in braces: a `%` in it is no comment.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.bracedUrl
 */
export const bracedUrl = bracedWith((ctx) =>
  retokenizeComment(ctx) === FAIL ? FAIL : anyTok(ctx),
);

/**
 * A brace group's tokens, or a control sequence or single character.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.bracedOrToken
 */
export const bracedOrToken = alt(braced, (ctx) => {
  const t = alt(anyControlSeq, singleChar)(ctx);
  return t === FAIL ? FAIL : [t];
});

/**
 * `parser`'s values in brackets, joined by `mconcat`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.bracketed
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 * @param {(xs: T[]) => T} mconcat
 */
export function bracketed(parser, mconcat) {
  const [open, close] = [symbol('['), symbol(']')];
  const body = manyTill(parser, close);
  return attempt((ctx) => {
    if (open(ctx) === FAIL) return FAIL;
    const xs = body(ctx);
    return xs === FAIL ? FAIL : mconcat(xs);
  });
}

const bracketPart = alt(
  (ctx) => {
    const r = withRaw(attempt(braced))(ctx);
    return r === FAIL ? FAIL : r[1];
  },
  (ctx) => {
    const t = anyTok(ctx);
    return t === FAIL ? FAIL : [t];
  },
);
const bracketParts = manyTill(bracketPart, symbol(']'));

/**
 * A bracketed option's tokens, braces in it kept whole.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.bracketedToks
 */
export function bracketedToks(ctx) {
  if (symbol('[')(ctx) === FAIL) return FAIL;
  const parts = bracketParts(ctx);
  return parts === FAIL ? FAIL : parts.flat();
}

/**
 * The next token, cut at `stopchar` where it holds one: the rest put back,
 * the stop character a symbol of its own and what follows tokenized
 * again.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.verbTok
 * @param {string} stopchar
 * @returns {Parser<Tok>}
 */
export const verbTok = (stopchar) => (ctx) => {
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
 * The tokens between `open` and `close`, delimiters nested in them
 * balanced and groups kept whole; tokens matched by type and text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.delimitedToks
 * @param {Tok} open
 * @param {Tok} close
 */
function delimitedToks(open, close) {
  const [opening, closing] = [matchTok(open), matchTok(close)];
  // A part and how it moves the depth.
  const part = alt(
    (ctx) => {
      const r = withRaw(attempt(braced))(ctx);
      return r === FAIL ? FAIL : [0, r[1]];
    },
    (ctx) => {
      const t = closing(ctx);
      return t === FAIL ? FAIL : [-1, [t]];
    },
    (ctx) => {
      const t = opening(ctx);
      return t === FAIL ? FAIL : [1, [t]];
    },
    (ctx) => {
      const t = anyTok(ctx);
      return t === FAIL ? FAIL : [0, [t]];
    },
  );
  return (ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    const out = [];
    for (let n = 1; ; ) {
      const r = part(ctx);
      if (r === FAIL) return FAIL;
      if (r[0] === -1 && n === 1) return out;
      n += r[0];
      out.push(...r[1]);
    }
  };
}

const notNewline = notFollowedBy(newlineTok);

/**
 * A verbatim argument, xparse's `v`: braced, or between two of one
 * character; one word of its text, so nothing in it is read again.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.verbatimArg
 */
const verbatimArg = attempt((ctx) => {
  if (optional(sp)(ctx) === FAIL) return FAIL;
  const toks = alt(braced, verbDelimited)(ctx);
  if (toks === FAIL) return FAIL;
  if (toks.length === 0) return [];
  const [first, last] = [toks[0], toks.at(-1)];
  const text = untokenize(toks);
  return [{ ...setpos(first, { type: 'Word', text }), end: last.end }];
});

function verbDelimited(ctx) {
  const t = anySymbol(ctx);
  if (t === FAIL) return FAIL;
  const marker = [...t.text];
  if (marker.length !== 1) return FAIL;
  const tok = verbTok(marker[0]);
  return manyTill(
    (c) => (notNewline(c) === FAIL ? FAIL : tok(c)),
    symbol(marker[0]),
  )(ctx);
}

/**
 * A verbatim body, xparse's `c`, as LaTeX typesets it: a word per line,
 * spaces made visible (U+2423), lines joined by `\\`; blank lines at
 * either end dropped where `doTrim`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.verbatimBodyToks
 * @param {boolean} doTrim
 * @param {Tok[]} toks
 * @returns {Tok[]}
 */
function verbatimBodyToks(doTrim, toks) {
  if (toks.length === 0) return [];
  const at = toks[0];
  let ls = lines(untokenize(toks));
  if (doTrim) {
    const isBlank = (l) => /^[ \t]*$/.test(l);
    let [from, to] = [0, ls.length];
    while (from < to && isBlank(ls[from])) from++;
    while (to > from && isBlank(ls[to - 1])) to--;
    ls = ls.slice(from, to);
  }
  const out = [];
  ls.forEach((l, k) => {
    if (k > 0)
      out.push(setpos(at, { type: 'CtrlSeq', name: '\\', text: '\\\\' }));
    if (l !== '') {
      out.push(setpos(at, { type: 'Word', text: l.replaceAll(' ', '␣') }));
    }
  });
  return out;
}

// Haskell's `T.lines`: no line after a final newline.
const lines = (t) => {
  if (t === '') return [];
  const ls = t.split('\n');
  return t.endsWith('\n') ? ls.slice(0, -1) : ls;
};

/**
 * An argument through xparse's processors, the one nearest its spec
 * first.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.applyArgProcessors
 * @param {Tok[][]} procs
 * @param {Tok[]} x
 */
function applyArgProcessors(ctx, procs, x) {
  let y = x;
  for (let k = procs.length - 1; k >= 0; k--) {
    y = applyArgProcessor(ctx, procs[k], y);
  }
  return y;
}

/**
 * An argument through one processor: `\TrimSpaces`, `\ReverseBoolean`,
 * `\SplitArgument` or `\SplitList`; any other logged as skipped, the
 * argument kept.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.applyArgProcessor
 * @param {Tok[]} proc
 * @param {Tok[]} x
 */
function applyArgProcessor(ctx, proc, x) {
  const k = proc.findIndex((t) => !isSpaceLike(t));
  if (k === -1) return x;
  const [p, ts] = [proc[k], proc.slice(k + 1)];
  const missing = () => [ctrlSeqAt(p, 'NoValue')];
  const delimOf = (g) => g?.[0].find((t) => !isSpaceLike(t));
  if (p.type === 'CtrlSeq') {
    switch (p.name) {
      case 'TrimSpaces':
        return trimSpaceToks(x);
      case 'ReverseBoolean': {
        const bs = x.filter((t) => !isSpaceLike(t));
        const b = bs.length === 1 && bs[0].type === 'CtrlSeq' ? bs[0].name : '';
        if (b === 'BooleanTrue') return [ctrlSeqAt(p, 'BooleanFalse')];
        if (b === 'BooleanFalse') return [ctrlSeqAt(p, 'BooleanTrue')];
        return x;
      }
      case 'SplitArgument': {
        const num = tokGroup(ts);
        const numparts = num && readIntArg(untokenize(num[0]));
        const d = num && delimOf(tokGroup(num[1]));
        if (numparts !== null && d !== undefined) {
          const pieces = splitToksOn(d, x).map(trimSpaceToks);
          const out = [];
          for (let i = 0; i <= numparts; i++) {
            out.push(...braceGroupAt(p, pieces[i] ?? missing()));
          }
          return out;
        }
        break;
      }
      case 'SplitList': {
        const d = delimOf(tokGroup(ts));
        if (d !== undefined) {
          return splitToksOn(d, x).flatMap((piece) =>
            braceGroupAt(p, trimSpaceToks(piece)),
          );
        }
        break;
      }
    }
  }
  // An unknown or malformed processor: the argument as it is.
  const fields = { contents: `processor ${untokenize(proc)}`, pos: p.start };
  report(ctx, message('SkippedContent', p.start, p.end, fields));
  return x;
}

// Haskell's `read` of an `Int`; null where it is none.
const readIntArg = (s) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : null);

/**
 * Tokens without the spaces and newlines at either end.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.trimSpaceToks
 * @param {Tok[]} ts
 */
function trimSpaceToks(ts) {
  const isSp = (t) => t.type === 'Spaces' || t.type === 'Newline';
  let [from, to] = [0, ts.length];
  while (from < to && isSp(ts[from])) from++;
  while (to > from && isSp(ts[to - 1])) to--;
  return ts.slice(from, to);
}

/**
 * The first group of a token list, its spaces before skipped: a brace
 * group's contents or a single token, and the tokens after it; null where
 * there is none.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.tokGroup
 * @param {Tok[]} ts
 * @returns {[Tok[], Tok[]] | null}
 */
function tokGroup(ts) {
  const k = ts.findIndex((t) => !isSpaceLike(t));
  if (k === -1) return null;
  if (!isSym(ts[k], '{')) return [[ts[k]], ts.slice(k + 1)];
  for (let j = k + 1, depth = 1; j < ts.length; j++) {
    if (isSym(ts[j], '{')) depth++;
    else if (isSym(ts[j], '}') && --depth === 0) {
      return [ts.slice(k + 1, j), ts.slice(j + 1)];
    }
  }
  return null;
}

const isSym = (t, s) => t.type === 'Symbol' && t.text === s;

/**
 * A token list split at each `d` outside braces, matched by type and text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.splitToksOn
 * @param {Tok} d
 * @param {Tok[]} ts
 * @returns {Tok[][]}
 */
function splitToksOn(d, ts) {
  const out = [[]];
  let depth = 0;
  for (const t of ts) {
    if (depth === 0 && t.type === d.type && t.text === d.text) {
      out.push([]);
      continue;
    }
    if (isSym(t, '{')) depth++;
    else if (isSym(t, '}')) depth = Math.max(0, depth - 1);
    out.at(-1).push(t);
  }
  return out;
}

/**
 * `parser`'s values in parentheses, joined by `mconcat`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.parenWrapped
 * @template T
 * @param {import('../core.js').Parser<T>} parser
 * @param {(xs: T[]) => T} mconcat
 */
export function parenWrapped(parser, mconcat) {
  const [open, close] = [symbol('('), symbol(')')];
  const body = manyTill(parser, close);
  return attempt((ctx) => {
    if (open(ctx) === FAIL) return FAIL;
    const xs = body(ctx);
    return xs === FAIL ? FAIL : mconcat(xs);
  });
}

const DIMENSION_UNITS = new Set([
  '',
  'pt',
  'pc',
  'in',
  'bp',
  'cm',
  'mm',
  'dd',
  'cc',
  'sp',
  'ex',
  'em',
  'mu',
  'px',
]);
const wordTok = satisfyTok(isWordTok);
const digitWord = attempt((ctx) => {
  const t = wordTok(ctx);
  return t === FAIL || !/^[0-9]/.test(t.text) ? FAIL : t.text;
});
const decimals = attempt((ctx) => {
  if (symbol('.')(ctx) === FAIL) return FAIL;
  const t = wordTok(ctx);
  return t === FAIL ? FAIL : `.${t.text}`;
});

/**
 * A dimension: `=`?, `-`?, a number and a unit.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.dimenarg
 */
export const dimenarg = attempt((ctx) => {
  if (optional(sp)(ctx) === FAIL) return FAIL;
  const eq = option(false, (c) => (symbol('=')(c) === FAIL ? FAIL : true))(ctx);
  const minus = option('', (c) => (symbol('-')(c) === FAIL ? FAIL : '-'))(ctx);
  const s1 = option('', digitWord)(ctx);
  const s2 = option('', decimals)(ctx);
  if ([eq, minus, s1, s2].includes(FAIL)) return FAIL;
  const s = s1 + s2;
  const [, num, rest] = /^([0-9.]*)(.*)$/s.exec(s);
  if (num.length === 0 || !DIMENSION_UNITS.has(rest)) return FAIL;
  return (eq ? '=' : '') + minus + s;
});

const keyChar = alt(symbol('-'), symbol('_'), wordTok);
const notEquals = notFollowedBy(symbol('='));
const keyToks = many1((ctx) => (notEquals(ctx) === FAIL ? FAIL : keyChar(ctx)));
const valueTok = satisfyTok(
  (t) => !(t.type === 'Symbol' && [']', ',', '{', '}'].includes(t.text)),
);
const valuePart = alt(
  (ctx) => {
    const r = withRaw(braced)(ctx);
    return r === FAIL ? FAIL : untokenize(r[1]);
  },
  (ctx) => {
    const ts = many1(valueTok)(ctx);
    return ts === FAIL ? FAIL : untokenize(ts);
  },
);
const value = alt(
  (ctx) => {
    const ts = braced(ctx);
    return ts === FAIL ? FAIL : untokenize(ts);
  },
  (ctx) => {
    const parts = many1(valuePart)(ctx);
    return parts === FAIL ? FAIL : parts.join('');
  },
);

/**
 * A `key=value` of a key-value list, its comma read.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.keyval
 */
const keyval = attempt((ctx) => {
  if (sp(ctx) === FAIL) return FAIL;
  const key = keyToks(ctx);
  if (key === FAIL || sp(ctx) === FAIL) return FAIL;
  const val = option('', (c) => {
    if (symbol('=')(c) === FAIL || sp(c) === FAIL) return FAIL;
    return value(c);
  })(ctx);
  if (val === FAIL || sp(ctx) === FAIL) return FAIL;
  if (optional(symbol(','))(ctx) === FAIL || sp(ctx) === FAIL) return FAIL;
  return [untokenize(key), val.trim()];
});

/**
 * Key-value pairs in brackets.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.keyvals
 */
export const keyvals = attempt((ctx) => {
  if (symbol('[')(ctx) === FAIL) return FAIL;
  const kvs = manyTill(keyval, symbol(']'))(ctx);
  return kvs === FAIL || sp(ctx) === FAIL ? FAIL : kvs;
});

/**
 * Text without its final newline and the spaces after it, where it ends
 * with those.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.stripTrailingNewline
 * @param {string} t
 */
function stripTrailingNewline(t) {
  const nl = t.lastIndexOf('\n');
  if (!/^ *$/.test(t.slice(nl + 1))) return t;
  return nl === -1 ? '' : t.slice(0, nl);
}

/**
 * A verbatim environment's text to `\end{name}`, as written.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.verbEnv
 * @param {string} name
 */
export const verbEnv = (name) =>
  withVerbatimMode((ctx) => {
    if (optional(blankline)(ctx) === FAIL) return FAIL;
    const res = manyTill(anyTok, end_(name))(ctx);
    return res === FAIL ? FAIL : stripTrailingNewline(untokenize(res));
  });

const envName = (cs) => (name) =>
  attempt((ctx) => {
    if (controlSeq(cs)(ctx) === FAIL || spaces(ctx) === FAIL) return FAIL;
    const txt = braced(ctx);
    return txt === FAIL || untokenize(txt) !== name ? FAIL : undefined;
  });

/** @see Text.Pandoc.Readers.LaTeX.Parsing.begin_ */
export const begin_ = envName('begin');
/** @see Text.Pandoc.Readers.LaTeX.Parsing.end_ */
export const end_ = envName('end');

const FONT_SIZES = new Set([
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
]);

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isFontSizeCommand */
export const isFontSizeCommand = (name) => FONT_SIZES.has(name);

const digitsTok = satisfyTok(
  (t) => t.type === 'Word' && /^[0-9]*$/.test(t.text),
);
const preTok = satisfyTok((t) => t.type === 'Word' && t.text === 'pre');
const plusMinus = satisfyTok(
  (t) => t.type === 'Word' && (t.text === 'plus' || t.text === 'minus'),
);
const glue = skipMany(
  attempt((ctx) => {
    if (sp(ctx) === FAIL || plusMinus(ctx) === FAIL) return FAIL;
    return dimenarg(ctx);
  }),
);
const untilBraced = (ctx) => {
  const r = manyTill(anyTok, braced)(ctx);
  return r === FAIL ? FAIL : undefined;
};

// What an unknown command takes after its name, by name.
const RAW_ARGS = new Map([
  ['write', (ctx) => (skipMany(digitsTok)(ctx) === FAIL ? FAIL : braced(ctx))],
  [
    'titleformat',
    (ctx) => {
      if (braced(ctx) === FAIL || skipopts(ctx) === FAIL) return FAIL;
      return count(4, braced)(ctx);
    },
  ],
  ['def', untilBraced],
  ['vadjust', alt(untilBraced, preTok)],
]);
const NO_ARGS = new Set([
  'hfil',
  'hfill',
  'vfil',
  'vfill',
  'hfilneg',
  'vfilneg',
]);
const SKIPS = new Set(['hskip', 'vskip', 'mskip']);
const bracedArgs = many(braced);
const otherArgs = (ctx) => {
  if (skipopts(ctx) === FAIL) return FAIL;
  if (option('', attempt(dimenarg))(ctx) === FAIL) return FAIL;
  return bracedArgs(ctx);
};

/**
 * A command Pandoc does not know, raw: its text `txt` and its arguments,
 * as its name says they go; most take options, a dimension and braced
 * groups.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.getRawCommand
 * @param {string} name
 * @param {string} txt
 * @returns {import('../core.js').Parser<string>}
 */
export const getRawCommand = (name, txt) => (ctx) => {
  const args = (() => {
    const known = RAW_ARGS.get(name);
    if (known !== undefined) return known;
    if (isFontSizeCommand(name) || NO_ARGS.has(name)) return () => undefined;
    if (SKIPS.has(name)) return (c) => (dimenarg(c) === FAIL ? FAIL : glue(c));
    return otherArgs;
  })();
  const read = withRaw(args)(ctx);
  return read === FAIL ? FAIL : txt + untokenize(read[1]);
};

const overlayTok = satisfyTok(
  (t) =>
    t.type === 'Word' ||
    t.type === 'Spaces' ||
    (t.type === 'Symbol' && ['-', '+', '@', '|', ':', ','].includes(t.text)),
);
const OVERLAY_WORDS = new Set([
  'beamer',
  'presentation',
  'trans',
  'handout',
  'article',
  'second',
]);

/**
 * A beamer overlay specification, `<…>`: not letters alone, but for its
 * mode names (#3368).
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.overlaySpecification
 */
export const overlaySpecification = attempt((ctx) => {
  if (symbol('<')(ctx) === FAIL) return FAIL;
  const ts = manyTill(overlayTok, symbol('>'))(ctx);
  if (ts === FAIL) return FAIL;
  const t = untokenize(ts);
  if ([...t].every((c) => isLetter(c)) && !OVERLAY_WORDS.has(t)) return FAIL;
  return `<${t}>`;
});

/**
 * An option in brackets, as written.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.rawopt
 */
export const rawopt = attempt((ctx) => {
  if (sp(ctx) === FAIL) return FAIL;
  const inner = bracketedToks(ctx);
  if (inner === FAIL || sp(ctx) === FAIL) return FAIL;
  return `[${untokenize(inner)}]`;
});

/**
 * Options and overlay specifications, skipped.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.skipopts
 */
export const skipopts = skipMany(alt(overlaySpecification, rawopt));

/**
 * The next number of a header, figure or table: its chapter's, where the
 * document has chapters.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.getNextNumber
 * @param {(s: object) => number[]} current
 */
export const getNextNumber = (current) => (ctx) => {
  const s = ctx.state.s;
  const chapnum =
    s.hasChapters && s.lastHeaderNum.length > 0 ? s.lastHeaderNum[0] : null;
  const ns = current(s);
  if (ns.length === 2) {
    const [m, n] = ns;
    if (chapnum === null) return [1];
    return chapnum === m ? [m, n + 1] : [chapnum, 1];
  }
  if (ns.length === 1) return chapnum === null ? [ns[0] + 1] : [chapnum, 1];
  return chapnum === null ? [1] : [chapnum, 1];
};

/**
 * `\label{…}`, recorded as the last label.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.label
 */
export function label(ctx) {
  if (controlSeq('label')(ctx) === FAIL) return FAIL;
  const t = braced(ctx);
  if (t === FAIL) return FAIL;
  updateLaTeXState(ctx, { lastLabel: untokenize(t) });
  return undefined;
}

/**
 * An environment's body by `p`, in a group of its own as macros go, then
 * `\end{name}`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.env
 * @template T
 * @param {string} name
 * @param {import('../core.js').Parser<T>} p
 */
export const env = (name, p) => {
  const end = end_(name);
  return (ctx) => {
    pushGroup(ctx);
    const result = p(ctx);
    if (result === FAIL) return FAIL;
    popGroup(ctx);
    return end(ctx) === FAIL ? FAIL : result;
  };
};

/**
 * `val`, a metadata value, added to the document's metadata at `field`.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.addMeta
 * @param {{state: LPState}} ctx
 * @param {string} field
 * @param {{t: string, c: unknown}} val
 */
export function addMeta(ctx, field, val) {
  updateLaTeXState(ctx, { meta: addMetaField(field, val, ctx.state.s.meta) });
}

/**
 * A caption, its short form in brackets, then a label it may have.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.setCaption
 * @param {import('../core.js').Parser<B.Inlines>} inline
 * @returns {import('../core.js').Parser<undefined>}
 */
export function setCaption(inline) {
  const short = option(null, bracketed(inline, B.concat));
  const long = tokWith(inline);
  const trailingLabel = optional(
    attempt((ctx) => (spaces(ctx) === FAIL ? FAIL : label(ctx))),
  );
  return attempt((ctx) => {
    const mbshort = short(ctx);
    if (mbshort === FAIL) return FAIL;
    const from = ctx.state.at;
    const ils = long(ctx);
    if (ils === FAIL) return FAIL;
    // Pandoc's `Plain` itself, not the builder's: a plain of nothing too.
    const plain = new Node('Plain', ils, from, ctx.state.at);
    if (trailingLabel(ctx) === FAIL) return FAIL;
    updateLaTeXState(ctx, { caption: B.caption(mbshort, [plain]) });
    return undefined;
  });
}

/**
 * The attributes of a heading of `inlines`: with `auto_identifiers`, an
 * identifier made from its text where it has none; either way recorded as
 * used. The LaTeX state's instance of `HasIdentifierList`.
 *
 * Pandoc's logs nothing of an identifier used again: its LaTeX reader
 * reports no message it holds.
 *
 * Not ported yet: `ascii_identifiers`.
 *
 * @see Text.Pandoc.Parsing.General.registerHeader
 * @param {{state: LPState}} ctx
 * @param {[string, string[], [string, string][]]} attr
 * @param {B.Inlines} inlines
 */
export function registerHeader(ctx, [ident, classes, kvs], inlines) {
  const used = ctx.state.s.identifiers;
  const auto = ctx.state.s.options.extensions.has('auto_identifiers');
  const id = ident === '' && auto ? uniqueIdent(inlines, used) : ident;
  if (id !== '') updateLaTeXState(ctx, { identifiers: new Set(used).add(id) });
  return [id, classes, kvs];
}

/**
 * The caption and last label forgotten.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.resetCaption
 */
export const resetCaption = (ctx) =>
  updateLaTeXState(ctx, { caption: null, lastLabel: null });

/**
 * One argument read by `inlineParser`: a group, a command, or a single
 * character.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.tokWith
 * @param {import('../core.js').Parser<B.Inlines>} inlineParser
 * @returns {import('../core.js').Parser<B.Inlines>}
 */
export function tokWith(inlineParser) {
  const argument = alt(
    grouped(inlineParser, B.concat),
    (ctx) =>
      lookAhead(anyControlSeq)(ctx) === FAIL ? FAIL : inlineParser(ctx),
    (ctx) => {
      const t = singleChar(ctx);
      return t === FAIL ? FAIL : B.str(t.text, t.start, t.end);
    },
  );
  return attempt((ctx) => (spaces(ctx) === FAIL ? FAIL : argument(ctx)));
}

const isSpaceOrSoftBreak = (x) => x.t === 'Space' || x.t === 'SoftBreak';

/**
 * `value` without the spans labeled `lbl`, nor the spaces after them.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.removeLabel
 * @template T
 * @param {string} lbl
 * @param {T} value
 * @returns {T}
 */
export function removeLabel(lbl, value) {
  const go = (xs) => {
    const out = [];
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k];
      if (
        x.t === 'Span' &&
        x.c[0][2].find(([key]) => key === 'label')?.[1] === lbl
      ) {
        while (k + 1 < xs.length && isSpaceOrSoftBreak(xs[k + 1])) k++;
      } else {
        out.push(x);
      }
    }
    return out;
  };
  return walk({ inlines: go }, value);
}

// ---------------------------------------------------------------------
// Raw TeX in other formats

/**
 * The tokens of what a parse of another format has left to read, from
 * where it is.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.getInputTokens
 * @param {{text: string, pos: number}} ctx
 * @returns {TokList}
 */
export function getInputTokens(ctx) {
  if (ctx.pos >= ctx.text.length) return null;
  return streamOf(tokenize(ctx.text, ctx.pos, getPosition(ctx)));
}

const before = (a, b) =>
  a.line < b.line || (a.line === b.line && a.column < b.column);

/**
 * Raw TeX in another format's parse: `parser`'s extent of `toks`, read
 * with no macros, then `valParser`'s value of the tokens it took, read
 * with the parse's macros, which take those it defines. The parse reads
 * on to where the extent ends, as Pandoc's positions map it back,
 * tokenizer drifts included: the text it reads, or with `latex_macros` the
 * tokens' text, macros expanded. Null where either parse fails.
 *
 * Its host reads no files: the other format's parse has none. What it
 * reports goes to that parse's log.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.rawLaTeXParser
 * @template A
 * @param {TokList} toks
 * @param {import('../core.js').Parser<unknown>} parser
 * @param {import('../core.js').Parser<A>} valParser
 * @returns {import('../core.js').Parser<[A, string]>}
 */
export const rawLaTeXParser = (toks, parser, valParser) => (ctx) => {
  const pstate = ctx.state;
  const common = { ...commonState(), log: logOf(ctx) };
  const lstate = defaultLaTeXState(pstate.options);
  const extent = lpContext(toks, lstate, undefined, common);
  const first = withRaw((c) =>
    parser(c) === FAIL ? FAIL : { line: c.state.line, column: c.state.column },
  )(extent);
  if (first === FAIL) return FAIL;
  const [endpos, toks2] = first;
  const lstate2 = { ...lstate, macros: [pstate.macros] };
  const value = lpContext(
    prepend(toks2, null),
    lstate2,
    toks2.at(-1)?.end,
    common,
  );
  const second = withRaw(valParser)(value);
  if (second === FAIL) return FAIL;
  const [val, raw] = second;
  const macros = new Map([...pstate.macros, ...value.state.s.macros[0]]);
  ctx.state = { ...ctx.state, macros };
  const from = ctx.pos;
  while (ctx.pos < ctx.text.length && before(getPosition(ctx), endpos)) {
    ctx.pos += codePointLength(ctx.text, ctx.pos);
  }
  let result = pstate.options.extensions.has('latex_macros')
    ? untokenize(raw)
    : ctx.text.slice(from, ctx.pos);
  // ensure we end with space if input did, see #4442
  const last = toks2.at(-1);
  if (
    last?.type === 'CtrlSeq' &&
    last.text.endsWith(' ') &&
    !result.endsWith(' ')
  ) {
    result += ' ';
  }
  return [val, result];
};

/**
 * Math with the parse's macros applied, where `latex_macros` is on.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.applyMacros
 * @param {{state: {options: object, macros: Map<string, Macro>}}} ctx
 * @param {string} s
 * @returns {string}
 */
export function applyMacros(ctx, s) {
  const { options, macros } = ctx.state;
  if (!options.extensions.has('latex_macros')) return s;
  const lstate = { ...defaultLaTeXState(options), macros: [macros] };
  const math = lpContext(
    streamOf(tokenize(s)),
    lstate,
    s.length,
    commonState(),
  );
  const toks = many(anyTok)(math);
  return untokenize(toks);
}
