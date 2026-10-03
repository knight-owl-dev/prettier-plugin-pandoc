// Inline raw TeX: a command and its arguments, or an environment.
//
// Pandoc's LaTeX reader knows each command's arity, which a scan cannot, so a
// span here may run wider than the raw text Pandoc keeps — `\emph[o]{x}` is
// raw only as far as `\emph[`. It never runs narrower.
//
// An environment runs from its `\begin` to the matching `\end`, blank lines
// and all. In paragraph text it is a raw block, `blocks/raw-tex.js`; one read
// here sits where it is none, as in brackets.

import { closeOf, paragraphEnd, splitLines } from './lines.js';
import { BEGIN, environmentEnd } from './tex.js';
import { verbatimEnd } from './tex-arguments.js';
import {
  ALSO_INLINE,
  BLOCK_COMMANDS,
  DEFINITIONS,
  INLINE_COMMANDS,
  RAW_INLINE,
} from './tex-names.js';

const LETTER = /[A-Za-z]/;
const SPACE = /[ \t]/;

// The groups an argument comes in, by the character that opens each.
const CLOSES = { '{': '}', '[': ']' };

/**
 * Whether a command starts at `at`: a backslash before a letter.
 *
 * @param {string} text
 * @param {number} at
 */
export const startsCommand = (text, at) =>
  text[at] === '\\' && LETTER.test(text[at + 1] ?? '');

// Commands Pandoc reads by a rule of their own, never as raw inline TeX.
const NOT_RAW = new Set(
  [...BLOCK_COMMANDS, ...DEFINITIONS].filter((name) => !ALSO_INLINE.has(name)),
);

// Whether Pandoc reads the braced group opening at `at` raw, past blank
// lines: any of a command it treats as unknown, and `\vadjust`'s first. Never
// one a line down from `from`, which such a command does not take. A known
// command's raw argument stops at the blank line: Pandoc may fail the command
// whole.
function readsRaw(text, from, at, name, n) {
  if (text[at] !== '{' || text.lastIndexOf('\n', at) >= from) return false;
  if (NOT_RAW.has(name)) return false;
  if (!INLINE_COMMANDS.has(name) || RAW_INLINE.has(name)) return true;
  return name === 'vadjust' && n === 0;
}

// The offset just past the group opening at `at`, or null when it never
// closes: a paragraph break ends one Pandoc reads as inlines. A backslash
// escapes the character after it.
function groupEnd(text, at, raw) {
  return closeOf(text, at, text[at], CLOSES[text[at]], escaped, true, raw);
}

// Past the character at `at`, and the one after a backslash.
const escaped = (text, at) => at + (text[at] === '\\' ? 2 : 1);

// Past the spaces from `at` on, and at most one newline among them: how far
// the first argument may sit from its command.
function pastGap(text, at) {
  let i = at;
  while (SPACE.test(text[i] ?? '')) i++;
  if (text[i] === '\n') i++;
  while (SPACE.test(text[i] ?? '')) i++;
  return i;
}

const OPENS_ENVIRONMENT = new RegExp(`^${BEGIN}`);

// The offset just past the environment beginning at `at`, or null.
function environmentAt(text, at) {
  const rest = text.slice(at);
  const name = OPENS_ENVIRONMENT.exec(rest)?.[1];
  if (name === undefined) return null;
  return environmentEnd(name, [{ text: rest, start: at }])?.end ?? null;
}

// Commands whose body Pandoc reads verbatim, between a delimiter and the
// same delimiter again.
const DELIMITED = new Set(['verb', 'Verb', 'lstinline', 'mintinline']);

/**
 * Past the verbatim command at `at` and its body, or null where none is: the
 * paragraph from the command's line on, read as Pandoc reads it.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number | null}
 */
export function verbatimCommandEnd(text, at) {
  let i = at + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  const name = text.slice(at + 1, i);
  if (!DELIMITED.has(name)) return null;
  const start = text.lastIndexOf('\n', at) + 1;
  const lines = splitLines(text.slice(start, paragraphEnd(text, at)));
  const end = verbatimEnd(lines, name, { k: 0, i: i - start });
  return end === null ? null : start + lines[end.k].start + end.i;
}

/**
 * Where the command starting at `at` ends, or null when Pandoc keeps none of
 * it raw: an environment never ended, an `\end` without its `\begin`, or a
 * brace never closed.
 *
 * The first argument may sit after spaces, or one line down; the rest follow
 * it directly. With no argument, the command takes the spaces after it. A
 * group closing past `to` never closes.
 *
 * @param {string} text
 * @param {number} at
 * @param {number} [to]
 * @returns {number | null}
 */
export function commandEnd(text, at, to = text.length) {
  let i = at + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  const name = text.slice(at + 1, i);
  if (name === 'begin') return environmentAt(text, at);
  if (name === 'end') return null;
  // One without a body is read as any other command.
  const verbatim = verbatimCommandEnd(text, at);
  if (verbatim !== null) return verbatim;
  if (text[i] === '*') i++;

  let [args, groups] = [0, 0];
  for (;;) {
    const open = args === 0 ? pastGap(text, i) : i;
    if (CLOSES[text[open]] === undefined) break;
    const close = groupEnd(text, open, readsRaw(text, i, open, name, groups));
    const end = close !== null && close <= to ? close : null;
    // An unclosed option leaves the command without it; an unclosed brace
    // leaves the whole command as text.
    if (end === null) return text[open] === '{' ? null : i;
    i = end;
    args++;
    if (text[open] === '{') groups++;
  }
  if (args === 0) while (SPACE.test(text[i] ?? '')) i++;
  return i;
}

/**
 * The groups after a command name ending at `at`, up to `count`: options
 * before each passed over, the first after spaces or one line down, the rest
 * straight after. Fewer where the groups stop.
 *
 * @param {string} text
 * @param {number} at
 * @param {string} name The command's.
 * @param {number} count
 * @returns {{start: number, end: number}[]}
 */
export function groupsAfter(text, at, name, count) {
  const groups = [];
  let i = at;
  while (groups.length < count) {
    const open = groups.length === 0 ? pastGap(text, i) : i;
    if (CLOSES[text[open]] === undefined) break;
    const raw = readsRaw(text, i, open, name, groups.length);
    const end = groupEnd(text, open, raw);
    if (end === null) break;
    if (text[open] === '{') groups.push({ start: open, end });
    i = end;
  }
  return groups;
}
