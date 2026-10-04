// HTML as TagSoup reads it: a stream of tags, opening and closing ones,
// text, comments, warnings and positions, made from the lexer's tokens.
//
// Ported from TagSoup 0.14.8's `Text.HTML.TagSoup.Implementation` (its top
// layer), `Options`, `Parser` and `Type`, and `canonicalizeTags`. The tags
// come on demand: a consumer of the first ones lexes no further, as
// Haskell's laziness has it.

import { toLower, toUpper } from '../data-char.js';
import { codePointText, lookupEntity } from './entity.js';
import {
  ATT_NAME,
  ATT_VAL,
  CHAR,
  COMMENT,
  COMMENT_END,
  ENTITY_END,
  ENTITY_HEX,
  ENTITY_NAME,
  ENTITY_NUM,
  Lexer,
  POS,
  TAG,
  TAG_END,
  TAG_END_CLOSE,
  TAG_SHUT,
  WARN,
} from './lexer.js';

/**
 * A tag: `TagOpen` with its `name` and `attrs`, `TagClose` with its `name`,
 * `TagText`, `TagComment` or `TagWarning` with its `text`, or
 * `TagPosition` with the `row` and `column` of what follows, from 1, and
 * its `offset` in the text.
 *
 * @see Text.HTML.TagSoup.Type.Tag
 * @typedef {{t: string, name?: string, attrs?: [string, string][], text?: string, row?: number, column?: number, offset?: number}} Tag
 */

/**
 * How to parse: whether to give positions and warnings, whether to merge
 * adjacent text, and how to resolve a reference in text and in an attribute
 * value from its name and whether `;` ended it.
 *
 * @see Text.HTML.TagSoup.Options.ParseOptions
 * @typedef {object} ParseOptions
 * @property {boolean} tagPosition
 * @property {boolean} tagWarning
 * @property {(name: string, semi: boolean) => Tag[]} entityData
 * @property {(name: string, semi: boolean) => [string, Tag[]]} entityAttrib
 * @property {boolean} tagTextMerge
 */

/**
 * Options resolving references through `lookup`: an unknown one kept as
 * written, with a warning.
 *
 * @see Text.HTML.TagSoup.Options.parseOptionsEntities
 * @param {(name: string) => string | undefined} lookup
 * @returns {ParseOptions}
 */
export function parseOptionsEntities(lookup) {
  const entityAttrib = (name, semi) => {
    const written = semi ? `${name};` : name;
    const found = lookup(written);
    if (found !== undefined) return [found, []];
    return [`&${written}`, [warning(`Unknown entity: ${name}`)]];
  };
  return {
    tagPosition: false,
    tagWarning: false,
    entityData: (name, semi) => {
      const [text, warnings] = entityAttrib(name, semi);
      return [{ t: 'TagText', text }, ...warnings];
    },
    entityAttrib,
    tagTextMerge: true,
  };
}

/**
 * The default options, resolving references as HTML5 does.
 *
 * @see Text.HTML.TagSoup.Options.parseOptions
 */
export const parseOptions = parseOptionsEntities(lookupEntity);

const warning = (text) => ({ t: 'TagWarning', text });

/**
 * The row and column of offsets in what `lexer` reads, from `from`: a line
 * feed starts a row, a tab goes to the next column after a multiple of 8.
 *
 * @see Text.HTML.TagSoup.Type.positionChar
 * @param {Lexer} lexer
 * @param {number} from
 */
function positionsOf(lexer, from) {
  let [at, row, column] = [from, 1, 1];
  return (offset) => {
    if (offset < at) [at, row, column] = [from, 1, 1];
    while (at < offset) {
      const c = lexer.hd(at);
      if (c === '\n') [row, column] = [row + 1, 1];
      else if (c === '\t') column += 8 - ((column - 1) % 8);
      else column++;
      at = lexer.tl(at);
    }
    return { t: 'TagPosition', row, column, offset };
  };
}

/**
 * The value of a numeric reference's digits: its character, or `?` past
 * Unicode's code points.
 *
 * @see Text.HTML.TagSoup.Implementation.entityChr
 * @param {boolean} hex
 * @param {string} digits
 */
function entityChr(hex, digits) {
  const code = BigInt(hex ? `0x${digits}` : digits);
  return code <= 0x10ffffn ? codePointText(Number(code)) : '?';
}

/**
 * The tags of `text` from `from`, `suffix` read after it, as `options`
 * asks. A position past the text is in the suffix.
 *
 * @see Text.HTML.TagSoup.Parser.parseTagsOptions
 * @param {ParseOptions} options
 * @param {string} text
 * @param {number} [from]
 * @param {string} [suffix]
 * @returns {Generator<Tag>}
 */
