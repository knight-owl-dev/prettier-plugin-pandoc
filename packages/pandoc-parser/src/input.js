// The text Pandoc's reader parses, from the source its CLI is given, and the
// way back from offsets in that text to offsets in the source.
//
// Pandoc's CLI drops a byte order mark, deletes every carriage return, and
// expands each tab to spaces up to the next tab stop, counting columns in
// code points; then the markdown reader ensures the text ends in three
// newlines. So no parser sees a tab or a carriage return.

import { codePointLength } from './code-points.js';
import { SourceText } from './source-text.js';

const NEWLINES = 3;

/**
 * The text a Pandoc reader parses, and for each offset between its
 * characters the source offset between theirs: a tab's spaces all end where
 * the tab does, a deleted carriage return goes with what follows it, and the
 * newlines added at the end sit at the source's end. `input` is the text
 * with that map: a tab's spaces stand for the tab.
 *
 * @see Text.Pandoc.UTF8.toText
 * @see Text.Pandoc.Shared.tabFilter
 * @see Text.Pandoc.Sources.ensureFinalNewlines
 * @param {string} source
 * @param {number} tabStop
 * @param {number} [newlines] The newlines the text ends in at least.
 * @returns {{text: string, toSource: (offset: number) => number, input: SourceText}}
 */
export function readerInput(source, tabStop, newlines = NEWLINES) {
  if (!/[\t\r﻿]/.test(source)) {
    const text = withNewlines(source, newlines);
    const input = SourceText.concat([
      SourceText.slice(source, 0, source.length),
      SourceText.synth(text.slice(source.length), source.length, source.length),
    ]);
    return {
      text,
      toSource: (offset) => Math.min(offset, source.length),
      input,
    };
  }
  const parts = [];
  // bounds[o]: the source offset at text offset o.
  const bounds = [];
  // units[o]: the source text offset o stands for.
  const units = [];
  const emit = (unit, from, to) => {
    if (bounds.length === 0) bounds.push(from);
    parts.push(unit);
    bounds.push(to);
    units.push([from, to]);
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
  const text = withNewlines(read, newlines);
  for (let o = read.length; o < text.length; o++) bounds.push(source.length);
  return {
    text,
    toSource: (offset) => bounds[offset],
    input: inputOf(source, text, units),
  };
}

// `text` ending in `newlines` newlines; a line without one gets one, as
// Pandoc's tab filter writes every line.
function withNewlines(text, newlines) {
  let trailing = 0;
  while (trailing < text.length && text[text.length - 1 - trailing] === '\n') {
    trailing++;
  }
  return trailing >= newlines ? text : text + '\n'.repeat(newlines - trailing);
}

// `text` as a `SourceText` over `source`, from what each of its characters
// stands for: runs copied as copies, a tab's spaces each standing for the
// tab, the newlines added at the end for nothing at the source's end.
function inputOf(source, text, units) {
  const copies = (o) => {
    const [from, to] = units[o];
    return to - from === 1 && source[from] === text[o];
  };
  const parts = [];
  let run = 0;
  for (let o = 0; o <= units.length; o++) {
    const joins = o < units.length && copies(o);
    if (joins && (o === run || units[o][0] === units[o - 1][1])) continue;
    if (run < o) {
      parts.push(SourceText.slice(source, units[run][0], units[o - 1][1]));
    }
    run = o;
    if (joins) continue;
    if (o < units.length) {
      parts.push(SourceText.synth(text[o], units[o][0], units[o][1]));
    }
    run = o + 1;
  }
  const end = source.length;
  parts.push(SourceText.synth(text.slice(units.length), end, end));
  return SourceText.concat(parts);
}
