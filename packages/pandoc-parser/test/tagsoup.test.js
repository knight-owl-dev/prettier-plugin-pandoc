// TagSoup's tokenizer, against TagSoup 0.14.8's own tests (`test/TagSoup/
// Test.hs`): `parseTests`, `entityTests`, and `optionsTests`' invariants.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lookupNamedEntity,
  lookupNumericEntity,
} from '../src/tagsoup/entity.js';
import {
  canonicalizeTag,
  parseOptions,
  parseTags,
  parseTagsOptions,
} from '../src/tagsoup/parser.js';

// A tag as Haskell's `Show` would name its parts.
const open = (name, attrs = []) => ({ t: 'TagOpen', name, attrs });
const close = (name) => ({ t: 'TagClose', name });
const text = (t) => ({ t: 'TagText', text: t });

// cspell:disable
const PARSE = [
  ['<!DOCTYPE TEST>', [open('!DOCTYPE', [['TEST', '']])]],
  [
    '<test "foo bar">',
    [
      open('test', [
        ['"foo', ''],
        ['bar"', ''],
      ]),
    ],
  ],
  [
    '<test baz "foo">',
    [
      open('test', [
        ['baz', ''],
        ['"foo"', ''],
      ]),
    ],
  ],
  [
    "<test 'foo bar'>",
    [
      open('test', [
        ["'foo", ''],
        ["bar'", ''],
      ]),
    ],
  ],
  [
    "<test bar=''' />",
    [
      open('test', [
        ['bar', ''],
        ["'", ''],
      ]),
      close('test'),
    ],
  ],
  [
    '<test2 a b>',
    [
      open('test2', [
        ['a', ''],
        ['b', ''],
      ]),
    ],
  ],
  ["<test2 ''>", [open('test2', [["''", '']])]],
  ['</test foo>', [close('test')]],
  ['<test/>', [open('test'), close('test')]],
  ['<test1 a = b>', [open('test1', [['a', 'b']])]],
  ['hello &amp; world', [text('hello & world')]],
  ['hello &#64; world', [text('hello @ world')]],
  ['hello &#x40; world', [text('hello @ world')]],
  ['hello &#X40; world', [text('hello @ world')]],
  ['hello &haskell; world', [text('hello &haskell; world')]],
  ['hello \n\t world', [text('hello \n\t world')]],
  [
    '<a href=http://www.google.com>',
    [open('a', [['href', 'http://www.google.com']])],
  ],
  ['<foo bar="bar&#54;baz">', [open('foo', [['bar', 'bar6baz']])]],
  ['<foo bar="bar&amp;baz">', [open('foo', [['bar', 'bar&baz']])]],
  ['hey &how are you', [text('hey &how are you')]],
  ['hey &how; are you', [text('hey &how; are you')]],
  ['hey &amp are you', [text('hey & are you')]],
  ['hey &amp; are you', [text('hey & are you')]],
  ['&nwarr;x&ngeqq;', [text('↖x≧̸')]],
  ['test &#10933649; test', [text('test ? test')]],
  [
    '<a href="series.php?view=single&ID=72710">',
    [open('a', [['href', 'series.php?view=single&ID=72710']])],
  ],
  [
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
    [
      open('!DOCTYPE', [
        ['HTML', ''],
        ['PUBLIC', ''],
        ['', '-//W3C//DTD HTML 4.01//EN'],
        ['', 'http://www.w3.org/TR/html4/strict.dtd'],
      ]),
    ],
  ],
  [
    '<script src="http://edge.jobthread.com/feeds/jobroll/?s_user_id=100540&subtype=slashdot">',
    [
      open('script', [
        [
          'src',
          'http://edge.jobthread.com/feeds/jobroll/?s_user_id=100540&subtype=slashdot',
        ],
      ]),
    ],
  ],
  [
    "<a title='foo'bar' href=correct>text",
    [
      open('a', [
        ['title', 'foo'],
        ["bar'", ''],
        ['href', 'correct'],
      ]),
      text('text'),
    ],
  ],
  [
    '<test><![CDATA[Anything goes, <em>even hidden markup</em> &amp; entities]]> but this is outside</test>',
    [
      open('test'),
      text(
        'Anything goes, <em>even hidden markup</em> &amp; entities but this is outside',
      ),
      close('test'),
    ],
  ],
  ['<a \r\n href="url">', [open('a', [['href', 'url']])]],
  [
    "<a href='random.php'><img src='strips/130307.jpg' alt='nukular bish'' title='' /></a>",
    [
      open('a', [['href', 'random.php']]),
      open('img', [
        ['src', 'strips/130307.jpg'],
        ['alt', 'nukular bish'],
        ["'", ''],
        ['title', ''],
      ]),
      close('img'),
      close('a'),
    ],
  ],
  [
    '<p>some text</p\n<img alt=\'&lt; &yyy; &gt;\' src="abc.gif">',
    [open('p'), text('some text'), close('p')],
  ],
  [
    '<script> if (x<bomb) </script>',
    [open('script'), text(' if (x<bomb) '), close('script')],
  ],
  ['<script> if (x<bomb) ', [open('script'), text(' if (x<bomb) ')]],
  [
    '<SCRIPT language=foo> if (x<bomb) </SCRIPT>',
    [
      open('SCRIPT', [['language', 'foo']]),
      text(' if (x<bomb) '),
      close('SCRIPT'),
    ],
  ],
  ['<script /><test>', [open('script'), close('script'), open('test')]],
  ['one &mid; two', [text('one ∣ two')]],
  ['one &mid two', [text('one &mid two')]],
  ['one &micro; two', [text('one µ two')]],
  ['one &micro two', [text('one µ two')]],
];
// cspell:enable

