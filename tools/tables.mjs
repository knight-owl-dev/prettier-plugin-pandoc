// The tables pandoc-parser takes from Pandoc's data and its libraries'
// sources, generated again at the versions `upstream.json` names: when one
// of them moves (docs/bumping-pandoc.md). Unmoved, it writes each table as
// it is.
//
//   node tools/tables.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { unpack } from './lib/hackage.mjs';
import { ROOT } from './lib/run.mjs';

const SRC = join(ROOT, 'packages/pandoc-parser/src');
const upstream = JSON.parse(
  readFileSync(join(ROOT, 'packages/pandoc-parser/upstream.json'), 'utf8'),
);
// A followed library's source; Pandoc's at the release its data was taken
// from.
const source = (name) => unpack(`${name}-${upstream.libraries[name].version}`);
const pandocAt = (path) => unpack(`pandoc-${upstream.data[path]}`);

// GHC's names for the ASCII control characters, by code point.
const CONTROL = [
  'NUL',
  'SOH',
  'STX',
  'ETX',
  'EOT',
  'ENQ',
  'ACK',
  'BEL',
  'BS',
  'HT',
  'LF',
  'VT',
  'FF',
  'CR',
  'SO',
  'SI',
  'DLE',
  'DC1',
  'DC2',
  'DC3',
  'DC4',
  'NAK',
  'SYN',
  'ETB',
  'CAN',
  'EM',
  'SUB',
  'ESC',
  'FS',
  'GS',
  'RS',
  'US',
  'SP',
];
const SINGLE = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };

/**
 * The text of a Haskell string or character literal's body.
 *
 * @param {string} body Between its quotes.
 */
function haskell(body) {
  let out = '';
  for (let at = 0; at < body.length; ) {
    if (body[at] !== '\\') {
      const c = String.fromCodePoint(body.codePointAt(at));
      out += c;
      at += c.length;
      continue;
    }
    const rest = body.slice(at + 1);
    const m =
      /^(?:(\d+)|x([0-9a-fA-F]+)|o([0-7]+)|\^([@-_])|(DEL)|([A-Z][A-Z0-9]{1,2})|(&)|(\s+\\))/.exec(
        rest,
      );
    if (m === null) {
      out += rest[0] in SINGLE ? String.fromCharCode(SINGLE[rest[0]]) : rest[0];
      at += 2;
      continue;
    }
    const [all, dec, hex, oct, caret, del, name] = m;
    if (dec) out += String.fromCodePoint(Number(dec));
    else if (hex) out += String.fromCodePoint(Number.parseInt(hex, 16));
    else if (oct) out += String.fromCodePoint(Number.parseInt(oct, 8));
    else if (caret) out += String.fromCharCode(caret.charCodeAt(0) - 64);
    else if (del) out += '\x7f';
    else if (name) {
      // The longest name that is GHC's: `\SOH` before `\SO`.
      const known = [name, name.slice(0, 2)].find((n) => CONTROL.includes(n));
      if (known === undefined) throw new Error(`unknown escape \\${name}`);
      out += known === 'SP' ? ' ' : String.fromCharCode(CONTROL.indexOf(known));
      at += 1 + known.length;
      continue;
    }
    at += 1 + all.length;
  }
  return out;
}

// Each string literal in `text`, its text.
const strings = (text) =>
  [...text.matchAll(/"((?:[^"\\]|\\[\s\S])*)"/g)].map((m) => haskell(m[1]));

// The text of the Haskell list `name = [ … ]` defines in `text`.
function list(text, name) {
  const start = text.search(new RegExp(`^${name}\\s*=`, 'm'));
  if (start < 0) throw new Error(`no ${name}`);
  const open = text.indexOf('[', start);
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    const c = text[at];
    if (c === '"') {
      at++;
      while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    } else if (c === '-' && text[at + 1] === '-') {
      at = text.indexOf('\n', at);
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return text.slice(open, at + 1);
  }
  throw new Error(`${name} unclosed`);
}

const escaped = (s) =>
  [...s]
    .map((c) => `\\u{${c.codePointAt(0).toString(16).toUpperCase()}}`)
    .join('');
const quoted = (s) =>
  s.includes("'") && !s.includes('"')
    ? `"${s.replaceAll('\\', '\\\\')}"`
    : `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const lines = (xs) => xs.map((x) => `  ${x},\n`).join('');
const DISABLE = '// cspell:disable\n\n';

async function textWidth() {
  const doclayout = await source('doclayout');
  const emojis = await source('emojis');
  const spec = readFileSync(
    join(doclayout, 'src/Text/unicodeWidth.inc'),
    'utf8',
  );
  const classes = {
    Narrow: 'N',
    Wide: 'W',
    Combining: 'C',
    Control: 'X',
    Ambiguous: 'A',
  };
  const ranges = [
    ...list(spec, 'unicodeSpec').matchAll(
      /\(\s*'((?:[^'\\]|\\[^']+|\\')+)'\s*,\s*(\w+)\s*\)/g,
    ),
  ].map(([, c, cls]) => {
    if (!(cls in classes)) throw new Error(`unknown width ${cls}`);
    return `[0x${haskell(c).codePointAt(0).toString(16)}, '${classes[cls]}']`;
  });
  const inc = readFileSync(join(emojis, 'src/Text/emojis.inc'), 'utf8');
  const base = strings(list(inc, 'baseEmojis')).map((e) => `'${escaped(e)}'`);
  return `// Unicode's display widths and the base emoji, as doclayout reads them: its
