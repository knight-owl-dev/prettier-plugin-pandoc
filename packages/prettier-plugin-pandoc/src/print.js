// Printing: each top-level block (blocks.js), one blank line between them.
// Source between blocks that is no node — reference and note definitions,
// metadata — prints as written, its blank lines at either end dropped.

import { doc } from 'prettier';
import { columnAfter, extent, printBlock, sourceView } from './blocks.js';
import { heldBlocks } from './check.js';
import { languageOf, parserFor } from './code.js';

const { literalline } = doc.builders;
const { printDocToString } = doc.printer;
const { replaceEndOfLine } = doc.utils;

const isBlank = (line) => /^[ \t]*$/.test(line);

/**
 * The source between two blocks, spaced: `first` before the first block,
 * `last` after the last. On the line a block ends, only what follows it
 * stays; on the line one starts, what precedes it, but for indentation
 * short of a tab stop, which Pandoc reads no differently.
 *
 * @param {string} gap
 * @param {boolean} first
 * @param {boolean} last
 * @param {number} tabStop
 */
function spaced(gap, first, last, tabStop) {
  // Blocks on one line stay on it.
  if (!first && !last && !gap.includes('\n')) return gap;
  const lines = gap.split('\n');
  const head = first ? '' : lines.shift();
  const indent = last ? '' : lines.pop();
  const tail = /^ *$/.test(indent) && indent.length < tabStop ? '' : indent;
  while (lines.length > 0 && isBlank(lines[0])) lines.shift();
  while (lines.length > 0 && isBlank(lines.at(-1))) lines.pop();
  const body = lines.join('\n');
  if (first)
    return (body === '' ? '' : `${body}${last ? '\n' : '\n\n'}`) + tail;
  const ended = `${isBlank(head) ? '' : head}\n`;
  if (last) return body === '' ? ended : `${ended}\n${body}\n`;
  return body === '' ? `${ended}\n${tail}` : `${ended}\n${body}\n\n${tail}`;
}

/**
 * The document printed, a held block and the gaps next to it as written.
 *
 * @param {{t: string, start: number, end: number}[]} blocks
 * @param {string} text
 * @param {Set<number>} held
 * @param {object} options
 */
function render(blocks, text, held, options) {
  const view = sourceView(text);
  const context = {
    width: options.printWidth,
    column: 0,
    inListItem: false,
    divLevel: 0,
  };
  const ends = blocks.map((block) => extent(block, view)[1]);
  let out = '';
  for (let k = 0; k <= blocks.length; k++) {
    const from = k === 0 ? 0 : ends[k - 1];
    const to = k === blocks.length ? text.length : blocks[k].start;
    const gap = text.slice(from, to);
    out +=
      held.has(k - 1) || held.has(k)
        ? gap
        : spaced(gap, k === 0, k === blocks.length, options.pandocTabStop);
    if (k === blocks.length) break;
    out += held.has(k)
      ? text.slice(blocks[k].start, ends[k])
      : printBlock(
          blocks[k],
          view,
          { ...context, column: columnAfter(out) },
          options,
        );
  }
  return out;
}

// Spans Pandoc's order of blocks follows, each after the last.
const inOrder = (blocks) =>
  blocks.every(
    (b, k) =>
      Number.isInteger(b.start) &&
      Number.isInteger(b.end) &&
      b.start <= b.end &&
      (k === 0 || blocks[k - 1].end <= b.start),
  );

/**
 * The document printed, `samples` standing for the code it formatted.
 *
 * @param {{blocks: object[]}} root
 * @param {{originalText: string, pandocTabStop: number}} options
 * @param {Map<object, string>} samples
 */
function printRoot(root, options, samples) {
  const text = options.originalText;
  const withSamples = { ...options, pandocSamples: samples };
  const out = inOrder(root.blocks)
    ? heldBlocks(root, withSamples, (held) =>
        render(root.blocks, text, held, withSamples),
      )
    : text;
  return replaceEndOfLine(out, literalline);
}

/**
 * @param {import('prettier').AstPath} path
 * @param {{originalText: string, pandocTabStop: number}} options
 */
export function print(path, options) {
  return printRoot(path.node, options, new Map());
}

// Each code block under `value` in a language prettier formats, with its
// parser.
function samplesIn(value, options, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) samplesIn(v, options, out);
  } else if (value !== null && typeof value === 'object') {
    const parser =
      value.t === 'CodeBlock' && parserFor(languageOf(value), options);
    if (parser) out.push({ block: value, parser });
    else for (const v of Object.values(value)) samplesIn(v, options, out);
  }
  return out;
}

/**
 * The document printed with each sample in a language prettier formats
 * formatted. Prettier calls this for the root alone, as the printer's
 * visitor keys stop there, and not at all with `embeddedLanguageFormatting`
 * off, when `print` prints every sample as written.
 *
 * @param {import('prettier').AstPath} path
 * @param {object} options
 */
export function embed(path, options) {
  const samples = samplesIn(path.node.blocks, options);
  if (samples.length === 0) return null;
  return async (textToDoc) => {
    const formatted = new Map();
    for (const { block, parser } of samples) {
      try {
        const sample = await textToDoc(block.c[1], { parser });
        const { formatted: code } = printDocToString(sample, options);
        formatted.set(block, code.replace(/\n+$/, ''));
      } catch {
        // Code its parser cannot read stays as written.
      }
    }
    return printRoot(path.node, options, formatted);
  };
}
