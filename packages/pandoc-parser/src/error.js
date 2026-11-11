// The error a reader fails with on input Pandoc cannot read: what it says,
// the span of what fails, and any detail of why.
//
// Ported from Pandoc's `Text.Pandoc.Error`, its `PandocParseError`.

/** @see Text.Pandoc.Error.PandocParseError */
export class PandocParseError extends Error {
  /**
   * @param {string} message
   * @param {number} start
   * @param {number} end
   * @param {Record<string, unknown>} [detail] Why, where Pandoc's message
   *   does not say.
   */
  constructor(message, start, end, detail) {
    super(message);
    this.name = 'PandocParseError';
    this.start = start;
    this.end = end;
    this.detail = detail;
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
      this.detail,
    );
  }
}
