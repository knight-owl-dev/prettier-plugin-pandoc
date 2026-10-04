// The LaTeX reader's parsing toolkit: TeX tokenized, and tokens written
// back as text.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Parsing`.

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
import { readInt } from '../parsing/lists.js';

/** @typedef {import('../tex.js').Tok} Tok */

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isSpaceOrTab */
const isSpaceOrTab = (c) => c === ' ' || c === '\t';

/**
 * A letter, or `@` where `\makeatletter` made it one.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.isLetter'
 * @param {boolean} atIsLetter
 * @param {string} c
 */
const isLetterOrAt = (atIsLetter, c) =>
  (atIsLetter && c === '@') || isLetter(c);

/** @see Text.Pandoc.Readers.LaTeX.Parsing.isLowerHex */
const isLowerHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');

const isDigit = (c) => c >= '0' && c <= '9';

/**
 * The tokens of `text` from `from`, the first at Pandoc's position `line`
 * and `column`, made on demand: a consumer of the first ones tokenizes no
 * further. Positions move as Pandoc's do, drifts and all: a control space
 * before a non-blank line, `##` without digits, and `^^` before a newline
 * leave later positions behind the text.
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
  let atIsLetter = false;
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
      if (isLetterOrAt(atIsLetter, d)) {
        const [wordEnd, wn] = span(rest, (x) => isLetterOrAt(atIsLetter, x));
        const [end, sn] = span(wordEnd, isSpaceOrTab);
        const name = text.slice(rest, wordEnd);
        yield tok('CtrlSeq', at, end, { name });
        if (name === 'makeatletter') atIsLetter = true;
        else if (name === 'makeatother') atIsLetter = false;
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
          // Two symbols, the position past the first only: the rest of
          // the line drifts a column.
          yield tok('Symbol', at, rest);
          column++;
          yield tok('Symbol', rest, rest + 1);
          at = rest + 1;
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
 * writing them together would make one control word.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untokenize
 * @param {Iterable<Tok>} toks
 */
export function untokenize(toks) {
  const list = [...toks];
  let out = '';
  for (let k = list.length - 1; k >= 0; k--) out = untokenAccum(list[k], out);
  return out;
}

/**
 * One token as text.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.untoken
 * @param {Tok} tok
 */
export const untoken = (tok) => untokenAccum(tok, '');

// A token's text before `accum`: a control sequence ending in a letter
// spaced from a letter after it.
// @see Text.Pandoc.Readers.LaTeX.Parsing.untokenAccum
function untokenAccum(tok, accum) {
  const { text } = tok;
  if (tok.type === 'CtrlSeq') {
    const last = [...text].at(-1);
    const first =
      accum === '' ? undefined : String.fromCodePoint(accum.codePointAt(0));
    if (
      last !== undefined &&
      first !== undefined &&
      isLetter(last) &&
      isLetter(first)
    ) {
      return `${text} ${accum}`;
    }
  }
  return text + accum;
}

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
});

/**
 * A parse's context over tokens: `pos` counts the tokens read, which is
 * how Parsec tells consuming from not; the state holds the input with the
 * reader's state, so backtracking puts back what macro expansion rewrote,
 * as Parsec's `setInput` is undone. `line` and `column` are Pandoc's
 * position, `at` the true offset it stands for; `raws` the tokens each
 * open `withRaw` has read, latest first, by key.
 *
 * @typedef {object} LPState
 * @property {TokList} input
 * @property {boolean} expanded Whether macros are expanded at the input's
 *   head.
 * @property {number} line
 * @property {number} column
 * @property {number} at
 * @property {[number, TokList][]} raws
 * @property {ReturnType<typeof defaultLaTeXState>} s
 */

/**
 * A context reading `input` in state `s`, at its first token's position.
 *
 * @param {TokList} input
 * @param {ReturnType<typeof defaultLaTeXState>} s
 */