// \`unicodeSpec\`, each range by its first code point and width (Narrow, Wide,
// Combining, Control, Ambiguous), and emojis' \`baseEmojis\`. Generated from
// those packages' tables.

${DISABLE}export const UNICODE_SPEC = [\n${lines(ranges)}];

export const BASE_EMOJIS = [\n${lines(base)}];\n`;
}

// An XML attribute's value, its entities resolved.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const attribute = (tag, name) =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`)
    .exec(tag)?.[1]
    .replace(/&(\w+);/g, (e, n) => ENTITIES[n] ?? e) ?? '';

async function syntaxes() {
  const dir = join(await source('skylighting-core'), 'xml');
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.xml'))
    .map((f) => {
      const xml = readFileSync(join(dir, f), 'utf8').replace(
        /<!--[\s\S]*?-->/g,
        '',
      );
      const tag = /<language\s[^>]*>/.exec(xml)?.[0];
      if (tag === undefined) return null;
      // As `Skylighting.Parser` splits them: on `;` and white space.
      const globs = attribute(tag, 'extensions')
        .split(/[;\s]+/)
        .filter(Boolean);
      return [attribute(tag, 'name'), globs];
    })
    .filter((x) => x !== null)
    // Its syntax map's order: by name, a code point at a time.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const rows = found.map(
    ([name, globs]) => `[${quoted(name)}, [${globs.map(quoted).join(', ')}]]`,
  );
  return `// Skylighting's syntaxes by name, each with the file-name globs it is
// for, in the order of its syntax map. Generated from skylighting-core's
// syntax definitions, taking only these.

${DISABLE}export const SYNTAXES = [\n${lines(rows)}];\n`;
}

async function entities() {
  const commonmark = await source('commonmark');
  const hs = readFileSync(join(commonmark, 'src/Commonmark/Entity.hs'), 'utf8');
  const pairs = strings(list(hs, 'htmlEntities'));
  const rows = [];
  for (let k = 0; k < pairs.length; k += 2) {
    if (pairs[k].endsWith(';')) {
      rows.push(`[${quoted(pairs[k])}, '${escaped(pairs[k + 1])}']`);
    }
  }
  return `// The HTML5 named character references, by name and its semicolon, as
// commonmark's \`Commonmark.Entity.htmlEntities\` lists them: Pandoc
// resolves \`&name;\` through it. Generated from that table.

${DISABLE}export const NAMED_REFERENCES = new Map([\n${lines(rows)}]);\n`;
}

async function translations() {
  const dir = join(await pandocAt('data/translations'), 'data/translations');
  const langs = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const terms = parse(readFileSync(join(dir, f), 'utf8'), {
        schema: 'failsafe',
      });
      const fields = Object.entries(terms).map(
        ([term, text]) => `      ${term}: ${quoted(text)},\n`,
      );
      return `  [\n    ${quoted(f.slice(0, -5))},\n    {\n${fields.join('')}    },\n  ],\n`;
    });
  return `// Pandoc's translations of terms (\`data/translations\`), by language
// as its file names give it. Generated from those files.

${DISABLE}export const TRANSLATIONS = new Map([\n${langs.join('')}]);\n`;
}

async function abbreviations() {
  const file = join(await pandocAt('data/abbreviations'), 'data/abbreviations');
  const words = readFileSync(file, 'utf8')
    .split('\n')
    .filter((w) => w !== '');
  return `// Pandoc's default abbreviations (\`data/abbreviations\`): with \`smart\`,
// the space after one is a non-breaking space.

${DISABLE}export const ABBREVIATIONS = new Set([\n${lines(words.map(quoted))}]);\n`;
}

async function schemes() {
  const pandoc = await unpack(`pandoc-${upstream.modules['Text.Pandoc.URI']}`);
  const hs = readFileSync(join(pandoc, 'src/Text/Pandoc/URI.hs'), 'utf8');
  const names = strings(list(hs, 'schemes'));
  return `// The URI schemes Pandoc recognizes: IANA's, then unofficial ones in common
// use, as Pandoc's \`Text.Pandoc.URI.schemes\` lists them. Generated from
// that list.

${DISABLE}export const SCHEMES = [\n${lines(names.map(quoted))}];\n`;
}

const tables = {
  'text-width-table.js': await textWidth(),
  'skylighting/syntaxes.js': await syntaxes(),
  'entities-table.js': await entities(),
  'translations-table.js': await translations(),
  'abbreviations.js': await abbreviations(),
  'uri-schemes.js': await schemes(),
};
for (const [file, text] of Object.entries(tables)) {
  writeFileSync(join(SRC, file), text);
  console.log(file);
}
