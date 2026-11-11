// Keystone's shortcuts files: each top-level key a shortcut, its `body`
// and `span` the Markdown it injects as a div and as a span. Each template
// is linted as a document of its own, placed where it is in the YAML, and
// a null anywhere is refused, as keystone refuses it.
//
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/

import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { codeFrame } from './frame.js';
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
 * The diagnostics of a shortcuts file: what is no YAML, a null, a template
 * that is some other non-text, and each template's Markdown as
 * `lintSnippet` finds it.
 *
 * @param {string} path
 * @param {string} text
 * @param {import('./index.js').Options} [options]
 * @returns {Diagnostic[]}
 */
export function lintShortcuts(path, text, options = {}) {
  const doc = parseDocument(text, { uniqueKeys: false, prettyErrors: false });
  const fail = (rule, problem, [start, end]) =>
    error(path, text, rule, { problem }, start, end);
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
  const out = nulls(text, doc.contents, []).map(({ at, item, start, end }) =>
    error(path, text, 'shortcut-null', nullCallouts(at, item), start, end),
  );
  // Each node's findings by the template it is read as: an alias repeats
  // a template, linted where its anchor is.
  const reads = new Map();
  for (const { key, value } of doc.contents.items) {
    if (!isMap(value)) continue;
    const name = isScalar(key) ? String(key.value) : '?';
    for (const template of TEMPLATES) {
      const written = value.get(template.key, true);
      // A null template is the null walk's to report, where it is written.
      if (isNull(written)) continue;
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
      if (isNull(markdown)) continue;
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
  const left = new Map();
  for (const d of span) left.set(at(d), (left.get(at(d)) ?? 0) + 1);
  const body = (read.get('body') ?? []).filter((d) => {
    const n = left.get(at(d)) ?? 0;
    left.set(at(d), n - 1);
    return n <= 0;
  });
  return [...span, ...body];
}

// Where a template's Markdown sits in the YAML. A literal block's lines
// are the file's past the indent YAML strips; a scalar on one line, its
// text as written, is its line, inside any quotes. Any other's lines are
// not the file's: it is all at its start.
function placement(text, markdown) {
  const doubleQuoted = markdown.type === 'QUOTE_DOUBLE';
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
  const quoted = markdown.type === 'PLAIN' ? 0 : 1;
  const written = text.slice(start + quoted, end - quoted);
  const at = lineAndColumn(text, start);
  return !written.includes('\n') && written === markdown.value
    ? { ...at, column: at.column + quoted, doubleQuoted }
    : { ...at, pinned: true, doubleQuoted };
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

// Whether `node` is a null as written: an alias is one where its anchor is.
const isNull = (node) =>
  node == null || (isScalar(node) && node.value === null);

// Each null under `node`, at `path`: the key that holds it, or the list
// item it is, spanning from there to the null's end.
function nulls(text, node, path) {
  const out = [];
  if (isMap(node)) {
    for (const { key, value } of node.items) {
      const at = [...path, keyName(key)];
      if (isNull(value)) {
        const [start, keyEnd] = key.range;
        out.push({ at, start, end: Math.max(keyEnd, value?.range[1] ?? 0) });
      } else {
        out.push(...nulls(text, value, at));
      }
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, k) => {
      const at = [...path, k + 1];
      if (isNull(item)) {
        // An empty item of a block list is its dash.
        const [from, to] = item.range;
        const start = from === to ? text.lastIndexOf('-', from - 1) : from;
        out.push({ at, item: true, start, end: Math.max(to, start + 1) });
      } else {
        out.push(...nulls(text, item, at));
      }
    });
  }
  return out;
}

// A key as a path names it: as written, an alias by its anchor, a list or
// map as `?`.
function keyName(key) {
  if (isScalar(key)) return key.value === null ? key.source : String(key.value);
  return isAlias(key) ? `*${key.source}` : '?';
}

// A path as keys and list items, an item counted from 1; a key that would
// read otherwise is quoted.
const pathOf = (at) =>
  at
    .map((step, k) =>
      typeof step === 'number'
        ? `[${step}]`
        : `${k > 0 ? '.' : ''}${/^$|[.[\]"]/.test(step) ? JSON.stringify(step) : step}`,
    )
    .join('');

// What a null's error says: its path, why a layer can't take it, and what
// does instead.
//
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#shadowing-a-system-shortcut
function nullCallouts(at, item) {
  return {
    problem: `${pathOf(at)} has no value`,
    because:
      'A layer only overrides: a null removes nothing, and stops the build.',
    remedy: item
      ? 'Give it a value, or delete the item.'
      : 'Give it a value, or delete the key. To reach a state a default excludes, write the value that names it.',
  };
}

// An error at the span from `start` to `end` of the file: its callouts,
// framed by the line it starts on.
function error(path, text, rule, callouts, start, end) {
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
    callouts: {
      ...callouts,
      verbatim: codeFrame(text, start, end, from.line),
    },
  };
}