export function* parseTagsOptions(options, text, from = 0, suffix = '') {
  const lexer = new Lexer(text, from, suffix);
  const tags = output(options, lexer, positionsOf(lexer, from));
  yield* options.tagTextMerge ? tagTextMerge(tags) : tags;
}

/**
 * The tags of `text`, with the default options.
 *
 * @see Text.HTML.TagSoup.Parser.parseTags
 * @param {string} text
 */
export const parseTags = (text) => parseTagsOptions(parseOptions, text);

/**
 * Tokens made tags.
 *
 * @see Text.HTML.TagSoup.Implementation.output
 * @param {ParseOptions} options
 * @param {Lexer} lexer
 * @param {(offset: number) => Tag} positionAt
 * @returns {Generator<Tag>}
 */
function* output(options, lexer, positionAt) {
  const { tagPosition, tagWarning } = options;
  let token = lexer.next();
  let p = 0;
  // Warnings waiting for the main loop, each with its position.
  let pending = [];

  const advance = () => {
    token = lexer.next();
  };
  // Past the token that should be of `kind`. TagSoup asserts it is, which
  // an optimized build such as Pandoc's leaves out: a tag left open at the
  // input's end has a warning there, and that goes instead.
  // @see Text.HTML.TagSoup.Implementation.skip
  // biome-ignore lint/correctness/noUnusedFunctionParameters: names the assertion
  const skip = (kind) => advance();
  const kind = () => token?.t;
  const positioned = (at, tag) => (tagPosition ? [positionAt(at), tag] : [tag]);
  const addWarnings = (at, tags) => {
    for (const w of tags) pending.push(...positioned(at, w));
  };

  // Characters, references resolved where `refs`, up to anything else;
  // positions passed record where the scan is.
  const chars = (refs) => {
    let s = '';
    for (;;) {
      const k = kind();
      if (k === CHAR) {
        s += token.c;
        advance();
      } else if (refs && k === ENTITY_NAME) {
        advance();
        const name = chars(false);
        const semi = token?.semi === true;
        skip(ENTITY_END);
        const [text, warnings] = options.entityAttrib(name, semi);
        if (tagWarning) addWarnings(p, warnings);
        s += text;
      } else if (refs && (k === ENTITY_NUM || k === ENTITY_HEX)) {
        advance();
        const digits = chars(false);
        skip(ENTITY_END);
        s += entityChr(k === ENTITY_HEX, digits);
      } else if (k === POS) {
        p = token.at;
        advance();
      } else if (k === WARN) {
        if (tagWarning) addWarnings(p, [warning(token.warn)]);
        advance();
      } else {
        return s;
      }
    }
  };

  // A tag's attributes, each a name and a value, either maybe empty.
  const attributes = () => {
    const attrs = [];
    for (;;) {
      if (kind() === ATT_NAME) {
        advance();
        const name = chars(false);
        let value = '';
        if (kind() === ATT_VAL) {
          advance();
          value = chars(true);
        }
        attrs.push([name, value]);
      } else if (kind() === ATT_VAL) {
        advance();
        attrs.push(['', chars(true)]);
      } else {
        return attrs;
      }
    }
  };

  for (;;) {
    if (pending.length > 0) {
      if (tagWarning) yield* pending;
      pending = [];
    }
    const k = kind();
    const at = p;
    if (k === undefined) return;
    if (k === POS) {
      p = token.at;
      advance();
    } else if (k === CHAR) {
      yield* positioned(at, { t: 'TagText', text: chars(false) });
    } else if (k === TAG) {
      advance();
      const name = chars(false);
      const attrs = attributes();
      yield* positioned(at, { t: 'TagOpen', name, attrs });
      if (kind() === TAG_END_CLOSE) {
        yield* positioned(at, { t: 'TagClose', name });
        advance();
      } else {
        skip(TAG_END);
      }
    } else if (k === TAG_SHUT) {
      advance();
      const name = chars(false);
      const attrs = attributes();
      yield* positioned(at, { t: 'TagClose', name });
      if (attrs.length > 0 && tagWarning) {
        yield* positioned(at, warning('Unexpected attributes in close tag'));
      }
      if (kind() === TAG_END_CLOSE) {
        if (tagWarning) {
          yield* positioned(
            at,
            warning('Unexpected self-closing in close tag'),
          );
        }
        advance();
      } else {
        skip(TAG_END);
      }
    } else if (k === COMMENT) {
      advance();
      yield* positioned(at, { t: 'TagComment', text: chars(false) });
      skip(COMMENT_END);
    } else if (k === ENTITY_NAME) {
      advance();
      const name = chars(false);
      const semi = token?.semi === true;
      for (const tag of options.entityData(name, semi)) {
        if (tagWarning || tag.t !== 'TagWarning') yield* positioned(at, tag);
      }
      skip(ENTITY_END);
    } else if (k === ENTITY_NUM || k === ENTITY_HEX) {
      advance();
      const text = entityChr(k === ENTITY_HEX, chars(false));
      yield* positioned(at, { t: 'TagText', text });
      skip(ENTITY_END);
    } else if (k === WARN) {
      if (tagWarning) yield* positioned(at, warning(token.warn));
      advance();
    } else {
      throw new Error(`TagSoup: ${k} out of place`);
    }
  }
}

