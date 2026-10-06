// A diagnostic laid out as keystone's manual specifies, so the linter's
// messages read as the engine's own: the severity and the problem on the
// first line, then each callout under a two-space gutter, in the manual's
// order. Prose wraps at 80 columns, a column a code point; relayed text
// keeps its lines behind a quote bar; control characters show in caret
// notation.
//
// @see https://keystone.knight-owl.dev/engine/diagnostics/

const WIDTH = 80;
const GUTTER = '  ';
const QUOTE = '│ ';
const VALID = 'Valid: ';

// The callouts after the problem, in the order the manual gives them.
const ORDER = [
  'offenders',
  'verbatim',
  'because',
  'effect',
  'choices',
  'remedy',
  'see',
];

/**
 * The columns `s` takes: a code point each.
 *
 * @param {string} s
 */
export const columns = (s) => [...s].length;

/**
 * The words of `s` in lines of at most `width` columns, `first` opening
 * the first line and `rest` each after it; a word too wide for a line has
 * one to itself.
 *
 * @param {string} s
 * @param {number} width
 * @param {string} first
 * @param {string} rest
 * @returns {string[]}
 */
export function wrap(s, width, first, rest) {
  const lines = [];
  let line = '';
  let used = 0;
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const w = columns(word);
    if (line !== '' && used + 1 + w <= width) {
      line += ` ${word}`;
      used += 1 + w;
      continue;
    }
    if (line !== '') lines.push(line);
    const prefix = lines.length === 0 ? first : rest;
    line = prefix + word;
    used = columns(prefix) + w;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * `line` with each control character but the tab in caret notation.
 *
 * @param {string} line
 */
export const printable = (line) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters it shows
  line.replace(/[\0-\x08\x0a-\x1f\x7f]/g, (c) => {
    const code = c.charCodeAt(0);
    return code === 0x7f ? '^?' : `^${String.fromCharCode(code + 0x40)}`;
  });

const text = (value) => (Array.isArray(value) ? value.join(' ') : value);
const isEmpty = (value) =>
  value === undefined ||
  (Array.isArray(value) ? value.every((v) => v === '') : value === '');

// The lines callout `key` adds: offenders and relayed text line by line,
// the URL on its own, the rest wrapped.
function lines(key, value) {
  switch (key) {
    case 'offenders':
    case 'verbatim': {
      const bar = key === 'verbatim' ? QUOTE : '';
      return [value]
        .flat()
        .filter((item) => item !== '')
        .flatMap((item) => item.replace(/\n$/, '').split('\n'))
        .map((line) => `${GUTTER}${bar}${line}`);
    }
    case 'choices': {
      const values = [value].flat().filter((v) => v !== '');
      const under = GUTTER + ' '.repeat(VALID.length);
      return wrap(values.join(', '), WIDTH, GUTTER + VALID, under);
    }
    case 'see':
      return [`${GUTTER}See ${value}`];
    default:
      return wrap(text(value), WIDTH, GUTTER, GUTTER);
  }
}

/**
 * A diagnostic's lines: `lead` and `severity` before its problem, then its
 * callouts.
 *
 * @param {string} severity `ERROR`, `WARN` or `INFO`.
 * @param {Record<string, string | string[]>} callouts
 * @param {string} [lead] What goes first: its location.
 * @returns {string[]}
 */
export function frame(severity, callouts, lead = '') {
  const out = wrap(
    text(callouts.problem),
    WIDTH,
    `${lead}${severity}: `,
    GUTTER,
  );
  for (const key of ORDER) {
    if (!isEmpty(callouts[key])) out.push(...lines(key, callouts[key]));
  }
  return out.map(printable);
}
