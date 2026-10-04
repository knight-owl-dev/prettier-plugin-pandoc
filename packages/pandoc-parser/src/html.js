// HTML tags in markdown, found as Pandoc's readers find them: TagSoup run
// on the rest of the input, its first tag checked, and the text up to that
// tag's end read.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.HTML` (`htmlTag` and the
// tag predicates) and `Text.Pandoc.Readers.HTML.TagCategories`.

import { codePointLength } from './code-points.js';
import { FAIL } from './core.js';
import { isAlpha, isAlphaNum } from './data-char.js';
import {
  canonicalizeTag,
  parseOptions,
  parseTagsOptions,
} from './tagsoup/parser.js';

/** @typedef {import('./core.js').Context} Context */
/** @typedef {import('./tagsoup/parser.js').Tag} Tag */

// cspell:disable
/** @see Text.Pandoc.Readers.HTML.TagCategories.eitherBlockOrInline */
const EITHER_BLOCK_OR_INLINE = new Set([
  'audio',
  'applet',
  'button',
  'iframe',
  'embed',
  'del',
  'ins',
  'progress',
  'map',
  'area',
  'noscript',
  'script',
  'object',
  'svg',
  'video',
  'source',
  'track',
]);

/** @see Text.Pandoc.Readers.HTML.TagCategories.blockHtmlTags */
const BLOCK_HTML_TAGS = [
  '?xml',
  '!DOCTYPE',
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'canvas',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'isindex',
  'main',
  'menu',
  'meta',
  'noframes',
  'nav',
  'ol',
  'output',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'textarea',
  'thead',
  'tfoot',
  'ul',
  'dd',
  'dt',
  'frameset',
  'li',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'script',
  'style',
];

/** @see Text.Pandoc.Readers.HTML.TagCategories.blockDocBookTags */
const DOC_BOOK_BLOCK_TAGS = [
  'calloutlist',
  'bibliolist',
  'glosslist',
  'itemizedlist',
  'orderedlist',
  'segmentedlist',
  'simplelist',
  'variablelist',
  'caution',
  'important',
  'note',
  'tip',
  'warning',
  'address',
  'literallayout',
  'programlisting',
  'programlistingco',
  'screen',
  'screenco',
  'screenshot',
  'synopsis',
  'example',
  'informalexample',
  'figure',
  'informalfigure',
  'table',
  'informaltable',
  'para',
  'simpara',
  'formalpara',
  'equation',
  'informalequation',
  'figure',
  'screenshot',
  'mediaobject',
  'qandaset',
  'procedure',
  'task',
  'cmdsynopsis',
  'funcsynopsis',
  'classsynopsis',
  'blockquote',
  'epigraph',
  'msgset',
  'sidebar',
  'title',
];

/** @see Text.Pandoc.Readers.HTML.TagCategories.epubTags */
const EPUB_TAGS = ['case', 'switch', 'default'];

// cspell:enable

/** @see Text.Pandoc.Readers.HTML.TagCategories.blockTags */
const BLOCK_TAGS = new Set([
  ...BLOCK_HTML_TAGS,
  ...DOC_BOOK_BLOCK_TAGS,
  ...EPUB_TAGS,
]);

/** @see Text.HTML.TagSoup.fromAttrib */
const fromAttrib = (name, tag) =>
  tag.attrs?.find(([k]) => k === name)?.[1] ?? '';

/**
 * Whether `tag` may stand in a paragraph: a comment, `<script>` of TeX
 * math, `<style>`, or any but a block tag; a processing instruction too.
 *
 * @see Text.Pandoc.Readers.HTML.isInlineTag
 * @param {Tag} tag
 */
export function isInlineTag(tag) {
  if (tag.t === 'TagComment') return true;
  if (tag.t !== 'TagOpen' && tag.t !== 'TagClose') return false;
  const { name } = tag;
  if (name === 'script') {
    return (
      tag.t === 'TagClose' || fromAttrib('type', tag).startsWith('math/tex')
    );
  }
  if (name === 'style') return true;
  return !BLOCK_TAGS.has(name) || name.startsWith('?');
}

