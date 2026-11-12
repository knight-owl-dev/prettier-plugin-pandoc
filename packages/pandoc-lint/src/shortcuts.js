// Keystone's shortcuts files: each top-level key a shortcut, its `body`
// and `span` the Markdown it injects as a div and as a span. Each template
// is linted as a document of its own, placed where it is in the YAML, and
// what keystone refuses in the file is refused where it is written.
//
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  parseDocument,
} from 'yaml';
import { codeFrame } from './frame.js';
import { lintSnippet } from './index.js';

/** @typedef {import('./index.js').Diagnostic} Diagnostic */

// A template is part of a document, not one: it carries no title or
// metadata, its headings no generated identifiers, and no reference finds a
// heading by its text. A span holds inlines, so an image alone in it makes
// no figure.
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#how-a-template-is-read
const FRAGMENT = [
  '-pandoc_title_block',
  '-yaml_metadata_block',
  '-auto_identifiers',
  '-implicit_header_references',
];
const TEMPLATES = [
  { key: 'body', extensions: FRAGMENT },
  {
    key: 'span',
    extensions: [...FRAGMENT, '-implicit_figures'],
  },
];

/**
 * The diagnostics of a shortcuts file: what is no YAML, what keystone
 * refuses in it, a template that is some other non-text, and each
 * template's Markdown as `lintSnippet` finds it.
 *
 * @param {string} path
 * @param {string} text
 * @param {import('./index.js').Options} [options]
 * @returns {Diagnostic[]}
 */
