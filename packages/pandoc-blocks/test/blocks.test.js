import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/index.js';

// The fence lines each div was found at, as text, so a failure reads as
// markup rather than offsets.
function fences(text) {
  return blocks(text).map(({ open, close }) => [
    text.slice(open.start, open.end),
    close === null ? null : text.slice(close.start, close.end),
  ]);
}

test('a div opens at the start of the document', () => {
  assert.deepEqual(fences('::: note\ntext\n:::\n'), [['::: note', ':::']]);
});

test('an attribute block opens a div as a bare class does', () => {
  assert.deepEqual(fences('::: {.aside type="note"}\ntext\n:::\n'), [
    ['::: {.aside type="note"}', ':::'],
  ]);
});

test('a fence a paragraph could continue into is its text', () => {
  assert.deepEqual(fences('prose\n::: note\ntext\n:::\n'), []);
});

test('a fence a list item could continue into is its text', () => {
  assert.deepEqual(fences('- item\n::: note\ntext\n:::\n'), []);
});

for (const [name, before] of [
  ['a heading', '# Heading'],
  ['an HTML comment', '<!-- note -->'],
  ['a raw TeX environment', '\\begin{center}\nx\n\\end{center}'],
]) {
  test(`a fence right after ${name} opens a div`, () => {
    assert.deepEqual(fences(`${before}\n::: note\ntext\n:::\n`), [
      ['::: note', ':::'],
    ]);
  });
}

test('a close ends the paragraph it interrupts', () => {
  assert.deepEqual(fences('::: note\ntext\n:::\nafter\n'), [
    ['::: note', ':::'],
  ]);
});

test('divs nest, each close taking the innermost open', () => {
  assert.deepEqual(fences('::: outer\n::: inner\ntext\n:::\n:::\n'), [
    ['::: outer', ':::'],
    ['::: inner', ':::'],
  ]);
});

test('a div never closed runs to the end of the document', () => {
  assert.deepEqual(fences('::: note\ntext\n'), [['::: note', null]]);
});

test('a close with nothing open is text', () => {
  assert.deepEqual(fences('text\n\n:::\n'), []);
});

test('fences inside a code block are code', () => {
  const text = '```markdown\n::: note\n:::\n```\n';
  assert.deepEqual(fences(text), []);
});

test('a longer code fence is not closed by a shorter one', () => {
  const text = '````\n```\n::: note\n:::\n```\n````\n';
  assert.deepEqual(fences(text), []);
});
