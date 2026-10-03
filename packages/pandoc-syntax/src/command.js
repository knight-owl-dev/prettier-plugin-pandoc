// Inline raw TeX: a command and its arguments, or an environment.
//
// Pandoc's LaTeX reader knows each command's arity, which a scan cannot, so a
// span here may run wider than the raw text Pandoc keeps — `\emph[o]{x}` is
// raw only as far as `\emph[`. It never runs narrower.
//
// An environment runs from its `\begin` to the matching `\end`, blank lines
// and all. In paragraph text it is a raw block, `blocks/raw-tex.js`; one read
// here sits where it is none, as in brackets.

import { breaksParagraph } from './lines.js';
import { BEGIN, environmentEnd } from './tex.js';

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

// The offset just past the group opening at `at`, or null when it never
// closes: a paragraph break ends the group with the paragraph. A backslash
// escapes the character after it.
function groupEnd(text, at) {
  const [open, close] = [text[at], CLOSES[text[at]]];
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
    else if (char === '\n' && breaksParagraph(text, i)) return null;
  }
  return null;
}

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

/**
 * Where the command starting at `at` ends, or null when Pandoc keeps none of
 * it raw: an environment never ended, an `\end` without its `\begin`, or a
 * brace never closed.
 *
 * The first argument may sit after spaces, or one line down; the rest follow
 * it directly. With no argument, the command takes the spaces after it.
 *
 * @param {string} text
 * @param {number} at
 * @returns {number | null}
 */
export function commandEnd(text, at) {
  let i = at + 1;
  while (i < text.length && LETTER.test(text[i])) i++;
  const name = text.slice(at + 1, i);
  if (name === 'begin') return environmentAt(text, at);
  if (name === 'end') return null;
  if (text[i] === '*') i++;

  let args = 0;
  for (;;) {
    const open = args === 0 ? pastGap(text, i) : i;
    if (CLOSES[text[open]] === undefined) break;
    const end = groupEnd(text, open);
    // An unclosed option leaves the command without it; an unclosed brace
    // leaves the whole command as text.
    if (end === null) return text[open] === '{' ? null : i;
    i = end;
    args++;
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
 * @param {number} count
 * @returns {{start: number, end: number}[]}
 */
export function groupsAfter(text, at, count) {
  const groups = [];
  let i = at;
  while (groups.length < count) {
    const open = groups.length === 0 ? pastGap(text, i) : i;
    if (CLOSES[text[open]] === undefined) break;
    const end = groupEnd(text, open);
    if (end === null) break;
    if (text[open] === '{') groups.push({ start: open, end });
    i = end;
  }
  return groups;
}
