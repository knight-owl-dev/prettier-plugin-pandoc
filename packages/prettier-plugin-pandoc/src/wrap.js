// Where a line may break: nowhere the line after would end the paragraph to
// Pandoc — `--` a setext underline, a fence a code block, `: text` a
// definition. The recognizer judges; this finds what the lines would hold.

import {
  DEFAULT_TAB_STOP,
  interruptsParagraph,
} from '@knight-owl-dev/pandoc-syntax';
import { CONTAINERS, isInlineRaw } from './nodes.js';
import { lineEnd } from './text.js';

// The source from `offset` on as Pandoc reads it there: in a container, the
// rest of its content without the prefixes, since Pandoc reads a container as
// a document of its own.
function sourceFrom(root, text, offset) {
  const holder = root[CONTAINERS].findLast(
    (c) => c.start <= offset && offset < c.end,
  );
  if (holder === undefined) return text.slice(offset);
  return holder.lines
    .filter((line) => line.end >= offset)
    .map((line) => text.slice(Math.max(line.start, offset), line.end))
    .join('\n');
}

// The words of the sentence a whitespace node sits in, before it or after it.
function words(path, side) {
  const { children } = path.parent;
  const at = children.indexOf(path.node);
  const part =
    side === 'before' ? children.slice(0, at) : children.slice(at + 1);
  return part.map((node) => (node.type === 'whitespace' ? ' ' : node.value));
}

/**
 * What a line broken at this whitespace would start with — the next word, or
 * the inline node after the sentence it ends — and the text around it. A line
 * after the break may hold the next word alone or with the rest of the
 * sentence, so both are candidates. A word carries no offset, so what follows
 * is read from its paragraph on: a close before the break only keeps the line
 * whole, and a word that could open an environment is one never ended, since
 * an ended one is raw TeX with an offset of its own.
 */
function around(path, options) {
  const text = options.originalText;
  const before = words(path, 'before').join('');
  if (path.next) {
    const paragraph = path.findAncestor((node) => node.type === 'paragraph');
    const from = paragraph?.position.start.offset ?? text.length;
    const word = path.next.value ?? '';
    return {
      lines: [word, words(path, 'after').join('')],
      before,
      after: () => sourceFrom(path.root, text, from),
    };
  }
  const [sentence, holder] = [path.parent, path.grandparent];
  const next = holder?.children?.[holder.children.indexOf(sentence) + 1];
  if (next?.position === undefined) return { lines: [], before, after: '' };
  const start = next.position.start.offset;
  const end = lineEnd(text, start);
  return {
    lines: [text.slice(start, end)],
    before,
    after: () => sourceFrom(path.root, text, end + 1),
  };
}

// Prettier's containers, whose content Pandoc reads as a document of its own.
const CONTAINER_NODES = new Set([
  'blockquote',
  'listItem',
  'footnoteDefinition',
]);

/**
 * Whether a line must not break at the whitespace `path` points to. In a list
 * item's own content a list may open straight after a line of text.
 *
 * @param {object} path
 * @param {object} options
 * @returns {boolean}
 */
export function breaksParagraph(path, options) {
  const { lines, before, after } = around(path, options);
  const tabStop = options.pandocTabStop ?? DEFAULT_TAB_STOP;
  const holder = path.findAncestor((node) => CONTAINER_NODES.has(node.type));
  const inItem = holder?.type === 'listItem';
  return lines
    .filter((line) => line !== '')
    .some((line) =>
      interruptsParagraph(line, { tabStop, before, after, inItem }),
    );
}

// The last of the commands an inline span holds, when it takes no arguments.
const ENDS_BARE = /\\[A-Za-z]+\*?[ \t]*$/;

/**
 * Whether the line break at the whitespace `path` points to must stay: after a
 * command with no arguments, Pandoc ends the raw text at a break, but takes
 * the spaces that would replace it.
 *
 * @param {object} path
 * @returns {boolean}
 */
export function keepsBreak(path) {
  if (path.node.value !== '\n' || path.parent.children[0] !== path.node) {
    return false;
  }
  const siblings = path.grandparent?.children ?? [];
  const before = siblings[siblings.indexOf(path.parent) - 1];
  return (
    before !== undefined && isInlineRaw(before) && ENDS_BARE.test(before.value)
  );
}