for (const [input, want] of PARSE) {
  test(`parseTags ${JSON.stringify(input)}`, () => {
    assert.deepEqual([...parseTags(input)], want);
  });
}

test('lookupNumericEntity and lookupNamedEntity', () => {
  assert.equal(lookupNumericEntity('65'), 'A');
  assert.equal(lookupNumericEntity('x41'), 'A');
  assert.equal(lookupNumericEntity('x4E'), 'N');
  assert.equal(lookupNumericEntity('x4e'), 'N');
  assert.equal(lookupNumericEntity('X4e'), 'N');
  assert.equal(lookupNumericEntity('Haskell'), undefined);
  assert.equal(lookupNumericEntity(''), undefined);
  assert.equal(lookupNumericEntity('89439085908539082'), undefined);
  assert.equal(lookupNamedEntity('amp'), '&');
  assert.equal(lookupNamedEntity('haskell'), undefined);
});

// HTML for the options' invariants: TagSoup's generator draws from these
// pieces too.
const SAMPLES = [
  '<a href="x">text &amp; more</a><!-- c --><br/>',
  'x < y &unknown; z&#65;<b',
  "<p class=a'b>one\ntwo</p><script>a<b</script>",
  '<?xml version="1.0"?><!DOCTYPE html><img src=\'a\' alt="b">',
  '&&amp &#x; </> <> <!--> <!---> <!-- a -- b --!> tail',
];

for (const html of SAMPLES) {
  test(`options' invariants: ${JSON.stringify(html)}`, () => {
    for (const tagPosition of [false, true]) {
      for (const tagWarning of [false, true]) {
        for (const tagTextMerge of [false, true]) {
          const options = {
            ...parseOptions,
            tagPosition,
            tagWarning,
            tagTextMerge,
          };
          const tags = [...parseTagsOptions(options, html)];
          const is = (t) => (tag) => tag.t === t;
          if (!tagWarning) assert.ok(!tags.some(is('TagWarning')));
          if (!tagPosition) assert.ok(!tags.some(is('TagPosition')));
          if (tagPosition) {
            // Each tag after a position, positions increasing.
            for (let i = 0; i < tags.length; i += 2) {
              assert.equal(tags[i].t, 'TagPosition');
              assert.notEqual(tags[i + 1]?.t, 'TagPosition');
              if (i > 0) assert.ok(tags[i].offset >= tags[i - 2].offset);
            }
          }
          if (tagTextMerge) {
            let canText = true;
            for (const tag of tags) {
              if (tag.t === 'TagText') {
                assert.ok(canText, 'adjacent texts');
                canText = false;
              } else if (tag.t !== 'TagPosition' && tag.t !== 'TagWarning') {
                canText = true;
              }
            }
          }
        }
      }
    }
  });
}

test('positions: rows and columns from 1, a tab to a multiple of 8', () => {
  const options = { ...parseOptions, tagPosition: true };
  const tags = [...parseTagsOptions(options, '<a>\n\t<b>')];
  const positions = tags.filter((t) => t.t === 'TagPosition');
  assert.deepEqual(
    positions.map(({ row, column }) => [row, column]),
    [
      [1, 1],
      [1, 4],
      [2, 9],
    ],
  );
});

test('lazily: the first tag without lexing the rest', () => {
  const tags = parseTags(`<a>${'x'.repeat(1e6)}`);
  assert.deepEqual(tags.next().value, open('a'));
});

test('canonicalizeTags', () => {
  assert.deepEqual(canonicalizeTag(open('!doctype')), open('!DOCTYPE'));
  assert.deepEqual(
    canonicalizeTag(open('DIV', [['CLASS', 'X']])),
    open('div', [['class', 'X']]),
  );
  assert.deepEqual(canonicalizeTag(close('ß')), close('ß'));
});
