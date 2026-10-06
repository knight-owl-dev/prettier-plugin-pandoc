// Lint Pandoc markdown: what Pandoc's reader logs reading a manuscript, each
// message a diagnostic at its file, line and column, in keystone's callouts.
//
// Files are read as Pandoc's CLI reads several, joined into one document in
// the order given; each diagnostic is mapped back to the file it is in.

import { readMarkdown, toKey, toSources } from '@knight-owl-dev/pandoc-parser';
import { frame } from './frame.js';
import { misreads } from './misreads.js';
import { RULES } from './rules.js';

export { frame } from './frame.js';
export { RULES } from './rules.js';

/**
 * A diagnostic: its rule and severity, where it is (offsets into its file,
 * and lines and columns from 1, a column a code point, the end exclusive),
 * and keystone's callouts saying it.
 *
 * @typedef {object} Diagnostic
 * @property {string} rule
 * @property {'error' | 'warn' | 'info'} severity
 * @property {string} source
 * @property {number} start
 * @property {number} end
 * @property {number} line
 * @property {number} column
 * @property {number} endLine
 * @property {number} endColumn
 * @property {Callouts} callouts
 */

/**
 * @typedef {object} Callouts
 * @property {string} problem
 * @property {string[]} [offenders]
 * @property {string[]} [verbatim] The line it starts on, carets under it.
 * @property {string} [because]
 * @property {string} [effect]
 * @property {string} [remedy]
 * @property {string} [see]
 */

/**
 * @typedef {object} Options
 * @property {number} [tabStop]
 * @property {boolean} [info] Report Pandoc's INFO messages too.
 */

/**
 * The diagnostics of `files`, read as one manuscript: by file in the order
 * given, then by where each starts.
 *
 * @param {{path: string, text: string}[]} files
 * @param {Options} [options]
 * @returns {Diagnostic[]}
 */
export function lint(files, options = {}) {
  const { text, locate } = toSources(files);
  const texts = new Map(files.map((f) => [f.path, f.text]));
  const order = new Map(files.map((f, k) => [f.path, k]));
  const place = (offset) => {
    const { path, offset: at } = locate(offset);
    return { path, offset: at, ...lineAndColumn(texts.get(path), at) };
  };
  const out = diagnose(text, place, options);
  return out.sort(
    (a, b) => order.get(a.source) - order.get(b.source) || a.start - b.start,
  );
}

/**
 * The diagnostics of a snippet: markdown taken from a file, a shortcut's
 * body in YAML, placed where it is there. Its first line starts at `line`
 * and `column`; each after it is indented `indent` columns.
 *
 * @param {string} text
 * @param {Options & {source?: string, line?: number, column?: number, indent?: number}} [options]
 * @returns {Diagnostic[]}
 */
export function lintSnippet(text, options = {}) {
  const { source = '<snippet>', line = 1, column = 1, indent = 0 } = options;
  const place = (offset) => {
    const at = Math.min(offset, text.length);
    const local = lineAndColumn(text, at);
    return {
      path: source,
      offset: at,
      line: line + local.line - 1,
      column: local.column + (local.line === 1 ? column - 1 : indent),
    };
  };
  return diagnose(text, place, options).sort((a, b) => a.start - b.start);
}

/**
 * The diagnostics as JSON, versioned: what a tool reads.
 *
 * @param {Diagnostic[]} diagnostics
 * @returns {string}
 */
export function formatJson(diagnostics) {
  return `${JSON.stringify({ version: 1, diagnostics }, null, 2)}\n`;
}

// GitHub's command for each severity.
const COMMAND = { error: 'error', warn: 'warning', info: 'notice' };

// A workflow command's message escaped, and a property's: `%` and line
// breaks, and in a property `:` and `,` too.
const escapeData = (s) =>
  s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (s) =>
  escapeData(s).replaceAll(':', '%3A').replaceAll(',', '%2C');

/**
 * Each diagnostic as a GitHub Actions workflow command, which annotates
 * its lines in a run and a pull request's diff: the rule its title, the
 * problem and the prose callouts its message, the code frame left out.
 *
 * @see https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 * @param {Diagnostic[]} diagnostics
 * @returns {string}
 */
