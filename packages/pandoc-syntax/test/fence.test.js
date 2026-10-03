// Which lines open fenced code.
//
// Pandoc takes a fence's info only as a language, an attribute block, both,
// or a raw attribute; anything else leaves the lines paragraph text. The
// recognizer must find the code blocks Pandoc's parse holds.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pandocKinds, recognizerKinds } from './helpers/kinds.js';
import { TAB_STOPS } from './helpers/pandoc.js';

const OPENERS = {
  'no info': '```',
  'spaces after the fence': '```   ',
  'a language': '```js',
  'a language, then attributes': '``` js {.x}',
  'attributes straight after a language': '```js{.x}',
  'an identifier, a class and a key': '```{#i .c k="v"}',
  'an unquoted value': '```{k=v}',
  'a dash': '```{-}',
  'two words': '```js two words',
  'attributes, then text': '```{.x} trailing',
  'two attribute blocks': '```{.x}{.y}',
  'spaces in a raw attribute': '``` { = latex }',
  'a backtick in a tilde fence': '~~~ a`b',
  'two words after tildes': '~~~ x y',
};

for (const [name, opener] of Object.entries(OPENERS)) {
  const close = opener[0].repeat(3);
  const text = `${opener}\ncode\n${close}\n`;
  for (const tabStop of TAB_STOPS) {
    test(`${name}: the recognizer finds what Pandoc does (tab stop ${tabStop})`, () => {
      assert.deepEqual(
        recognizerKinds(text, tabStop),
        pandocKinds(text, tabStop),
      );
    });
  }
}
