// Text a reader extracts to parse again, and the way back from offsets in it
// to offsets in the text it was extracted from.
//
// Pandoc's `parseFromString` parses text built from pieces of the input:
// markers stripped, lines joined, escapes decoded. A `SourceText` is that
// text with a piecewise map: a copied slice maps linearly; synthesized text
// (a decoded escape, an inserted join) maps to the span it stands for, and
// whatever the extractor dropped falls between pieces. A node starting at a
// boundary maps past the drop, one ending there maps before it.

/**
 * @typedef {object} Piece
 * @property {number} at Where it starts in the text.
 * @property {number} length Its length in the text.
 * @property {number} from Where what it stands for starts outside.
 * @property {number} to Where that ends.
 * @property {boolean} copy Whether it is a copy, mapping offset for offset.
 */

export class SourceText {
  /**
   * @param {string} text
   * @param {Piece[]} pieces In order, covering `text`.
   */
  constructor(text, pieces) {
    this.text = text;
    this.pieces = pieces;
  }

  /**
   * `outer`'s text from `start` to `end`, copied.
   *
   * @param {string} outer
   * @param {number} start
   * @param {number} end
   */
  static slice(outer, start, end) {
    const length = end - start;
    if (length === 0) return EMPTY;
    const piece = { at: 0, length, from: start, to: end, copy: true };
    return new SourceText(outer.slice(start, end), [piece]);
  }

  /**
   * `text` standing for the span `from` to `to` outside, which it need not
   * spell: a decoded escape, an inserted join.
   *
   * @param {string} text
   * @param {number} from
   * @param {number} to
   */
  static synth(text, from, to) {
    if (text === '') return EMPTY;
    const piece = { at: 0, length: text.length, from, to, copy: false };
    return new SourceText(text, [piece]);
  }

  /**
   * The texts one after another, a copy merged into the copy before it
   * where they meet outside too.
   *
   * @param {SourceText[]} parts
   */
  static concat(parts) {
    const pieces = [];
    let text = '';
    for (const part of parts) {
      for (const p of part.pieces) {
        const last = pieces.at(-1);
        if (last?.copy && p.copy && last.to === p.from) {
          pieces[pieces.length - 1] = {
            ...last,
            length: last.length + p.length,
            to: p.to,
          };
        } else {
          pieces.push({ ...p, at: p.at + text.length });
        }
      }
      text += part.text;
    }
    return new SourceText(text, pieces);
  }

  /**
   * This text from `start` to `end`, its map cut with it: a copy keeps the
   * offsets it holds, synthesized text what it stands for.
   *
   * @param {number} start
   * @param {number} end
   * @returns {SourceText}
   */
  cut(start, end) {
    const parts = [];
    for (const p of this.pieces) {
      const from = Math.max(start, p.at);
      const to = Math.min(end, p.at + p.length);
      if (from >= to) continue;
      const text = this.text.slice(from, to);
      parts.push(
        p.copy
          ? new SourceText(text, [
              {
                ...p,
                at: 0,
                length: to - from,
                from: p.from + (from - p.at),
                to: p.from + (to - p.at),
              },
            ])
          : SourceText.synth(text, p.from, p.to),
      );
    }
    return SourceText.concat(parts);
  }

  /**
   * This text with its carriage returns left out, as Pandoc's `toSources`
   * leaves them out of what it parses: each one dropped text in the map.
   * Only synthesized text holds one: what a reader copies is read already,
   * carriage returns gone.
   *
   * @see Text.Pandoc.Sources.toSources
   * @returns {SourceText}
   */
  withoutCarriageReturns() {
    if (!this.text.includes('\r')) return this;
    return SourceText.concat(
      this.pieces.map((p) => {
        const text = this.text.slice(p.at, p.at + p.length);
        return p.copy
          ? new SourceText(text, [{ ...p, at: 0 }])
          : SourceText.synth(text.replaceAll('\r', ''), p.from, p.to);
      }),
    );
  }

  /**
   * This text's map carried on out through `outer`, the text its offsets
   * outside are in: a copy split where `outer`'s pieces are, synthesized
   * text standing for what its span stands for.
   *
   * @param {SourceText} outer
   * @returns {SourceText}
   */
  through(outer) {
    const parts = this.pieces.map((p) => {
      const text = this.text.slice(p.at, p.at + p.length);
      if (p.copy) return new SourceText(text, outer.cut(p.from, p.to).pieces);
      const from = outer.toOuterStart(p.from);
      const to = p.to === p.from ? from : outer.toOuterEnd(p.to);
      return SourceText.synth(text, from, to);
    });
    return SourceText.concat(parts);
  }

  /**
   * Where in this text a node starting at outside offset `offset` starts:
   * past what was dropped there, at the start of what stands for it.
   *
   * @param {number} offset
   */
  toInnerStart(offset) {
    for (const p of this.pieces) {
      if (offset === p.from || offset < p.to) {
        return p.copy && offset > p.from ? p.at + (offset - p.from) : p.at;
      }
    }
    return this.text.length;
  }

  /**
   * Where in this text a node ending at outside offset `offset` ends:
   * before what was dropped there, at the end of what stands for it.
   *
   * @param {number} offset
   */
  toInnerEnd(offset) {
    let end = 0;
    for (const p of this.pieces) {
      if (p.from >= offset) break;
      if (p.copy) end = p.at + Math.min(p.length, offset - p.from);
      else end = offset >= p.to ? p.at + p.length : p.at;
    }
    return end;
  }

  /**
   * The outside offset a node starting at `offset` starts at.
   *
   * @param {number} offset
   */
  toOuterStart(offset) {
    const piece = this.pieces[lastStarting(this.pieces, offset, true)];
    if (piece === undefined || offset >= piece.at + piece.length) {
      return this.pieces.at(-1)?.to ?? 0;
    }
    return piece.copy ? piece.from + (offset - piece.at) : piece.from;
  }

  /**
   * The outside offset a node ending at `offset` ends at.
   *
   * @param {number} offset
   */
  toOuterEnd(offset) {
    const piece = this.pieces[lastStarting(this.pieces, offset, false)];
    if (piece === undefined) return this.pieces[0]?.from ?? 0;
    return piece.copy ? piece.from + (offset - piece.at) : piece.to;
  }
}

// The index of the last piece starting before `offset`, or at it where
// `inclusive`; -1 for none.
function lastStarting(pieces, offset, inclusive) {
  let [lo, hi] = [0, pieces.length - 1];
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = pieces[mid].at;
    if (at < offset || (inclusive && at === offset)) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

const EMPTY = new SourceText('', []);
