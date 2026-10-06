// Parsing: Pandoc's read of the document, at the tab stop it is built with.

import { readMarkdown } from '@knight-owl-llc/pandoc-parser';

/**
 * The document as Pandoc reads it, spanning the whole text.
 *
 * @param {string} text
 * @param {{pandocTabStop: number}} options
 */
export function parse(text, options) {
  const read = readMarkdown(text, { tabStop: options.pandocTabStop });
  // A spread leaves out what the read keeps from Pandoc's JSON.
  return { ...read, definitions: read.definitions, start: 0, end: text.length };
}
