// The messages Pandoc's readers log: what a reader warns of as it reads,
// each here with the span of what it is about where Pandoc's carries a
// position.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Logging`, the messages the
// Markdown, metadata and LaTeX readers raise, and the two ways they raise
// them: `report`, logged at once and kept through backtracking, as
// `PandocMonad`'s log is; `logMessage`, held in the parser's state, so
// backtracking drops it, and reported once reading ends.

import { updateState } from './parsing/state.js';

/**
 * A log message: Pandoc's type and fields, as its `--log` JSON names them,
 * the span of what it is about, and `pos`, where Pandoc's position is. An
 * unclosed div's span runs from its opening fence to where it closes
 * implicitly, Pandoc's `openpos` and `closepos`.
 *
 * Pandoc gives a position in text extracted to be read again, a list item's
 * or a note's, in that text's lines: here every offset is the source's.
 *
 * @see Text.Pandoc.Logging.LogMessage
 * @typedef {object} LogMessage
 * @property {string} type
 * @property {'INFO' | 'WARNING'} verbosity
 * @property {number} start
 * @property {number} end
 * @property {number} pos
 * @property {string} [contents]
 * @property {string} [key]
 * @property {string} [name]
 * @property {string} [path]
 * @property {string} [message]
 */

// Each type's verbosity, as Pandoc ranks it.
const INFO = new Set(['SkippedContent', 'ParsingUnescaped']);

/**
 * A message of `type`, with its fields and span, Pandoc's position its
 * start unless `fields.pos` gives it.
 *
 * @see Text.Pandoc.Logging.messageVerbosity
 * @param {string} type
 * @param {number} start
 * @param {number} end
 * @param {{pos?: number} & Record<string, unknown>} [fields]
 * @returns {LogMessage}
 */
export function message(type, start, end, fields = {}) {
  const sty =
    type === 'CouldNotLoadIncludeFile' && fields.path?.endsWith('.sty');
  const verbosity = INFO.has(type) || sty ? 'INFO' : 'WARNING';
  return { type, verbosity, pos: start, ...fields, start, end };
}

/**
 * Log `msg` at once: a read keeps it through backtracking. A context with
 * no log, a probe's, drops it.
 *
 * @see Text.Pandoc.Class.PandocMonad.report
 * @param {{log?: LogMessage[], common?: {log?: LogMessage[]}}} ctx
 * @param {LogMessage} msg
 */
export function report(ctx, msg) {
  logOf(ctx)?.push(msg);
}

/**
 * `f`'s value, what it reports dropped: a read again of what was read,
 * which Pandoc's reader reads once.
 *
 * @template T
 * @param {{log?: LogMessage[], common?: {log?: LogMessage[]}}} ctx
 * @param {() => T} f
 * @returns {T}
 */
export function unlogged(ctx, f) {
  const log = logOf(ctx);
  const logged = log?.length;
  const value = f();
  if (log) log.length = logged;
  return value;
}

/**
 * The log `report` adds to: a LaTeX read's in its common state.
 *
 * @param {{log?: LogMessage[], common?: {log?: LogMessage[]}}} ctx
 */
export const logOf = (ctx) => ctx.common?.log ?? ctx.log;

/**
 * Hold `msg` in the parser's state, reported once reading ends.
 *
 * @see Text.Pandoc.Parsing.Capabilities.logMessage
 * @param {import('./core.js').Context} ctx
 * @param {LogMessage} msg
 */
export function logMessage(ctx, msg) {
  updateState(ctx, { logMessages: { item: msg, next: ctx.state.logMessages } });
}

/**
 * A message as Pandoc's log shows it, `at` giving a source offset's line
 * and column.
 *
 * @see Text.Pandoc.Logging.showLogMessage
 * @param {LogMessage} msg
 * @param {(offset: number) => {line: number, column: number}} at
 * @returns {string}
 */
export function showLogMessage(msg, at) {
  const pos = (offset) => {
    const { line, column } = at(offset);
    return `line ${line} column ${column}`;
  };
  const here = pos(msg.pos);
  switch (msg.type) {
    case 'SkippedContent':
      return `Skipped '${msg.contents}' at ${here}`;
    case 'DuplicateLinkReference':
      return `Duplicate link reference '${msg.contents}' at ${here}`;
    case 'DuplicateNoteReference':
      return `Duplicate note reference '${msg.contents}' at ${here}`;
    case 'NoteDefinedButNotUsed':
      return `Note with key '${msg.key}' defined at ${here} but not used.`;
    case 'DuplicateIdentifier':
      return `Duplicate identifier '${msg.contents}' at ${here}`;
    case 'UndefinedToggle':
      return `Undefined toggle '${msg.contents}' at ${here}`;
    case 'ParsingUnescaped':
      return `Parsing unescaped '${msg.contents}' at ${here}`;
    case 'CouldNotLoadIncludeFile':
      return `Could not load include file ${msg.path} at ${here}`;
    case 'CouldNotParseIncludeFile':
      return `Parsing include file ${msg.path} failed at ${here}`;
    case 'MacroAlreadyDefined':
      return `Macro '${msg.name}' already defined, ignoring at ${here}`;
    case 'UnclosedDiv':
      return `Div at ${pos(msg.start)} unclosed at ${pos(msg.end)}, closing implicitly.`;
    case 'YamlWarning':
      return `YAML warning (${here}): ${msg.message}`;
    default:
      return msg.type;
  }
}