const isText = (tag) => tag?.t === 'TagText';
const isPosition = (tag) => tag?.t === 'TagPosition';
const isWarning = (tag) => tag?.t === 'TagWarning';

/**
 * Adjacent texts merged into one, past the positions between them; past
 * warnings too, which then follow the merged text.
 *
 * @see Text.HTML.TagSoup.Implementation.tagTextMerge
 * @param {Iterator<Tag>} tags
 * @returns {Generator<Tag>}
 */
function* tagTextMerge(tags) {
  const buffer = [];
  const peek = (k) => {
    while (buffer.length <= k) {
      const next = tags.next();
      if (next.done) return undefined;
      buffer.push(next.value);
    }
    return buffer[k];
  };
  for (;;) {
    const first = peek(0);
    if (first === undefined) return;
    buffer.shift();
    if (!isText(first)) {
      yield first;
      continue;
    }
    let text = first.text;
    for (;;) {
      if (isText(peek(0))) {
        text += buffer.shift().text;
        continue;
      }
      if (isPosition(peek(0)) && isText(peek(1))) {
        buffer.shift();
        continue;
      }
      // Past warnings, each maybe after its position, to more text.
      let k = 0;
      for (;;) {
        if (isPosition(peek(k)) && isWarning(peek(k + 1))) k += 2;
        else if (isWarning(peek(k))) k += 1;
        else break;
      }
      if (k === 0) break;
      if (isPosition(peek(k)) && isText(peek(k + 1))) {
        text += buffer.splice(k, 2)[1].text;
      } else if (isText(peek(k))) {
        text += buffer.splice(k, 1)[0].text;
      } else {
        break;
      }
    }
    yield { t: 'TagText', text };
  }
}

// Each character in lower or upper case, as `StringLike`'s `map` does.
const lowerCase = (s) => [...s].map(toLower).join('');
const upperCase = (s) => [...s].map(toUpper).join('');

/**
 * A tag's names in one case: a declaration's (`!doctype`) upper, any
 * other's and its attributes' names lower.
 *
 * @see Text.HTML.TagSoup.canonicalizeTags
 * @param {Tag} tag
 * @returns {Tag}
 */
export function canonicalizeTag(tag) {
  if (tag.t === 'TagOpen' && tag.name.startsWith('!')) {
    return { ...tag, name: `!${upperCase(tag.name.slice(1))}` };
  }
  if (tag.t === 'TagOpen') {
    const attrs = tag.attrs.map(([k, v]) => [lowerCase(k), v]);
    return { ...tag, name: lowerCase(tag.name), attrs };
  }
  if (tag.t === 'TagClose') return { ...tag, name: lowerCase(tag.name) };
  return tag;
}

/**
 * Whether `tag` matches `pattern`: of its kind, an empty name or text in
 * the pattern matching any; each of the pattern's attributes among the
 * tag's, one without a name matched by its value alone, one without a
 * value by its name.
 *
 * @see Text.HTML.TagSoup.(~==)
 * @param {Tag} tag
 * @param {Tag} pattern
 */
export function tagMatches(tag, pattern) {
  if (tag.t !== pattern.t) return false;
  switch (tag.t) {
    case 'TagText':
    case 'TagComment':
    case 'TagWarning':
      return pattern.text === '' || pattern.text === tag.text;
    case 'TagClose':
      return pattern.name === '' || pattern.name === tag.name;
    case 'TagOpen':
      return (
        (pattern.name === '' || pattern.name === tag.name) &&
        pattern.attrs.every(([name, value]) =>
          tag.attrs.some(([n, v]) => {
            if (name === '') return v === value;
            return n === name && (value === '' || v === value);
          }),
        )
      );
    case 'TagPosition':
      return tag.row === pattern.row && tag.column === pattern.column;
    default:
      return false;
  }
}
