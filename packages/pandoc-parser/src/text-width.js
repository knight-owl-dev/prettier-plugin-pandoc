// Display width as Pandoc measures it: a wide character or an emoji counts
// 2, a combining mark or a control 0, any other character 1, an ambiguous
// one too. Simple and multiline tables split their lines into columns by it.
//
// Ported from doclayout 0.5.0.3's `Text.DocLayout`, its narrow context.

import { BASE_EMOJIS, UNICODE_SPEC } from './text-width-table.js';

const ZWJ = 0x200d;
const VARIATION = 0xfe0f;
const isSkinTone = (cp) => cp >= 0x1f3fb && cp <= 0x1f3ff;

/**
 * The width class of each range of code points, by its first: the spec's,
 * an ambiguous width narrow, runs of one class merged, and the joiner and
 * emoji modifiers classes of their own, the class before each restored
 * after it.
 *
 * @see Text.DocLayout.unicodeRangeMap
 */
const RANGES = (() => {
  const map = new Map();
  let last;
  for (const [cp, spec] of UNICODE_SPEC) {
    const width = spec === 'A' ? 'N' : spec;
    if (width !== last) map.set(cp, width);
    last = width;
  }
  for (const [from, to, width] of [
    [0x1f3fb, 0x1f3ff, 'S'],
    [VARIATION, VARIATION, 'V'],
    [ZWJ, ZWJ, 'J'],
  ]) {
    const keys = [...map.keys()].sort((x, y) => x - y);
    const i = lastAtOrBelow(keys, from);
    const before = i < 0 ? undefined : map.get(keys[i]);
    map.set(from, width);
    if (before !== undefined && !map.has(to + 1)) map.set(to + 1, before);
  }
  const starts = [...map.keys()].sort((a, b) => a - b);
  return { starts, widths: starts.map((cp) => map.get(cp)) };
})();

// The index of the last of the sorted `keys` at or below `cp`; -1 for none.
function lastAtOrBelow(keys, cp) {
  let [lo, hi] = [0, keys.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid] <= cp) lo = mid;
    else hi = mid - 1;
  }
  return keys[lo] <= cp ? lo : -1;
}

/**
 * The width class of `cp` in the ranges: a control where none holds it.
 *
 * @see Text.DocLayout.unicodeWidth
 * @param {number} cp
 */
function rangeClass(cp) {
  const i = lastAtOrBelow(RANGES.starts, cp);
  return i < 0 ? 'X' : RANGES.widths[i];
}

// doclayout's shortcuts for common blocks, which Pandoc reads before the
// ranges and which disagree with them in places: guards in order, each
// `['<=', to, then]`, `['=', cp, then]`, `['in', from, to, then]` or
// `['else', then]`, `then` a class or guards of its own.
// @see Text.DocLayout.updateMatchStateNarrow
const SHORTCUTS = [
  ['<=', 0x1f, 'X'],
  ['<=', 0x7e, 'N'],
  ['<=', 0x9f, 'X'],
  ['=', 0xad, 'X'],
  ['<=', 0x2ff, 'N'],
  ['<=', 0x36f, 'C'],
  [
    'in',
    0x3250,
    0xa4cf,
    [
      ['<=', 0x4dbf, 'W'],
      ['<=', 0x4dff, 'N'],
      ['else', 'W'],
    ],
  ],
  [
    'in',
    0x600,
    0x6ff,
    [
      ['<=', 0x605, 'X'],
      ['<=', 0x60f, 'N'],
      ['<=', 0x61a, 'C'],
      ['=', 0x61b, 'N'],
      ['<=', 0x61c, 'X'],
      ['<=', 0x64a, 'N'],
      ['<=', 0x65f, 'C'],
      ['=', 0x670, 'C'],
      ['<=', 0x6d5, 'N'],
      ['<=', 0x6dc, 'C'],
      ['=', 0x6dd, 'X'],
      ['=', 0x6de, 'N'],
      ['<=', 0x6e4, 'C'],
      ['<=', 0x6e6, 'N'],
      ['=', 0x6e9, 'N'],
      ['<=', 0x6ed, 'C'],
      ['else', 'N'],
    ],
  ],
  [
    'in',
    0x900,
    0x97f,
    [
      ['<=', 0x902, 'C'],
      ['<=', 0x939, 'N'],
      ['=', 0x93a, 'C'],
      ['=', 0x93c, 'C'],
      ['<=', 0x940, 'N'],
      ['<=', 0x948, 'C'],
      ['=', 0x94d, 'C'],
      ['<=', 0x950, 'N'],
      ['<=', 0x957, 'C'],
      ['=', 0x962, 'C'],
      ['=', 0x963, 'C'],
      ['else', 'N'],
    ],
  ],
  [
    'in',
    0x980,
    0xa02,
    [
      ['=', 0x981, 'C'],
      ['=', 0x9bc, 'C'],
      ['<=', 0x9c0, 'N'],
      ['<=', 0x9c4, 'C'],
      ['=', 0x9cd, 'C'],
      ['<=', 0x9e1, 'N'],
      ['<=', 0x9e3, 'C'],
      ['<=', 0x9fd, 'N'],
      ['else', 'C'],
    ],
  ],
  [
    'in',
    0x370,
    0x58f,
    [
      ['<=', 0x482, 'N'],
      ['<=', 0x489, 'C'],
      ['else', 'N'],
    ],
  ],
  [
    'in',
    0x2e80,
    0x324f,
    [
      ['<=', 0x3029, 'W'],
      ['<=', 0x302d, 'C'],
      ['=', 0x303f, 'N'],
      ['<=', 0x3096, 'W'],
      ['<=', 0x309a, 'C'],
      ['<=', 0x3247, 'W'],
      ['else', 'N'],
    ],
  ],
  ['in', 0xac00, 0xd7a3, 'W'],
  [
    'in',
    0xc00,
    0xc80,
    [
      ['=', 0xc00, 'C'],
      ['=', 0xc04, 'C'],
      ['<=', 0xc39, 'N'],
      ['=', 0xc3d, 'N'],
      ['<=', 0xc40, 'C'],
      ['<=', 0xc44, 'N'],
      ['<=', 0xc56, 'C'],
      ['=', 0xc62, 'C'],
      ['=', 0xc63, 'C'],
      ['else', 'N'],
    ],
  ],
  [
    'in',
    0xb80,
    0xbff,
    [
      ['<=', 0xb82, 'C'],
      ['=', 0xbc0, 'C'],
      ['=', 0xbcd, 'C'],
      ['else', 'N'],
    ],
  ],
  [
    'in',
    0xe00,
    0xe7f,
    [
      ['=', 0xe31, 'C'],
      ['in', 0xe34, 0xe3a, 'C'],
      ['in', 0xe47, 0xe4e, 'C'],
      ['else', 'N'],
    ],
  ],
  ['=', ZWJ, 'J'],
  ['=', VARIATION, 'V'],
  ['in', 0xf900, 0xfaff, 'W'],
  ['in', 0xff01, 0xff60, 'W'],
  ['in', 0xffe0, 0xffe6, 'W'],
  ['in', 0x20000, 0x3ffff, 'W'],
  ['in', 0x1f3fb, 0x1f3ff, 'S'],
];

