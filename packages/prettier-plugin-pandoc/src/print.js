// Printing: each top-level block (blocks.js), one blank line between them.
// Source between blocks that is no node — reference and note definitions,
// metadata — prints as written, its blank lines at either end dropped.

import { doc } from 'prettier';
import {
  columnAfter,
  extent,
  ignoredOf,
  printBlock,
  sourceView,
} from './blocks.js';
import { heldBlocks } from './check.js';
import { languageOf, parserFor } from './code.js';
import { definitionsOf, printDefinition } from './notes.js';

const { literalline } = doc.builders;
const { printDocToString } = doc.printer;
const { replaceEndOfLine } = doc.utils;

const isBlank = (line) => /^[ \t]*$/.test(line);

/**
 * The source between two blocks, spaced: `first` before the first block,
 * `last` after the last. On the line a block ends, only what follows it
 * stays; on the line one starts, what precedes it, but for indentation
 * short of a tab stop, which Pandoc reads no differently. After `tight`
 * text, a paragraph a block interrupts, no blank line: one would make it
 * a paragraph of its own.
 *
 * @param {string} gap
 * @param {boolean} first
 * @param {boolean} last
 * @param {number} tabStop
 * @param {boolean} [tight]
 */
function spaced(gap, first, last, tabStop, tight = false) {
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
  if (body === '') return tight ? `${ended}${tail}` : `${ended}\n${tail}`;
  return `${ended}\n${body}\n\n${tail}`;
}

/**
 * Whether the gap after `block` keeps from a blank line: after a paragraph
 * a block interrupts, which one would make a paragraph of its own, and
 * before a line indented a tab stop, which one would make code.
 *
 * @param {{t: string} | undefined} block
 * @param {string} gap
 * @param {number} tabStop
 */
function tightBefore(block, gap, tabStop) {
  if (block === undefined || /\n[ \t]*\n/.test(gap)) return false;
  const indent = /(?:^|\n)( *)$/.exec(gap)[1];
  return block.t === 'Plain' || indent.length >= tabStop;
}

/**
 * The source from `from` to `to`, each note definition inside printed.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {import('./notes.js').Definition[]} definitions
 * @param {import('./wrap.js').Context} context
 * @param {object} options
 */
function withDefinitions(text, from, to, definitions, context, options) {
  let out = '';
  let at = from;
  for (const definition of definitions) {
    if (definition.start < at || definition.end > to) continue;
    const printed = printDefinition(definition, context, options);
    if (printed === null) continue;
    out += text.slice(at, definition.start) + printed;
    at = definition.end;
  }
  return out + text.slice(at, to);
}

/**
 * The document printed, a held block and the gaps next to it as written.
 *
 * @param {{t: string, start: number, end: number}[]} blocks
 * @param {string} text
 * @param {Set<number>} held
 * @param {object} options
 */
function render(blocks, text, held, options, definitions = []) {
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
    // Where the self-check holds a block, definitions print as written.
    const gap =
      held.size > 0
        ? text.slice(from, to)
        : withDefinitions(text, from, to, definitions, context, options);
    out +=
      held.has(k - 1) || held.has(k)
        ? gap
        : spaced(
            gap,
            k === 0,
            k === blocks.length,
            options.pandocTabStop,
            tightBefore(blocks[k - 1], gap, options.pandocTabStop),
          );
    if (k === blocks.length) break;
    const fresh = out === '' || /\n[ \t]*\n[ \t]*$/.test(out);
    out += held.has(k)
      ? text.slice(blocks[k].start, ends[k])
      : printBlock(
          blocks[k],
          view,
          { ...context, column: columnAfter(out), fresh },
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
  // Blocks prettier-ignore leaves as written, the text around them too.
  const ignored = ignoredOf(root.blocks);
  const definitions = definitionsOf(root.blocks, text);
  const out = inOrder(root.blocks)
    ? heldBlocks(root, withSamples, (held) =>
        render(
          root.blocks,
          text,
          new Set([...held, ...ignored]),
          withSamples,
          definitions,
        ),
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
