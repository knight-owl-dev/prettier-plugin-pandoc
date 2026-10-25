// The error a reader fails with on input Pandoc cannot read: what it says,
// and the span of what fails.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Error`, its `PandocParseError`.

/** @see Text.Pandoc.Error.PandocParseError */
export class PandocParseError extends Error {
  /**
   * @param {string} message
   * @param {number} start
   * @param {number} end
   */
  constructor(message, start, end) {
    super(message);
    this.name = 'PandocParseError';
    this.start = start;
    this.end = end;
  }

  /**
   * The error with its span mapped: out of extracted text.
   *
   * @param {(offset: number) => number} toStart
   * @param {(offset: number) => number} toEnd
   */
  map(toStart, toEnd) {
    return new PandocParseError(
      this.message,
      toStart(this.start),
      toEnd(this.end),
    );
  }
}
