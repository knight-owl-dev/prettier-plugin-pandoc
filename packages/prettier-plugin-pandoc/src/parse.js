// Parsing: Pandoc's read of the document, at the tab stop it is built with.

import {
  PandocParseError,
  positions,
  readMarkdown,
} from '@knight-owl-llc/pandoc-parser';

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
      const at = locOf(text);
      e.loc = { start: at(e.start), end: at(e.end) };
    }
    throw e;
  }
  // A spread leaves out what the read keeps from Pandoc's JSON.
  return { ...read, definitions: read.definitions, start: 0, end: text.length };
}

// Offsets in `text` as prettier locates them: line and column from 1, a
// column a UTF-16 unit, as its code frame counts them.
function locOf(text) {
  const at = positions(text);
  return (offset) => {
    const { line } = at.locate(offset);
    return { line, column: offset - at.lineStart(line) + 1 };
  };
}
