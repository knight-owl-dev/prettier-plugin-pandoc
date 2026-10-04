// BCP 47 tags parsed and rendered as unicode-collation's `Text.Collate.Lang`
// does, its leniencies included.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lang,
  lookupLang,
  parseLang,
  renderLang,
} from '../src/collate/lang.js';

const round = (s) => {
  const l = parseLang(s);
  return l === null ? null : renderLang(l);
};

test('subtags cased by kind, split at - or _', () => {
  assert.equal(round('EN-us'), 'en-US');
  assert.equal(round('zh_hant_tw'), 'zh-Hant-TW');
  assert.equal(round('es-419'), 'es-419');
  assert.equal(round('de-DE-1901'), 'de-DE-1901');
  assert.equal(round('sl-rozaj-biske'), 'sl-rozaj-biske');
});

test('extended languages, extensions and private use', () => {
  assert.equal(round('zh-yue-HK'), 'zh-yue-HK');
  assert.equal(round('de-u-co-phonebk'), 'de-u-co-phonebk');
  assert.equal(round('en-a-bbb-x-a-ccc'), 'en-a-bbb-x-a-ccc');
  // `x` is a singleton, read as an extension before private use is tried.
  assert.deepEqual(parseLang('en-x-foo').extensions, [['x', [['foo', '']]]]);
});

test('what follows the tag is allowed; no language is no tag', () => {
  assert.equal(round('fr-CA garbage'), 'fr-CA');
  assert.equal(round('en-US-!!'), 'en-US');
  assert.equal(parseLang('e'), null);
  assert.equal(parseLang('123'), null);
  assert.equal(parseLang(''), null);
});

test('lookupLang: the language must match, then script, region, collation', () => {
  const pairs = [
    [lang('en'), 'en'],
    [lang('en', { region: 'GB' }), 'en-GB'],
    [lang('fr'), 'fr'],
  ];
  assert.equal(lookupLang(lang('en', { region: 'GB' }), pairs)[1], 'en-GB');
  assert.equal(lookupLang(lang('en', { region: 'US' }), pairs)[1], 'en');
  assert.equal(lookupLang(lang('de'), pairs), null);
});
