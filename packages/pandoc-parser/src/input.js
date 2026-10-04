// The text Pandoc's reader parses, from the source its CLI is given, and the
// way back from offsets in that text to offsets in the source.
//
// Pandoc's CLI drops a byte order mark, deletes every carriage return, and
// expands each tab to spaces up to the next tab stop, counting columns in
// code points; then the reader ensures the text ends in three newlines. So
// no parser sees a tab or a carriage return.

import { codePointLength } from './code-points.js';

const NEWLINES = 3;

/**
 * The text Pandoc's markdown reader parses, and for each offset between its
 * characters the source offset between theirs: a tab's spaces all end where
 * the tab does, a deleted carriage return goes with what follows it, and the
 * newlines added at the end sit at the source's end.
 *
 * @see Text.Pandoc.UTF8.toText
 * @see Text.Pandoc.Shared.tabFilter
 * @see Text.Pandoc.Sources.ensureFinalNewlines
 * @param {string} source
 * @param {number} tabStop
 * @returns {{text: string, toSource: (offset: number) => number}}
 */
export function readerInput(source, tabStop) {
  if (!/[\t\r﻿]/.test(source)) {
    const text = withNewlines(source);
    return { text, toSource: (offset) => Math.min(offset, source.length) };
  }
  const parts = [];
  // bounds[o]: the source offset at text offset o.
  const bounds = [];
  const emit = (unit, from, to) => {
    if (bounds.length === 0) bounds.push(from);
    parts.push(unit);
    bounds.push(to);
  };
  let column = 0;
  for (let i = source.charCodeAt(0) === 0xfeff ? 1 : 0; i < source.length; ) {
    const c = source[i];
    if (c === '\r') {
      i++;
    } else if (c === '\t') {
      const width = tabStop - (column % tabStop);
      for (let k = 0; k < width; k++) emit(' ', i, i + 1);
      column += width;
      i++;
    } else {
      const length = codePointLength(source, i);
      for (let k = 0; k < length; k++) emit(source[i + k], i + k, i + k + 1);
      column = c === '\n' ? 0 : column + 1;
      i += length;
    }
  }
  if (bounds.length === 0) bounds.push(source.length);
  const read = parts.join('');
  const text = withNewlines(read);
  for (let o = read.length; o < text.length; o++) bounds.push(source.length);
  return { text, toSource: (offset) => bounds[offset] };
}

// `text` ending in `NEWLINES` newlines; a line without one gets one, as
// Pandoc's tab filter writes every line.
function withNewlines(text) {
  let trailing = 0;
  while (trailing < text.length && text[text.length - 1 - trailing] === '\n') {
    trailing++;
  }
  return trailing >= NEWLINES ? text : text + '\n'.repeat(NEWLINES - trailing);
}