export function formatGithub(diagnostics) {
  return diagnostics
    .map((d) => {
      const {
        problem,
        offenders = [],
        because,
        effect,
        remedy,
        see,
      } = d.callouts;
      const message = [problem, ...offenders, because, effect, remedy, see]
        .filter(Boolean)
        .join('\n');
      // GitHub's end column is the last one the span covers.
      const endColumn =
        d.endLine === d.line ? Math.max(d.column, d.endColumn - 1) : undefined;
      const properties = [
        ['file', d.source],
        ['line', d.line],
        ['endLine', d.endLine],
        ['col', d.column],
        ['endColumn', endColumn],
        ['title', d.rule],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${escapeProperty(String(v))}`)
        .join(',');
      return `::${COMMAND[d.severity]} ${properties}::${escapeData(message)}\n`;
    })
    .join('');
}

/**
 * Each diagnostic as keystone frames one, its location before it as
 * compilers write one: `path:line:column: `.
 *
 * @param {Diagnostic[]} diagnostics
 * @returns {string}
 */
export function formatText(diagnostics) {
  return diagnostics
    .map((d) => {
      const lead = `${d.source}:${d.line}:${d.column}: `;
      return frame(SEVERITY[d.severity], d.callouts, lead).join('\n');
    })
    .map((d) => `${d}\n`)
    .join('');
}

const SEVERITY = { warn: 'WARN', info: 'INFO', error: 'ERROR' };

// The diagnostics of the read of `text`, `place` giving where an offset in
// it is: one per message, a message Pandoc logs twice once.
function diagnose(text, place, { tabStop, info = false }) {
  const doc = readMarkdown(text, { tabStop });
  const where = (offset) => {
    const p = place(offset);
    return `${p.path}:${p.line}:${p.column}`;
  };
  const read = {
    where,
    slice: (start, end) => text.slice(start, end),
    definitions: doc.definitions,
    firstWithId: (id, before) => firstWithId(doc.blocks, id, before),
    toKey,
  };
  const seen = new Set();
  const out = [];
  for (const msg of [...doc.log, ...misreads(doc, text, { tabStop })]) {
    const rule = RULES[msg.type];
    if (rule === undefined || (rule.severity === 'info' && !info)) continue;
    const key = JSON.stringify(msg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic(rule, msg, read, place, text));
  }
  return out;
}

// A message as a diagnostic: its span kept to the file it starts in, and a
// frame of the line it starts on.
function diagnostic(rule, msg, read, place, text) {
  const from = place(msg.start);
  const lineEnd = text.indexOf('\n', msg.start);
  const until = Math.min(msg.end, lineEnd === -1 ? text.length : lineEnd);
  let to = place(Math.max(msg.end, msg.start));
  if (to.path !== from.path) to = place(Math.max(until, msg.start));
  const callouts = rule.callouts(msg, read);
  return {
    rule: rule.rule,
    severity: rule.severity,
    source: from.path,
    start: from.offset,
    end: to.offset,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
    callouts: {
      ...withoutEmpty(callouts),
      verbatim: codeFrame(text, msg.start, until, from.line),
    },
  };
}

// The callouts that have something to say.
const withoutEmpty = (callouts) =>
  Object.fromEntries(
    Object.entries(callouts).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== '',
    ),
  );

// The line `start` is on, numbered `line`, carets under `start` to `end`;
// a tab a space, so that they line up.
function codeFrame(text, start, end, line) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', start);
  const content = text
    .slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
    .replaceAll('\t', ' ');
  const before = [...text.slice(lineStart, start)].length;
  const width = Math.max(
    1,
    [...text.slice(start, Math.max(start, end))].length,
  );
  const number = String(line);
  const pad = ' '.repeat(number.length);
  return [
    `${number} | ${content}`,
    `${pad} | ${' '.repeat(before)}${'^'.repeat(width)}`,
  ];
}

// The line and column of `offset` in `text`, from 1, a column a code point.
function lineAndColumn(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (
    let i = text.indexOf('\n');
    i !== -1 && i < offset;
    i = text.indexOf('\n', i + 1)
  ) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: [...text.slice(lineStart, offset)].length + 1 };
}

// The first heading with identifier `id` starting before `before`.
function firstWithId(blocks, id, before) {
  const stack = [...blocks];
  let first = null;
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node === null || typeof node !== 'object') continue;
    if (node.t === 'Header' && node.c[1][0] === id && node.start < before) {
      if (first === null || node.start < first.start) first = node;
    }
    if (node.c !== undefined) stack.push(node.c);
  }
  return first;
}
