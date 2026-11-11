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
    spanTemplate: true,
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
  // Each node's findings by the template it is read as: an alias repeats
  // a template, linted where its anchor is.
  const reads = new Map();
  for (const { key, value } of doc.contents.items) {
    if (!isMap(value)) continue;
    const name = isScalar(key) ? String(key.value) : '?';
    for (const template of TEMPLATES) {
      const written = value.get(template.key, true);
      if (written === undefined) continue;
      const markdown = isAlias(written) ? written.resolve(doc) : written;
      if (markdown === undefined) {
        out.push(
          fail(
            'yaml-syntax',
            `alias *${written.source} names no anchor`,
            written.range,
          ),
        );
        continue;
      }
      if (!reads.has(markdown)) reads.set(markdown, new Map());
      const read = reads.get(markdown);
      if (read.has(template.key)) continue;
      if (!isScalar(markdown) || typeof markdown.value !== 'string') {
        read.set(template.key, []);
        out.push(
          fail(
            `shortcut-${template.key}`,
            `${template.key} of shortcut '${name}' is not text`,
            written.range,
          ),
        );
        continue;
      }
      read.set(
        template.key,
        lintSnippet(markdown.value, {
          ...options,
          extensions: template.extensions,
          spanTemplate: template.spanTemplate,
          ...placement(text, markdown),
          source: path,
          file: text,
        }),
      );
    }
  }
  for (const read of reads.values()) out.push(...merged(read));
  return out.sort((a, b) => a.start - b.start);
}

// A node's findings read as a body and as a span, one where both find it:
// the span's, whose remedy holds for both.
function merged(read) {
  const span = read.get('span') ?? [];
  const at = (d) => [d.rule, d.start, d.end, d.callouts.problem].join();
  const found = new Set(span.map(at));
  return [
    ...span,
    ...(read.get('body') ?? []).filter((d) => !found.has(at(d))),
  ];
}

// Where a template's Markdown sits in the YAML. A literal block's lines
// are the file's past the indent YAML strips; a plain scalar on one line is
// its line. Any other's lines are not the file's: it is all at its start.
function placement(text, markdown) {
  const [start, end] = markdown.range;
  if (markdown.type === 'BLOCK_LITERAL') {
    const contentStart = text.indexOf('\n', start) + 1;
    const lines = text.slice(contentStart, end).split('\n');
    const values = markdown.value.split('\n');
    const k = values.findIndex((l) => l.trim() !== '');
    const spaces = (l) => /^ */.exec(l)[0].length;
    const indent = k === -1 ? 0 : spaces(lines[k]) - spaces(values[k]);
    const { line } = lineAndColumn(text, contentStart);
    return { line, column: indent + 1, indent };
  }
  const at = lineAndColumn(text, start);
  const oneLine = !text.slice(start, end).includes('\n');
  return { ...at, pinned: !(markdown.type === 'PLAIN' && oneLine) };
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