/**
 * Whether `tag` may open or close a block: a comment, a processing
 * instruction or declaration, or a block tag or one either block or
 * inline.
 *
 * @see Text.Pandoc.Readers.HTML.isBlockTag
 * @param {Tag} tag
 */
export function isBlockTag(tag) {
  if (tag.t === 'TagComment') return true;
  if (tag.t !== 'TagOpen' && tag.t !== 'TagClose') return false;
  const { name } = tag;
  if (name.startsWith('?') || name.startsWith('!')) return true;
  return BLOCK_TAGS.has(name) || EITHER_BLOCK_OR_INLINE.has(name);
}

/** @see Text.Pandoc.Readers.HTML.isTextTag */
export const isTextTag = (tag) => tag.t === 'TagText';

/** @see Text.Pandoc.Readers.HTML.isCommentTag */
export const isCommentTag = (tag) => tag.t === 'TagComment';

// Pandoc's options, positions on; text not merged, which changes no tag
// `htmlTag` reads: merging joins texts, and the positions between them,
// where a first text fails anyway. Merged, a text runs to the next tag,
// where Haskell's laziness reads none of it.
const OPTIONS = { ...parseOptions, tagPosition: true, tagTextMerge: false };

// A name: a letter, then letters, digits, `:`, `-` and `_`; no `.`, which
// would make `<www.example.org/x>` a tag.
const isNameChar = (c) => isAlphaNum(c) || c === ':' || c === '-' || c === '_';
const isName = (s) => {
  const [first, ...rest] = s;
  return first !== undefined && isAlpha(first) && rest.every(isNameChar);
};
const isPI = (s) => s.startsWith('?');

/**
 * The tag at the position where `f` holds of it, and its text, read: the
 * first tag TagSoup finds in the rest of the input, a space after it, its
 * names lower case. A tag or comment only, its name a name or a processing
 * instruction's, and not a URL's (`<https://example.org>`).
 *
 * @see Text.Pandoc.Readers.HTML.htmlTag
 * @param {Context} ctx
 * @param {(tag: Tag) => boolean} f
 * @returns {{tag: Tag, raw: string} | typeof FAIL}
 */
export function htmlTag(ctx, f) {
  const { text, pos: start } = ctx;
  if (text[start] !== '<') return FAIL;
  // Each tag read ends at a `>`: with none after, none is, and TagSoup
  // need not lex a tag left open to the end, as it would at each `<`.
  let close = text.indexOf('>', start + 1);
  if (close === -1) return FAIL;
  const tags = parseTagsOptions(OPTIONS, text, start, ' ');
  if (tags.next().value?.t !== 'TagPosition') return FAIL;
  const found = tags.next().value;
  // No text, warning or position passes `htmlTag`'s cases: none is read
  // past, which would lex all the text that merges into it.
  const kinds = ['TagOpen', 'TagClose', 'TagComment'];
  if (found === undefined || !kinds.includes(found.t)) return FAIL;
  const tag = canonicalizeTag(found);
  const after = tags.next().value;
  if (after?.t !== 'TagPosition' || !f(tag)) return FAIL;
  if (tag.t === 'TagComment') {
    // As many characters as the comment's text has, whatever they are.
    if (!text.startsWith('<!--', start)) return FAIL;
    let end = start + 4;
    for (let n = [...tag.text].length; n > 0 && end < text.length; n--) {
      end += codePointLength(text, end);
    }
    if (!text.startsWith('-->', end)) return FAIL;
    ctx.pos = end + 3;
    return { tag, raw: `<!--${tag.text}-->` };
  }
  const { name } = tag;
  if (tag.t === 'TagOpen' && !isPI(name)) {
    if (!tag.attrs.every(([k]) => isName(k))) return FAIL;
  }
  if (!(isName(name) || isPI(name)) || name.endsWith(':')) return FAIL;
  // To the first `>` at or past where TagSoup's tag ends.
  while (close !== -1 && close + 1 < after.offset) {
    close = text.indexOf('>', close + 1);
  }
  if (close === -1) return FAIL;
  ctx.pos = close + 1;
  return { tag, raw: text.slice(start, ctx.pos) };
}
