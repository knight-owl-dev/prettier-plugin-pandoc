// The rules: each message Pandoc's reader logs, as a diagnostic, and each
// misread (`misreads.js`). Rule ids are the types in kebab case; Pandoc's
// INFO messages are `info`, off unless asked for.

/**
 * What a rule reads a message against: where an offset is, as
 * `path:line:column`; the source's text between two offsets; and the
 * read's reference definitions and AST, for the place a duplicate repeats.
 *
 * @typedef {object} Read
 * @property {(offset: number) => string} where
 * @property {(start: number, end: number) => string} slice
 * @property {{start: number, end: number, label: [number, number]}[]} definitions
 * @property {(id: string, before: number) => {start: number, end: number} | null} firstWithId
 * @property {(label: string) => string} toKey
 */

/**
 * A rule: its id and severity, and the callouts of a message.
 *
 * @typedef {object} Rule
 * @property {string} rule
 * @property {'error' | 'warn' | 'info'} severity
 * @property {(msg: object, read: Read) => Record<string, string | string[]>} callouts
 */

// The characters TeX escapes with a backslash alone.
const ESCAPED = new Set('&#%$_{}');

// The place a span starts, and its first line, as an offender.
const offender = (read, { start, end }) =>
  `${read.where(start)}: ${read.slice(start, end).split('\n')[0]}`;

/** @type {Record<string, Rule>} */
export const RULES = {
  UnclosedDiv: {
    rule: 'unclosed-div',
    severity: 'warn',
    callouts: (msg, read) => ({
      problem: 'div is never closed',
      effect: `Pandoc closes it at ${read.where(msg.end)}.`,
      remedy: read.slice(msg.start, msg.start + 1).startsWith('<')
        ? 'Close it with </div>.'
        : 'Close it with a line of :::.',
    }),
  },
  DuplicateLinkReference: {
    rule: 'duplicate-link-reference',
    severity: 'warn',
    callouts: (msg, read) => {
      const key = read.toKey(msg.contents);
      const first = read.definitions.find(
        (d) =>
          d.start < msg.start &&
          read.toKey(read.slice(...d.label).replace(/:$/, '')) === key,
      );
      return {
        problem: `link reference ${msg.contents} is defined again`,
        offenders: first ? [offender(read, first)] : [],
        effect: 'Links use the last definition.',
      };
    },
  },
  DuplicateNoteReference: {
    rule: 'duplicate-note-reference',
    severity: 'warn',
    callouts: (msg) => ({
      problem: `note [^${msg.contents}] is defined again`,
      effect: 'The note reads the last definition.',
    }),
  },
  NoteDefinedButNotUsed: {
    rule: 'note-defined-but-not-used',
    severity: 'warn',
    callouts: (msg) => ({
      problem: `note [^${msg.key}] is defined but never used`,
      effect: 'Pandoc leaves it out of the document.',
    }),
  },
  DuplicateIdentifier: {
    rule: 'duplicate-identifier',
    severity: 'warn',
    callouts: (msg, read) => {
      const first = read.firstWithId(msg.contents, msg.start);
      return {
        problem: `identifier #${msg.contents} is used again`,
        offenders: first ? [offender(read, first)] : [],
        because:
          'An identifier names one element: a link to it cannot tell the two apart.',
      };
    },
  },
  YamlWarning: {
    rule: 'yaml-warning',
    severity: 'warn',
    callouts: (msg) => ({
      problem: msg.message.replace(
        /^Duplicate key: (.*)$/,
        'metadata key $1 is given again',
      ),
      effect: 'The metadata reads the last value.',
    }),
  },
  MacroAlreadyDefined: {
    rule: 'macro-already-defined',
    severity: 'warn',
    callouts: (msg) => {
      const macro = msg.name.startsWith('\\');
      return {
        problem: `${macro ? 'macro' : 'environment'} ${msg.name.trim()} is defined again`,
        effect: 'Pandoc keeps the first definition.',
        remedy: `Use \\${macro ? 'renewcommand' : 'renewenvironment'} to replace it.`,
      };
    },
  },
  UndefinedToggle: {
    rule: 'undefined-toggle',
    severity: 'warn',
    callouts: (msg) => ({
      problem: `toggle ${msg.contents} is not defined`,
      effect: 'Pandoc reads neither branch.',
      remedy: `Define it first with \\newtoggle{${msg.contents}}.`,
    }),
  },
  ParsingUnescaped: {
    rule: 'parsing-unescaped',
    severity: 'info',
    callouts: (msg) => ({
      problem: `${msg.contents} in raw TeX is not escaped`,
      effect: 'Pandoc reads it as text.',
      remedy: ESCAPED.has(msg.contents)
        ? `Escape it as \\${msg.contents}.`
        : [],
    }),
  },
  SkippedContent: {
    rule: 'skipped-content',
    severity: 'info',
    callouts: () => ({
      problem: 'raw TeX is skipped',
      effect: 'Pandoc leaves it out of the document.',
    }),
  },
  BlockInParagraph: {
    rule: 'block-in-paragraph',
    severity: 'error',
    callouts: (msg) => ({
      problem: `${msg.block} is read as paragraph text`,
      because: `A paragraph runs on to the next blank line: a ${msg.block} on the line after its text is part of it.`,
      remedy:
        'Put a blank line before it; if it is meant as text, escape its first character with a backslash.',
    }),
  },
  DivFenceLength: {
    rule: 'div-fence-length',
    severity: 'warn',
    callouts: (msg, read) => ({
      problem: `closing fence ${':'.repeat(msg.colons)} closes a div opened with ${':'.repeat(msg.opener.colons)}`,
      offenders: [offender(read, msg.opener)],
      because:
        'Any fence of three colons or more closes the innermost open div: its length pairs it with no opener.',
      remedy: 'Make each closing fence as long as its opener.',
    }),
  },
  UndefinedReference: {
    rule: 'undefined-reference',
    severity: 'warn',
    callouts: (msg) => ({
      problem: `reference ${msg.label} is not defined`,
      effect: `Pandoc prints the ${msg.kind} as text, brackets and all.`,
      remedy: `Define it, as ${msg.label}: followed by its target, in any file of the manuscript.`,
    }),
  },
  UndefinedNote: {
    rule: 'undefined-note',
    severity: 'warn',
    callouts: (msg) => ({
      problem: `note [^${msg.label}] is not defined`,
      effect: 'Pandoc prints the reference as text, brackets and all.',
      remedy: `Define it, as [^${msg.label}]: followed by its text, in any file of the manuscript.`,
    }),
  },
  MetadataInMarkdown: {
    rule: 'metadata-in-markdown',
    severity: 'error',
    callouts: (msg) => ({
      problem: `${msg.kind === 'title' ? 'a title block' : 'a YAML metadata block'} is in the Markdown`,
      because: 'The project keeps its metadata out of the manuscript.',
      remedy:
        "Move its fields to the project's metadata file and delete the block.",
    }),
  },
};
