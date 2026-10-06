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
 * @typedef {object} Run
 * @property {[number, number, number, number]} at The opener's start, the
 *   contents' start and end, and the closer's end.
 * @property {string} written
 * @property {string} wanted
 */

/**
 * The edits that give each Emph and Strong under `nodes` prettier's
 * markers, in `view`'s offsets. A run keeps its own where prettier's would
 * touch a marker of the same character, which Pandoc may split elsewhere:
 * `***x***` prints as `**_x_**`, and `_a ***x*** b_`, whose inner emphasis
 * takes `*`, as written.
 *
 * @param {unknown[]} nodes
 * @param {View} view
 * @returns {Edit[]}
 */
export function markerEdits(nodes, view) {
  /** @type {Run[]} */
  const runs = [];
  collect(nodes, view, false, runs);
  // A run kept as written changes what its neighbors touch: repeat until a
  // pass keeps none.
  let kept = true;
  while (kept) {
    kept = false;
    const printed = new Map();
    for (const { at, wanted } of runs) {
      for (let i = 0; i < wanted.length; i++) {
        printed.set(at[0] + i, wanted[i]).set(at[2] + i, wanted[i]);
      }
    }
    const charAt = (i) => printed.get(i) ?? view.text[i];
    for (const run of runs) {
      if (run.wanted === run.written) continue;
      const [from, open, close, to] = run.at;
      const mark = run.wanted[0];
      if ([from - 1, open, close - 1, to].some((i) => charAt(i) === mark)) {
        run.wanted = run.written;
        kept = true;
      }
    }
  }
  return runs
    .filter((run) => run.wanted !== run.written)
    .flatMap(({ at: [from, open, close, to], wanted }) => [
      { from, to: open, text: wanted },
      { from: close, to, text: wanted },
    ]);
}

// The runs of the Emph and Strong nodes under `nodes`.
function collect(nodes, view, inEmph, runs) {
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      collect(node, view, inEmph, runs);
      continue;
    }
    if (MARKS[node.t] === undefined) {
      if (node.c !== undefined) collect([node.c], view, inEmph, runs);
      continue;
    }
    const kids = childrenOf(node);
    const run = kids.length > 0 && runOf(node, kids, view, inEmph);
    if (run) runs.push(run);
    collect(kids, view, inEmph || node.t === 'Emph', runs);
  }
}

// A node's run, or null unless one of its markers opens and closes it.
function runOf(node, kids, view, inEmph) {
  const { text } = view;
  const at = [
    view.start(node.start),
    view.start(kids[0].start),
    view.end(kids.at(-1).end),
    view.end(node.end),
  ];
  const [from, open, close, to] = at;
  if (!(from < open && open <= close && close < to)) return null;
  const written = text.slice(from, open);
  if (written !== text.slice(close, to) || !MARKS[node.t].includes(written)) {
    return null;
  }
  const nextToWord =
    WORD.test(text[from - 1] ?? '') || WORD.test(text[to] ?? '');
  const wanted = node.t === 'Strong' ? '**' : inEmph || nextToWord ? '*' : '_';
  return { at, written, wanted };
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
