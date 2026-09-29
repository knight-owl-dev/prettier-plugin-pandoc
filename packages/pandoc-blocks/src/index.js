// Where Pandoc's markdown blocks begin and end, by Pandoc's block rules.
//
// A formatter, a linter and a language server all need the same answer to
// where a Pandoc block starts; this is the one place that answers it, and it
// imports no formatter.
//
// Pandoc parses block by block. A construct CommonMark lacks — a fenced div,
// say — is only recognized where a new block may start: a line a paragraph or
// list item could continue into is that paragraph's text, fence or not. After
// any block that ends on its own — a blank line, a heading, an HTML comment, a
// raw TeX environment, another fence — the next line starts a block.
//
// Offsets index the source string, so a caller can slice or mask the exact
// characters Pandoc reads as markup.

const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DIV_OPEN = /^:{3,}[ \t]*(\{[^}]*\}|[^\s:{}]+)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^:{3,}[ \t]*$/;
const BLANK = /^[ \t]*$/;

// Blocks that end on the line they start. Incomplete: Pandoc's list is every
// block that is not paragraph text, and each one missing here reads a fence
// after it as prose where Pandoc opens a div.
const SELF_ENDING = [
  /^ {0,3}#{1,6}(\s|$)/,
  /^<!--.*-->\s*$/,
  /^\\end\{[^}]+\}\s*$/,
];

function* lines(text) {
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    yield { start, end, text: text.slice(start, end) };
    if (newline === -1) return;
    start = newline + 1;
  }
}

function closesCode(line, marker) {
  const fence = CODE_FENCE.exec(line);
  return (
    fence !== null &&
    fence[1][0] === marker[0] &&
    fence[1].length >= marker.length &&
    BLANK.test(line.slice(fence[0].length))
  );
}

/**
 * Find every fenced div, in source order.
 *
 * A close needs no block start: Pandoc ends the paragraph a closing fence
 * interrupts. A div never closed runs to the end of the document, as Pandoc
 * reads it (with a warning), so its `close` is null.
 *
 * @param {string} text Pandoc markdown.
 * @returns {{
 *   type: 'div',
 *   open: {start: number, end: number},
 *   close: {start: number, end: number} | null,
 * }[]} Fence lines as offsets, newline excluded.
 */
export function blocks(text) {
  const divs = [];
  const open = [];
  let code = null;
  let blockStart = true;

  for (const line of lines(text)) {
    const span = { start: line.start, end: line.end };
    if (code !== null) {
      if (closesCode(line.text, code)) code = null;
      blockStart = code === null;
    } else if (CODE_FENCE.test(line.text)) {
      code = CODE_FENCE.exec(line.text)[1];
    } else if (open.length > 0 && DIV_CLOSE.test(line.text)) {
      divs.push({ type: 'div', open: open.pop(), close: span });
      blockStart = true;
    } else if (blockStart && DIV_OPEN.test(line.text)) {
      open.push(span);
    } else {
      blockStart =
        BLANK.test(line.text) || SELF_ENDING.some((r) => r.test(line.text));
    }
  }
  for (const span of open) divs.push({ type: 'div', open: span, close: null });
  return divs.sort((a, b) => a.open.start - b.open.start);
}