// The class the first guard holding `cp` gives; undefined for none.
function guarded(guards, cp) {
  for (const guard of guards) {
    const [op, a, b] = guard;
    const holds =
      op === 'else' ||
      (op === '<=' && cp <= a) ||
      (op === '=' && cp === a) ||
      (op === 'in' && cp >= a && cp <= b);
    if (holds) {
      const then = guard.at(-1);
      return typeof then === 'string' ? then : guarded(then, cp);
    }
  }
  return undefined;
}

/**
 * The width class of `cp`: Narrow, Wide, Combining, Control, or the
 * joiner's (J), the emoji variation selector's (V) or a skin tone's (S).
 *
 * @param {number} cp
 */
const widthClass = (cp) => guarded(SHORTCUTS, cp) ?? rangeClass(cp);

// Bits of what an emoji's first code point takes after it.
const TAKES_VARIATION = 1;
const TAKES_SKIN_TONE = 2;

/**
 * Each base emoji's first code point, and the modifiers it takes: its
 * flags, or'd over every emoji it starts.
 *
 * @see Text.DocLayout.emojiMap
 */
const EMOJI = (() => {
  const map = new Map();
  for (const emoji of BASE_EMOJIS) {
    const [first, second] = [...emoji].map((c) => c.codePointAt(0));
    let takes = 0;
    if (second === 0xfe0e || second === VARIATION) takes = TAKES_VARIATION;
    else if (second !== undefined && isSkinTone(second)) {
      takes = TAKES_SKIN_TONE;
    }
    map.set(first, (map.get(first) ?? 0) | takes);
  }
  return map;
})();

/**
 * A width count in progress: whether no character is read yet, the width
 * so far, the last code point read, and the width its group may still take
 * back.
 *
 * @see Text.DocLayout.MatchState
 * @typedef {{first: boolean, total: number, last: number, tentative: number}} MatchState
 */

/**
 * `state` after `cp`: an emoji modifier rewrites the width of the group
 * before it, a joiner drops it for the next emoji's.
 *
 * @see Text.DocLayout.resolveWidth
 * @param {MatchState} state
 * @param {number} cp
 * @returns {MatchState}
 */
function step({ first, total, last, tentative }, cp) {
  const settled = total + tentative;
  const width = (w) => ({
    first: false,
    total: settled,
    last: cp,
    tentative: w,
  });
  const regroup = (t) => ({ first: false, total: t, last: cp, tentative: 2 });
  const emoji = EMOJI.get(last);
  switch (widthClass(cp)) {
    case 'N':
      return width(1);
    case 'W':
      return width(2);
    case 'C':
      return width(first ? 1 : 0);
    case 'J':
      return emoji !== undefined || last === VARIATION || isSkinTone(last)
        ? regroup(total - 2)
        : width(0);
    case 'V':
      return emoji & TAKES_VARIATION ? regroup(total) : width(0);
    case 'S':
      return emoji & TAKES_SKIN_TONE ? regroup(total) : width(2);
    default:
      return width(0);
  }
}

/**
 * The display width of `text`.
 *
 * @see Text.DocLayout.realLength
 * @param {string} text
 */
export function realLength(text) {
  let state = { first: true, total: 0, last: 0x20, tentative: 0 };
  for (const c of text) state = step(state, c.codePointAt(0));
  return state.total + state.tentative;
}

/**
 * The display width of the character `c`, read after another.
 *
 * @see Text.DocLayout.charWidth
 * @param {string} c
 */
export function charWidth(c) {
  const state = { first: false, total: 0, last: 0x20, tentative: 0 };
  const { total, tentative } = step(state, c.codePointAt(0));
  return total + tentative;
}
