// Fenced divs. The scan owns their nesting: an opening fence goes on its
// stack, and a closing one pops it wherever it falls, paragraph included —
// Pandoc ends the paragraph a closing fence interrupts.

/** @typedef {import('../types.js').Recognizer} Recognizer */

// Three colons or more, then a class or an attribute block, optionally closed
// by more colons.
const OPEN = /^:{3,}[ \t]*(\{[^}]*\}|[^\s:{}]+)[ \t]*:*[ \t]*$/;
export const DIV_CLOSE = /^:{3,}[ \t]*$/;

/** @type {Recognizer} */
export const divOpen = {
  name: 'div',
  interruptsParagraph: false,
  match(lines, at) {
    const line = lines[at];
    if (!OPEN.test(line.text)) return null;
    return {
      last: at,
      after: 'start',
      divOpen: { start: line.start, end: line.end },
    };
  },
};