export function lintShortcuts(path, text, options = {}) {
  const parse = { uniqueKeys: false, prettyErrors: false };
  const docs = parseAllDocuments(text, parse);
  const fail = (rule, problem, [start, end]) =>
    error(path, text, rule, { problem }, start, end);
  // A directive with no document is an error only a document's parse finds.
  const errors =
    docs.length > 0
      ? docs.flatMap((d) => d.errors)
      : parseDocument(text, parse).errors;
  if (errors.length > 0) {
    return errors.map((e) => fail('yaml-syntax', firstLine(e.message), e.pos));
  }
  // Keystone reads the first document that isn't a null, and refuses a
  // second that holds anything.
  // @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#the-file
  const held = docs.filter((d) => !isEmpty(d.contents));
  if (held.length === 0) return [];
  const doc = held.find((d) => !isNull(d.contents)) ?? held[0];
  const out = [];
  if (held.length > 1) {
    const start = held[1].range[0];
    out.push(
      error(
        path,
        text,
        'shortcut-file',
        MANY_DOCUMENTS,
        start,
        lineEnd(text, start),
      ),
    );
  }
  if (!isMap(doc.contents)) {
    out.push(fail('shortcut-file', NOT_A_MAP, spanOf(text, doc.contents)));
    return out;
  }
  for (const { at, item, start, end } of nulls(text, doc, doc.contents, [])) {
    out.push(
      error(path, text, 'shortcut-null', nullCallouts(at, item), start, end),
    );
  }
  out.push(...keys(path, text, doc, doc.contents, []));
  // Each node's findings by the template it is read as: an alias repeats
  // a template, linted where its anchor is.
  const reads = new Map();
  for (const { key, value } of pairsOf(doc, doc.contents)) {
    const definition = isAlias(value) ? value.resolve(doc) : value;
    // A null is the null walk's to report.
    if (isNull(definition)) continue;
    const name = keyName(key);
    if (!isMap(definition)) {
      out.push(
        fail(
          'shortcut-file',
          `shortcut '${name}' is not a map`,
          spanOf(text, value),
        ),
      );
      continue;
    }
    for (const template of TEMPLATES) {
      const written = definition.get(template.key, true);
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
          template: template.key,
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

// Whether `node` is a null as written, as keystone reads one: a custom tag
// on no value is one, a core tag's empty value is text. An alias is one
// where its anchor is.
// @see https://keystone.knight-owl.dev/shortcuts/writing-shortcuts/#shadowing-a-system-shortcut
const isNull = (node) =>
  node == null ||
  (isScalar(node) &&
    (node.value === null ||
      (node.type === 'PLAIN' &&
        node.source === '' &&
        !node.tag?.startsWith('tag:yaml.org,2002:'))));

// Whether a document's contents are nothing, or comments alone: a null
// with no text, tag or anchor.
const isEmpty = (node) =>
  isNull(node) &&
  (node == null || (node.source === '' && !node.tag && !node.anchor));

const MANY_DOCUMENTS = {
  problem: 'shortcuts file holds more than one YAML document',
  because: 'A shortcuts file is one map of names to definitions.',
  remedy:
    'Merge the documents into one map, and delete any that is only a null.',
};

const NOT_A_MAP = "shortcuts file isn't a map of names to definitions";

// A node's span; a tag or anchor on no value's, which its range leaves out.
function spanOf(text, node) {
  const [start, end] = node.range;
  if (start < end) return [start, end];
  const before = text.slice(0, start).trimEnd().length;
  return [text.slice(0, before).search(/\S+$/), before];
}

// Where the line `at` is on ends, before any carriage return.
function lineEnd(text, at) {
  const nl = text.indexOf('\n', at);
  const end = nl === -1 ? text.length : nl;
  return end > at && text[end - 1] === '\r' ? end - 1 : end;
}

// The pairs of `map` keystone reads: a key an alias writes is what it
// names, and a list or map used as a key is dropped with all it holds.
const pairsOf = (doc, map) =>
  map.items.filter(({ key }) => {
    const named = isAlias(key) ? key.resolve(doc) : key;
    return named !== undefined && !isMap(named) && !isSeq(named);
  });

// Each null under `node`, at `path`: the key that holds it, or the list
// item it is, spanning from there to the null's end.
function nulls(text, doc, node, path) {
  const out = [];
  if (isMap(node)) {
    for (const { key, value } of pairsOf(doc, node)) {
      const at = [...path, keyName(key)];
      if (isNull(value)) {
        const [start, keyEnd] = key.range;
        out.push({ at, start, end: Math.max(keyEnd, value?.range[1] ?? 0) });
      } else {
        out.push(...nulls(text, doc, value, at));
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
        out.push(...nulls(text, doc, item, at));
      }
    });
  }
  return out;
}

// The errors of each key repeated in its map, and each list or map used
// as a key, under `node` at `at`. A repeat is the same text, as keystone
// reads keys: `1` repeats "1", `~` stays apart from `null`, and a merge
// key repeats only a merge key. An alias key is what it names.
function keys(path, text, doc, node, at) {
  const out = [];
  if (isMap(node)) {
    const seen = new Map();
    for (const { key, value } of node.items) {
      const named = isAlias(key) ? key.resolve(doc) : key;
      if (named === undefined) {
        out.push(
          error(
            path,
            text,
            'yaml-syntax',
            { problem: `alias *${key.source} names no anchor` },
            ...key.range,
          ),
        );
        continue;
      }
      if (isMap(named) || isSeq(named)) {
        out.push(
          error(
            path,
            text,
            'shortcut-complex-key',
            {
              problem: `a ${isMap(named) ? 'map' : 'list'} is used as a key${at.length > 0 ? ` in ${pathOf(at)}` : ''}`,
              because: 'Keys are names, written as text.',
            },
            ...key.range,
          ),
        );
        continue;
      }
      const name = [...at, keyName(key)];
      if (isScalar(named)) {
        const same =
          named.type === 'PLAIN' && named.source === '<<'
            ? '<<'
            : `=${named.source}`;
        const first = seen.get(same);
        if (first === undefined) seen.set(same, keySpan(text, key));
        else
          out.push(
            error(
              path,
              text,
              'shortcut-duplicate-key',
              {
                problem: `key ${pathOf(name)} is written again`,
                offenders: [offender(path, text, first[0])],
                because: 'A map holds each key once.',
                remedy: 'Delete all but one.',
              },
              ...keySpan(text, key),
            ),
          );
      }
      out.push(...keys(path, text, doc, value, name));
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, k) => {
      out.push(...keys(path, text, doc, item, [...at, k + 1]));
    });
  }
  return out;
}

// A key's span; an empty key's, the colon after it.
function keySpan(text, key) {
  const [start, end] = key.range;
  if (start < end) return [start, end];
  const colon = start + Math.max(0, text.slice(start).search(/\S/));
  return [colon, colon + 1];
}

// The place `start` is, and its line from there, as an offender.
function offender(path, text, start) {
  const { line, column } = lineAndColumn(text, start);
  return `${path}:${line}:${column}: ${text.slice(start, lineEnd(text, start))}`;
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
