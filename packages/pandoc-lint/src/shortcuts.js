// Keystone's shortcuts files: each top-level key a shortcut, its `body`
// and `span` the Markdown it injects as a div and as a span. Each template
// is linted as a document of its own, placed where it is in the YAML.
//
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/

import { isAlias, isMap, isScalar, parseDocument } from 'yaml';
import { lintSnippet } from './index.js';

/** @typedef {import('./index.js').Diagnostic} Diagnostic */

// A template is part of a document, not one: it carries no title or
// metadata, and its headings no generated identifiers. A span holds
// inlines, so an image alone in it makes no figure.
const FRAGMENT = [
  '-pandoc_title_block',
  '-yaml_metadata_block',
  '-auto_identifiers',
];
const TEMPLATES = [
  { key: 'body', extensions: FRAGMENT },
  {
    key: 'span',
    extensions: [...FRAGMENT, '-implicit_figures'],
    oneParagraph: true,
  },
];

/**
 * The diagnostics of a shortcuts file: what is no YAML, a template that is
 * no text, and each template's Markdown as `lintSnippet` finds it.
 *
 * @param {string} path
 * @param {string} text
 * @param {import('./index.js').Options} [options]
 * @returns {Diagnostic[]}
 */
export function lintShortcuts(path, text, options = {}) {
  const doc = parseDocument(text, { uniqueKeys: false, prettyErrors: false });
  const fail = (rule, problem, [start, end]) =>
    error(path, text, rule, problem, start, end);
  if (doc.errors.length > 0) {
    return doc.errors.map((e) =>
      fail('yaml-syntax', firstLine(e.message), e.pos),
    );
  }
  if (doc.contents === null) return [];
  if (!isMap(doc.contents)) {
    return [
      fail(
        'shortcut-file',
        'shortcuts file is not a mapping of names to shortcuts',
        doc.contents.range,
      ),
    ];
  }
  const out = [];
  // A template an alias repeats is linted once as each template it is,
  // where its anchor is.
  const linted = Object.fromEntries(TEMPLATES.map((t) => [t.key, new Set()]));
  for (const { key, value } of doc.contents.items) {
    if (!isMap(value)) continue;
    const name = isScalar(key) ? String(key.value) : '?';
    for (const template of TEMPLATES) {
      const written = value.get(template.key, true);
      if (written === undefined) continue;
      const markdown = isAlias(written) ? written.resolve(doc) : written;
      if (markdown === undefined || linted[template.key].has(markdown)) {
        continue;
      }
      linted[template.key].add(markdown);
      if (!isScalar(markdown) || typeof markdown.value !== 'string') {
        out.push(
          fail(
            `shortcut-${template.key}`,
            `${template.key} of shortcut '${name}' is not text`,
            written.range,
          ),
        );
        continue;
      }
      const found = lintSnippet(markdown.value, {
        ...options,
        extensions: template.extensions,
        oneParagraph: template.oneParagraph,
        ...placement(text, markdown),
        source: path,
        file: text,
      });
      out.push(
        ...(markdown.type === 'BLOCK_LITERAL'
          ? found
          : found.map(atStart(text, markdown))),
      );
    }
  }
  // One read as a body and as a span finds the same thing once.
  const once = new Map(out.map((d) => [JSON.stringify(d), d]));
  return [...once.values()].sort((a, b) => a.start - b.start);
}

// Where a literal block's Markdown sits in the YAML: from the line after
// its header, each line indented as its first line with text.
function placement(text, markdown) {
  const contentStart = text.indexOf('\n', markdown.range[0]) + 1;
  const lines = text.slice(contentStart, markdown.range[1]).split('\n');
  const indent = /^ */.exec(lines.find((l) => l.trim() !== '') ?? '')[0].length;
  const first = lineAndColumn(text, contentStart);
  return { line: first.line, column: indent + 1, indent };
}

// A diagnostic of a template whose lines are not the source's (folded, or
// quoted), moved to where the template starts; its frame, of lines the
// file doesn't have, goes.
function atStart(text, markdown) {
  const [start] = markdown.range;
  const at = lineAndColumn(text, start);
  return ({ callouts: { verbatim, ...callouts }, ...d }) => ({
    ...d,
    callouts,
    start,
    end: start,
    line: at.line,
    column: at.column,
    endLine: at.line,
    endColumn: at.column,
  });
}

// The line and column of `offset`, from 1, a column a code point.
function lineAndColumn(text, offset) {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    line: before.split('\n').length,
    column: [...before.slice(lineStart)].length + 1,
  };
}

const firstLine = (message) => message.split('\n')[0].replace(/\.$/, '');

// An error at the span from `start` to `end` of the file.
function error(path, text, rule, problem, start, end) {
  const from = lineAndColumn(text, start);
  const to = lineAndColumn(text, Math.max(start, end));
  return {
    rule,
    severity: 'error',
    source: path,
    start,
    end,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
    callouts: { problem },
  };
}
