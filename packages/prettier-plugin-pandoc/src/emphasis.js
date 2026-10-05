// Emphasis and strong in prettier's markers, as edits on the text a
// paragraph is printed from: emphasis `_`, or `*` next to a word character
// or inside other emphasis; strong `**`.
//
// @see prettier's src/language-markdown/printer-markdown.js ("emphasis")

/** @typedef {import('./wrap.js').View} View */

/**
 * @typedef {object} Edit
 * @property {number} from
 * @property {number} to
 * @property {string} text
 */

const WORD = /[\p{L}\p{N}]/u;
const MARKS = { Emph: ['*', '_'], Strong: ['**', '__'] };

// A node's children: an Emph's or Strong's inlines.
const childrenOf = (node) => (Array.isArray(node.c) ? node.c : []);

/**
 * The edits that give each Emph and Strong under `nodes` prettier's
 * markers, in `view`'s offsets. A node whose markers touch another's, as
 * in `***x***`, keeps its own: which run Pandoc splits where decides what
 * it reads.
 *
 * @param {unknown[]} nodes
 * @param {View} view
 * @param {boolean} [inEmph]
 * @param {Edit[]} [out]
 * @returns {Edit[]}
 */
export function markerEdits(nodes, view, inEmph = false, out = []) {
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      markerEdits(node, view, inEmph, out);
      continue;
    }
    const marks = MARKS[node.t];
    if (marks === undefined) {
      if (node.c !== undefined) markerEdits([node.c], view, inEmph, out);
      continue;
    }
    const kids = childrenOf(node);
    const edit = kids.length > 0 && editsFor(node, kids, view, inEmph);
    if (edit) out.push(...edit);
    markerEdits(kids, view, inEmph || node.t === 'Emph', out);
  }
  return out;
}

// The opener's and closer's edits for one node, or null where it keeps its
// markers.
function editsFor(node, kids, view, inEmph) {
  const { text } = view;
  const start = view.start(node.start);
  const end = view.end(node.end);
  const inner = [view.start(kids[0].start), view.end(kids.at(-1).end)];
  if (!(start < inner[0] && inner[0] <= inner[1] && inner[1] < end)) {
    return null;
  }
  const opener = text.slice(start, inner[0]);
  const closer = text.slice(inner[1], end);
  if (opener !== closer || !MARKS[node.t].includes(opener)) return null;
  // Markers touching another node's run: `***x***`.
  const marker = opener[0];
  if (text[start - 1] === marker || text[end] === marker) return null;
  if (text[inner[0]] === marker || text[inner[1] - 1] === marker) return null;
  const nextToWord =
    WORD.test(text[start - 1] ?? '') || WORD.test(text[end] ?? '');
  const wanted = node.t === 'Strong' ? '**' : inEmph || nextToWord ? '*' : '_';
  if (wanted === opener) return null;
  return [
    { from: start, to: inner[0], text: wanted },
    { from: inner[1], to: end, text: wanted },
  ];
}

/**
 * `text` from `from` to `to` with the edits inside that span applied.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {Edit[]} edits In order.
 */
export function edited(text, from, to, edits) {
  let out = '';
  let at = from;
  for (const edit of edits) {
    if (edit.from < from || edit.to > to) continue;
    out += text.slice(at, edit.from) + edit.text;
    at = edit.to;
  }
  return out + text.slice(at, to);
}