export function lpContext(input, s) {
  const first = input?.tok;
  return {
    pos: 0,
    state: {
      input,
      expanded: false,
      line: first?.line ?? 1,
      column: first?.column ?? 1,
      at: first?.start ?? 0,
      raws: [],
      s,
    },
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

// Replace the input, as Parsec's `setInput`: no token read.
const setInput = (ctx, input, expanded) => {
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
      at: after ? after.start : tok.end,
      raws: st.s.enableWithRaw
        ? st.raws.map(([key, list]) => [key, { tok, next: list }])
        : st.raws,
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
  return lookAhead(anyTok)(ctx);
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
    raws: [],
  };
  const result = parser(ctx);
  ctx.state = {
    ...ctx.state,
    input: outer.input,
    expanded: outer.expanded,
    line: outer.line,
    column: outer.column,
    at: outer.at,
    raws: outer.raws,
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
  const { raws } = ctx.state;
  const key = raws.length === 0 ? 0 : Math.max(...raws.map(([k]) => k)) + 1;
  ctx.state = { ...ctx.state, raws: [...raws, [key, null]] };
  const result = parser(ctx);
  if (result === FAIL) return FAIL;
  const entry = ctx.state.raws.find(([k]) => k === key);
  if (entry === undefined) {
    throw new Error(`sRawTokens has nothing at key ${key}`);
  }
  ctx.state = {
    ...ctx.state,
    raws: ctx.state.raws.filter(([k]) => k !== key),
  };
  return [result, tokensOf(entry[1]).reverse()];
};

// ---------------------------------------------------------------------
// Macros

/**
 * A macro: its scope, when its body expands, its arguments (a number, or
 * tokens to match), the default of an optional first argument, and its
 * body.
 *
 * @see Text.Pandoc.TeX.Macro
 * @typedef {object} Macro
 * @property {'GlobalScope' | 'GroupScope'} scope
 * @property {'ExpandWhenDefined' | 'ExpandWhenUsed'} expansionPoint
 * @property {({num: number} | {pattern: Tok[]})[]} argspecs
 * @property {Tok[] | null} optarg
 * @property {Tok[]} body
 */

// A token at another's position: Pandoc's line and column, and its span.
const setpos = (at, tok) => ({
  ...tok,
  line: at.line,
  column: at.column,
  start: at.start,
  end: at.end,
});

/**
 * Macros at the input's head expanded, unless the head is expanded
 * already or the reader is in verbatim mode.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.doMacros
 * @param {{state: LPState}} ctx
 */
export function doMacros(ctx) {
  const { input, expanded, s } = ctx.state;
  if (expanded || s.verbatimMode) return;
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
    [...w.text].every((c) => isLetterOrAt(true, c))
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
  if (macro === undefined) return trySpecialMacro(ctx, name, rest);
  const read = (c) => {
    const args =
      macro.optarg === null
        ? getargs(new Map(), macro.argspecs)(c)
        : (() => {
            const x = option(macro.optarg, bracketedToks)(c);
            return x === FAIL
              ? FAIL
              : getargs(new Map([[1, x]]), macro.argspecs.slice(1))(c);
          })();
    return args;
  };
  const sub = { pos: 0, state: { ...ctx.state, input: rest, expanded: false } };
  const args =
    macro.expansionPoint === 'ExpandWhenUsed'
      ? withVerbatimMode(read)(sub)
      : read(sub);
  if (args === FAIL) return null;
  let result = sub.state.input;
  for (let k = macro.body.length - 1; k >= 0; k--) {
    result = addTok(false, args, at, macro.body[k], result);
  }
  return macro.expansionPoint === 'ExpandWhenUsed'
    ? doMacrosOn(ctx, n + 1, result)
    : result;
}

const matchTok = ({ type, text }) =>
  satisfyTok((t) => t.type === type && t.text === text);
const matchPattern = (toks) =>
  attempt((ctx) => {
    for (const t of toks) if (matchTok(t)(ctx) === FAIL) return FAIL;
    return undefined;
  });

// A macro's arguments by their specs: a numbered one up to the pattern
// after it, or braced or a single token; a pattern matched.
function getargs(argmap, specs) {
  return (ctx) => {
    let map = argmap;
    for (let k = 0; k < specs.length; k++) {
      const spec = specs[k];
      if ('pattern' in spec) {
        if (attempt(matchPattern(spec.pattern))(ctx) === FAIL) return FAIL;
        continue;
      }
      const next = specs[k + 1];
      if (next !== undefined && 'pattern' in next) {
        const x = attempt((c) => {
          const parts = manyTill(
            alt(braced, (d) => {
              const t = anyTok(d);
              return t === FAIL ? FAIL : [t];
            }),
            matchPattern(next.pattern),
          )(c);
          return parts === FAIL ? FAIL : parts.flat();
        })(ctx);
        if (x === FAIL) return FAIL;
        map = new Map(map).set(spec.num, x);
        k++;
        continue;
      }
      const x = attempt((c) => (spaces(c) === FAIL ? FAIL : bracedOrToken(c)))(
        ctx,
      );
      if (x === FAIL) return FAIL;
      map = new Map(map).set(spec.num, x);
    }
    return map;
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
      return handleIf(ifParser(true), rest, ctx.state.s.options);
    case 'iffalse':
      return handleIf(ifParser(false), rest, ctx.state.s.options);
    case 'ifmmode':
      return handleIf(
        ifParser(ctx.state.s.mathMode),
        rest,
        ctx.state.s.options,
      );
    case 'ifstrequal':
      return handleIf(ifStrequalParser, rest, ctx.state.s.options);
    default:
      return null;
  }
}

// What a conditional leaves of `rest`, read in a fresh state; null where
// it does not parse.
// @see Text.Pandoc.Readers.LaTeX.Parsing.handleIf
function handleIf(parser, rest, options) {
  const sub = lpContext(rest, defaultLaTeXState(options));
  const result = parser(sub);
  return result === FAIL ? null : result;
}

const elseOrFi = alt(
  (ctx) => controlSeq('else')(ctx),
  (ctx) => controlSeq('fi')(ctx),
);

/**
 * A conditional's branches to `\fi`: the one `b` takes, before the rest.
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.ifParser
 * @param {boolean} b
 */
function ifParser(b) {
  const ifToks = many((ctx) =>
    notFollowedBy(elseOrFi)(ctx) === FAIL ? FAIL : anyTok(ctx),
  );
  const elseToks = alt(
    (ctx) =>
      controlSeq('else')(ctx) === FAIL
        ? FAIL
        : manyTill(anyTok, controlSeq('fi'))(ctx),
    (ctx) => (controlSeq('fi')(ctx) === FAIL ? FAIL : []),
  );
  return (ctx) => {
    const yes = ifToks(ctx);
    if (yes === FAIL) return FAIL;
    const no = elseToks(ctx);
    if (no === FAIL) return FAIL;
    return prepend(b ? yes : no, ctx.state.input);
  };
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
 * A comment in a URL re-read as text: `%`, then its text tokenized again,
 * at positions shifted as Pandoc shifts them (#5844).
 *
 * @see Text.Pandoc.Readers.LaTeX.Parsing.retokenizeComment
 */
function retokenizeComment(ctx) {
  const at = ctx.pos;
  const t = satisfyTok(isCommentTok)(ctx);
  if (t === FAIL) return ctx.pos === at ? undefined : FAIL;
  const shifted = [
    ...tokenize(t.text, 1, { line: t.line, column: t.column }),
  ].map((x) => ({
    ...x,
    line: x.line + t.line - 1,
    column: x.column + t.column,
    start: t.start + x.start,
    end: t.start + x.end,
  }));
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
