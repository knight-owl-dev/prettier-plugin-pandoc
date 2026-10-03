// Documents built by hand serialize as Pandoc's JSON of the same text: the
// node shapes, the enumerations and the records as Aeson encodes them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthorInText,
  B,
  citation,
  Decimal,
  doc,
  Period,
  SuppressAuthor,
  withoutSpans,
} from '../src/index.js';
import { pandocAst } from './helpers/oracle.js';

const attr = (id = '', classes = [], pairs = []) => [id, classes, pairs];

const CASES = {
  'inline constructors': {
    text: [
      'Hello *world*  ',
      'next `c`{.x} $m$ $$d$$ \\LaTeX{} H~2~O x^2^ ~~gone~~ [sc]{.smallcaps}',
      '[u]{.underline} \'q\' "d"',
    ].join('\n'),
    blocks: () =>
      B.para(
        B.concat([
          B.text('Hello '),
          B.emph(B.str('world')),
          B.linebreak(),
          B.text('next '),
          B.codeWith(attr('', ['x']), 'c'),
          B.space(),
          B.math('m'),
          B.space(),
          B.displayMath('d'),
          B.space(),
          B.rawInline('tex', '\\LaTeX{}'),
          B.text(' H'),
          B.subscript(B.str('2')),
          B.text('O x'),
          B.superscript(B.str('2')),
          B.space(),
          B.strikeout(B.str('gone')),
          B.space(),
          B.smallcaps(B.str('sc')),
          B.softbreak(),
          B.underline(B.str('u')),
          B.space(),
          B.singleQuoted(B.str('q')),
          B.space(),
          B.doubleQuoted(B.str('d')),
        ]),
      ),
  },
  'links, images, notes and raw HTML': {
    text: [
      'See [link](http://x "T") and ![alt](i.png){width=1}[^1] and <b>raw</b>.',
      '',
      '[^1]: A note.',
    ].join('\n'),
    blocks: () =>
      B.para(
        B.concat([
          B.text('See '),
          B.link('http://x', 'T', B.str('link')),
          B.text(' and '),
          B.imageWith(
            attr('', [], [['width', '1']]),
            'i.png',
            '',
            B.str('alt'),
          ),
          B.note(B.para(B.text('A note.'))),
          B.text(' and '),
          B.rawInline('html', '<b>'),
          B.str('raw'),
          B.rawInline('html', '</b>'),
          B.str('.'),
        ]),
      ),
  },
  'containers and lists': {
    text: [
      '> quote',
      '',
      '- a',
      '- b',
      '',
      '3. c',
      '4. d',
      '',
      'Term',
      ':   def',
      '',
      '| line one',
      '|   two',
    ].join('\n'),
    blocks: () => [
      ...B.blockQuote(B.para(B.str('quote'))),
      ...B.bulletList([B.plain(B.str('a')), B.plain(B.str('b'))]),
      ...B.orderedListWith(
        [3, Decimal, Period],
        [B.plain(B.str('c')), B.plain(B.str('d'))],
      ),
      ...B.definitionList([[B.str('Term'), [B.plain(B.str('def'))]]]),
      ...B.lineBlock([B.text('line one'), B.str('\u00a0\u00a0two')]),
    ],
  },
  'headers, rules, code and divs': {
    text: [
      '# Head {#h .c}',
      '',
      '***',
      '',
      '``` {.py}',
      'code',
      '```',
      '',
      '::: {#d .w}',
      'in div',
      ':::',
      '',
      '<div>html</div>',
    ].join('\n'),
    blocks: () => [
      ...B.headerWith(attr('h', ['c']), 1, B.str('Head')),
      ...B.horizontalRule(),
      ...B.codeBlockWith(attr('', ['py']), 'code'),
      ...B.divWith(attr('d', ['w']), B.para(B.text('in div'))),
      ...B.divWith(attr(), B.plain(B.str('html'))),
    ],
  },
  citations: {
    text: '[@a, p. 3; -@b] and @c [p. 1].',
    blocks: () =>
      B.para(
        B.concat([
          B.cite(
            [
              citation({
                id: 'a',
                suffix: B.text(', p. 3'),
                noteNum: 1,
              }),
              citation({ id: 'b', mode: SuppressAuthor, noteNum: 1 }),
            ],
            B.text('[@a, p. 3; -@b]'),
          ),
          B.text(' and '),
          B.cite(
            [
              citation({
                id: 'c',
                suffix: B.str('p. 1'),
                mode: AuthorInText,
                noteNum: 2,
              }),
            ],
            B.text('@c [p. 1]'),
          ),
          B.str('.'),
        ]),
      ),
  },
};

for (const [name, { text, blocks }] of Object.entries(CASES)) {
  test(`${name}: built by hand, the JSON Pandoc writes`, () => {
    assert.deepEqual(withoutSpans(doc(blocks())), pandocAst(`${text}\n`));
  });
}

test('a figure: caption and image as Pandoc writes them', () => {
  const image = B.image('i.png', 't', B.str('cap'));
  const figure = B.figure(
    B.simpleCaption(B.plain(B.str('cap'))),
    B.plain(image),
  );
  assert.deepEqual(withoutSpans(doc(figure)), pandocAst('![cap](i.png "t")\n'));
});

test('spans stay off the JSON, metadata keys named like them stay on', () => {
  const meta = { start: { t: 'MetaString', c: 'x' } };
  const built = withoutSpans(doc(B.para(B.str('a', 0, 1)), meta));
  assert.deepEqual(built.blocks, [{ t: 'Para', c: [{ t: 'Str', c: 'a' }] }]);
  assert.deepEqual(built.meta, meta);
});
