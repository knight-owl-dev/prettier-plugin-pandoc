// Parsing: Pandoc's read of the document, at the tab stop it is built with.

import { PandocParseError, readMarkdown } from '@knight-owl-llc/pandoc-parser';

/**
 * The document as Pandoc reads it, spanning the whole text. Where Pandoc
 * fails to read it, the error carries prettier's `loc`, which prettier
 * frames.
 *
 * @param {string} text
 * @param {{pandocTabStop: number}} options
 */
export function parse(text, options) {
  let read;
  try {
    read = readMarkdown(text, { tabStop: options.pandocTabStop });
  } catch (e) {
    if (e instanceof PandocParseError) {
      e.loc = { start: locOf(text, e.start), end: locOf(text, e.end) };
    }
    throw e;
  }
  // A spread leaves out what the read keeps from Pandoc's JSON.
  return { ...read, definitions: read.definitions, start: 0, end: text.length };
}

// An offset as prettier locates one: line and column from 1, a column a
// UTF-16 unit, as its code frame counts them.
function locOf(text, offset) {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    line: before.split('\n').length,
    column: offset - lineStart + 1,
  };
}
