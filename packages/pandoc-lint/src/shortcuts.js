// Keystone's shortcuts files: each top-level key a shortcut, its `body`
// the Markdown it injects. Each body is linted as a document of its own,
// placed where it is in the YAML.
//
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/

import { isMap, isScalar, parseDocument } from 'yaml';
import { lintSnippet } from './index.js';

/** @typedef {import('./index.js').Diagnostic} Diagnostic */

/**
 * The diagnostics of a shortcuts file: what is no YAML, a body that is no
 * text, and each body's Markdown as `lintSnippet` finds it.
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
  for (const { key, value } of doc.contents.items) {
    const body = isMap(value) ? value.get('body', true) : undefined;
    if (body === undefined) continue;
    const name = isScalar(key) ? String(key.value) : '?';
    if (!isScalar(body) || typeof body.value !== 'string') {
      out.push(
        fail(
          'shortcut-body',
          `body of shortcut '${name}' is not text`,
          body.range,
        ),
      );
      continue;
    }
    const found = lintSnippet(body.value, {
      ...options,
      ...placement(text, body),
      source: path,
      file: text,
    });
    out.push(
      ...(body.type === 'BLOCK_LITERAL'
        ? found
        : found.map(atStart(text, body))),
    );
  }
  return out.sort((a, b) => a.start - b.start);
}

// Where a literal block's Markdown sits in the YAML: from the line after
// its header, each line indented as its first line with text.
function placement(text, body) {
  const contentStart = text.indexOf('\n', body.range[0]) + 1;
  const lines = text.slice(contentStart, body.range[1]).split('\n');
  const indent = /^ */.exec(lines.find((l) => l.trim() !== '') ?? '')[0].length;
  const first = lineAndColumn(text, contentStart);
  return { line: first.line, column: indent + 1, indent };
}

// A diagnostic of a body whose lines are not the source's (folded, or
// quoted), moved to where the body starts.
function atStart(text, body) {
  const [start] = body.range;
  const at = lineAndColumn(text, start);
  return (d) => ({
    ...d,
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
