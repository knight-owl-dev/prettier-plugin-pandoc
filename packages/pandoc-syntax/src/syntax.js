// What Pandoc's `--tab-stop` decides, derived from it in one place.
//
// The tab stop is the one reader setting the block grammar hangs on: a tab
// advances to the next multiple of it, indentation one stop deep makes a line
// code, and so a block marker may sit at most one column short of that.

/**
 * Pandoc's own default.
 */
export const DEFAULT_TAB_STOP = 4;

/**
 * @typedef {object} Syntax
 * @property {number} tabStop Columns a tab advances to the next multiple of.
 * @property {number} codeIndent Columns of indentation that make a line code.
 * @property {number} blockIndent The most spaces a block marker may sit in.
 * @property {(pattern: string, flags?: string) => RegExp} atBlockIndent A
 *   pattern anchored at a line's start, after up to `blockIndent` spaces.
 */

/** @type {Map<number, Syntax>} */
const byTabStop = new Map();

/**
 * The syntax Pandoc reads at `tabStop`, the same object for the same stop.
 *
 * @param {number} [tabStop]
 * @returns {Syntax}
 */
export function syntaxFor(tabStop = DEFAULT_TAB_STOP) {
  if (!Number.isInteger(tabStop) || tabStop < 1) {
    throw new RangeError(`a tab stop is a positive integer, not ${tabStop}`);
  }
  if (!byTabStop.has(tabStop)) {
    const blockIndent = tabStop - 1;
    byTabStop.set(
      tabStop,
      Object.freeze({
        tabStop,
        codeIndent: tabStop,
        blockIndent,
        atBlockIndent: (pattern, flags) =>
          new RegExp(`^ {0,${blockIndent}}${pattern}`, flags),
      }),
    );
  }
  return byTabStop.get(tabStop);
}

/**
 * Memoize what `build` makes of a syntax: patterns compiled once per tab stop.
 *
 * @template T
 * @param {(syntax: Syntax) => T} build
 * @returns {(syntax: Syntax) => T}
 */
export function perSyntax(build) {
  /** @type {WeakMap<Syntax, T>} */
  const built = new WeakMap();
  return (syntax) => {
    if (!built.has(syntax)) built.set(syntax, build(syntax));
    return built.get(syntax);
  };
}
