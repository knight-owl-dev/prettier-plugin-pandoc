// Parsing: Pandoc's read of the document, at the tab stop it is built with.

import { readMarkdown } from '@knight-owl-dev/pandoc-parser';

/**
 * The document as Pandoc reads it, spanning the whole text.
 *
 * @param {string} text
 * @param {{pandocTabStop: number}} options
 */
export function parse(text, options) {
  const read = readMarkdown(text, { tabStop: options.pandocTabStop });
  return { ...read, start: 0, end: text.length };
}
