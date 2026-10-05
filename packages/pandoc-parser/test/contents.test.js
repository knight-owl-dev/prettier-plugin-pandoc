// A container's contents as the reader read them: each child's span maps in
// and back out, and a quote's contents read again are its blocks. A list
// item's are read in a list item's context, which a fresh read lacks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarkdown, withoutSpans } from '../src/index.js';
import { TAB_STOPS } from './helpers/oracle.js';

const CASES = {
  'a block quote': '> a\n> b\n>\n> > nested\n> lazy\n',
  'a quote without spaces': '>a\n>b\n',
  'a bullet list': '- one\n  two\n\n  three\n- four\n',
  'a loose list': '- one\n\n- two\n\n      code\n',
  'an ordered list': '1. one\n2. two\n   more\n',
  'a list in a quote': '> - x\n>   y\n>\n>       code\n',
  'a quote in a list': '- one\n\n  > q\n  lazy\n',
  'nested lists': '- a\n  - b\n    - c\n\n      d\n',
  'a definition list': 'Term\n:   def\n\n    more\n\nOther\n\n:   loose\n',
  tabs: '-\tt\n\t\tcode\n\n>\tq\n',
  'a task list': '- [ ] todo\n- [x] done\n',
  'carriage returns': '> a\r\n> b\r\n',
};

const PLAIN = { t: 'Para' };

// Blocks to compare: spans left out, and plain as a paragraph, which a list
// decides as a whole.
const comparable = (blocks) =>
  JSON.stringify(withoutSpans(blocks), (_, v) =>
    v?.t === 'Plain' ? { ...PLAIN, c: v.c } : v,
  );

// Each list of blocks carrying its contents, and whether a quote holds it.
function containers(value, out = [], quote = false) {
  if (Array.isArray(value)) {
    if (value.contents !== undefined && value.some((b) => b?.t)) {
      out.push({ list: value, quote });
    }
    for (const v of value) containers(v, out);
  } else if (value !== null && typeof value === 'object') {
    const inQuote = value.t === 'BlockQuote';
    for (const v of Object.values(value)) containers(v, out, inQuote);
  }
  return out;
}

for (const [name, source] of Object.entries(CASES)) {
  for (const tabStop of TAB_STOPS) {
    test(`${name} (tab stop ${tabStop})`, () => {
      const lists = containers(readMarkdown(source, { tabStop }).blocks);
      assert.ok(lists.length > 0);
      for (const { list, quote } of lists) {
        const { contents } = list;
        let last = 0;
        for (const b of list) {
          const from = contents.toInnerStart(b.start);
          const to = contents.toInnerEnd(b.end);
          assert.ok(last <= from && from <= to, `${b.t} in order`);
          assert.equal(contents.toOuterStart(from), b.start);
          assert.equal(contents.toOuterEnd(to), b.end);
          last = to;
        }
        if (!quote) continue;
        const read = readMarkdown(contents.text, { tabStop }).blocks;
        assert.equal(comparable(read), comparable(list));
      }
    });
  }
}
