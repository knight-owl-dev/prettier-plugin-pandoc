// Many files as Pandoc's CLI reads them: one text, each file in turn, and
// the way back from an offset in it to the file and the offset there.
//
// Pandoc reads its inputs as one document: each file, a byte order mark
// dropped, ending in a newline, one added where it has none (an empty file
// adds nothing), then a newline more. So a definition in one file serves
// the others, and a fence or div left open runs on into the next.
//
// Not followed: Pandoc keeps each file's positions apart, and raw TeX's
// extent compares them. A TeX environment running from one file into the
// next, its positions drifted (`latex/parsing.js` tokenize), can end
// elsewhere than in the joined text.

/**
 * The text of `files` joined as Pandoc joins them, and where an offset in
 * it is: its file's path, and the offset there. An offset in what the join
 * added is at the end of the file before it.
 *
 * @see Text.Pandoc.Sources.toSources
 * @param {{path: string, text: string}[]} files
 * @returns {{text: string, locate: (offset: number) => {path: string, offset: number}}}
 */
export function toSources(files) {
  const pieces = [];
  let text = '';
  for (const { path, text: source } of files) {
    const skip = source.startsWith('﻿') ? 1 : 0;
    const body = source.slice(skip);
    const ended = body === '' || body.replaceAll('\r', '').endsWith('\n');
    pieces.push({ at: text.length, path, skip, length: body.length });
    text += `${body}${ended ? '' : '\n'}\n`;
  }
  const locate = (offset) => {
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pieces[mid].at <= offset) lo = mid;
      else hi = mid - 1;
    }
    const { at, path, skip, length } = pieces[lo];
    return { path, offset: skip + Math.min(offset - at, length) };
  };
  return { text, locate };
}
