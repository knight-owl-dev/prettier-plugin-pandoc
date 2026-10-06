// Fenced code: a fence long enough for its content, and a sample in a
// language prettier formats reformatted (`embed` in print.js).

import { extent } from './blocks.js';

/** @typedef {import('./wrap.js').View} View */

const OPENING = /^( *)(`{3,}|~{3,})(.*)$/;

// The longest run of `char` in `text`.
const longestRun = (text, char) =>
  Math.max(
    0,
    ...(text.match(new RegExp(`\\${char}+`, 'g')) ?? []).map(
      (run) => run.length,
    ),
  );

/**
 * A code block's language: its first class, as a fence's info string or
 * attributes give it.
 *
 * @param {{c: unknown[]}} block
 * @returns {string | undefined}
 */
export const languageOf = (block) => block.c[0][1][0];

/**
 * The parser prettier formats a language with, as prettier's markdown
 * printer infers it for a sample: by name, alias or extension.
 *
 * @see prettier's src/main/infer-parser.js
 * @param {string | undefined} language
 * @param {{plugins: {languages?: object[]}[]}} options
 * @returns {string | undefined}
 */
export function parserFor(language, options) {
  if (language === undefined) return undefined;
  const name = language.toLowerCase();
  const languages = options.plugins
    .toReversed()
    .flatMap((plugin) => plugin.languages ?? []);
  const found =
    languages.find((l) => l.name.toLowerCase() === name) ??
    languages.find((l) => l.aliases?.includes(name)) ??
    languages.find((l) => l.extensions?.includes(`.${name}`));
  return found?.parsers[0];
}

/**
 * Fenced code: the fence's character and info string as written, the fence
 * one longer than any run of its character in the content; the content as
 * written, or as `options.pandocSamples` formatted it; an indented fence at
 * its container's edge, each line without the spaces Pandoc strips. An
 * unclosed fence prints as written.
 *
 * @param {{t: string, c: unknown[], start: number, end: number}} block
 * @param {View} view
 * @param {object} _context
 * @param {{pandocSamples?: Map<object, string>}} options
 * @returns {string | null}
 */
export function printCode(block, view, _context, options) {
  const [start, end] = extent(block, view);
  const lines = view.text.slice(start, end).split('\n');
  const opening = OPENING.exec(lines[0]);
  if (opening === null || lines.length < 2) return null;
  const [, indent, fence, info] = opening;
  const char = fence[0];
  const closing = new RegExp(`^ *\\${char}{${fence.length},}[ \\t]*$`);
  if (!closing.test(lines.at(-1))) return null;
  // Pandoc strips up to the fence's indent from each line; a tab there
  // strips by its own width.
  const content = lines.slice(1, -1);
  const lead = (line) => /^ */.exec(line)[0].length;
  if (
    content.some((line) => lead(line) < indent.length && /^ *\t/.test(line))
  ) {
    return null;
  }
  const code =
    options.pandocSamples?.get(block) ??
    content
      .map((line) => line.slice(Math.min(lead(line), indent.length)))
      .join('\n');
  const longer = char.repeat(Math.max(3, longestRun(code, char) + 1));
  const body = code === '' ? [] : [code];
  return [`${longer}${info.trimEnd()}`, ...body, longer].join('\n');
}
