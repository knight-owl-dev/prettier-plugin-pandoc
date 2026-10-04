// Links, images and spans: text in brackets read again as inlines, then a
// target in parentheses, or attributes in braces.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.Markdown`. `inlines.js`
// imports this module and this one `inlines.js`: what it imports from here
// is a function declaration, and what this reads from it, it reads when
// called.

import * as B from '../ast/builder.js';
import { nullAttr } from '../ast/nodes.js';
import { mapSpans } from '../ast/spans.js';
import {
  char,
  isAlphaNum,
  isSpace,
  noneOf,
  oneOf,
  satisfy,
  spaces,
  string,
} from '../char.js';
import { codePointLength } from '../code-points.js';
import {
  alt,
  attempt,
  FAIL,
  lookAhead,
  many,
  many1,
  manyTill,
  notFollowedBy,
  option,
} from '../core.js';
import {
  blanklines,
  charsInBalanced,
  many1Till,
  notAhead,
  parseFromString,
  parseFromStringFresh,
  skipSpaces,
  spaceChar,
  textOf,
} from '../parsing/general.js';
import { enabled, toKey, updateState, whenEnabled } from '../parsing/state.js';
import { toLower, words } from '../shared.js';
import { SourceText } from '../source-text.js';
import { base64DataURIEnd, escapeURI } from '../uri.js';
import { attributes } from './attributes.js';
import { litChar, skipNonindentSpaces, spnl } from './common.js';
import { code, endline, escapedChar, inlines, math } from './inlines.js';
import { lookupTables } from './references.js';

/** @typedef {import('../core.js').Context} Context */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {[string, string[], [string, string][]]} Attr */
/**
 * Inlines in brackets: the inlines, and the text read, from `from` to `to`.
 *
 * @typedef {{label: Inlines, raw: string, from: number, to: number}} Reference
 */

// Text split at its spaces and joined by single ones: Haskell's
// `T.unwords . T.words`.
const unwords = (text) => words(text).join(' ');

// What Haskell's `trimr` drops: spaces, tabs and line breaks at the end.
const trimEnd = (text) => text.replace(/[ \t\r\n]+$/, '');

const noteOpen = string('[^');
const noteLabel = many1Till(
  satisfy((c) => !'\r\n\t ^[]'.includes(c)),
  char(']'),
);

/** @see Text.Pandoc.Readers.Markdown.noteMarker */
const noteMarker = attempt((ctx) =>
  noteOpen(ctx) === FAIL ? FAIL : noteLabel(ctx),
);
const noNoteAhead = notAhead(noteMarker);

// In brackets, what `inBalancedBrackets` reads past whole: a bracket in it
// is no bracket. Not ported yet: raw HTML and raw TeX.
const bracketSkip = alt(
  escapedChar,
  (ctx) => code(ctx),
  (ctx) => math(ctx),
  (ctx) => endline(ctx),
);
const openBracket = char('[');

/**
 * Inlines in balanced brackets, a bracket in a code span, math or an
 * escape not counted: the text between them read again, trimmed.
 *
 * @see Text.Pandoc.Readers.Markdown.inBalancedBrackets
 * @type {Parser<Inlines>}
 */
const inBalancedBrackets = attempt((ctx) => {
  if (openBracket(ctx) === FAIL) return FAIL;
  const from = ctx.pos;
  for (let depth = 1; depth > 0; ) {
    const at = ctx.pos;
    if (bracketSkip(ctx) !== FAIL) continue;
    if (ctx.pos !== at) return FAIL;
    const c = ctx.text[at];
    if (c === undefined || c === '\n') return FAIL;
    if (c === ']') depth--;
    else if (c === '[') depth++;
    ctx.pos += codePointLength(ctx.text, at);
  }
  const label = SourceText.slice(ctx.text, from, ctx.pos - 1);
  const read = parseFromString(ctx, inlines, label);
  return read === FAIL ? FAIL : B.trimInlines(read);
});

/**
 * Inlines in brackets, and the text read, brackets and all: a link's text,
 * which a reference link's key is made from. Not a note's marker.
 *
 * @see Text.Pandoc.Readers.Markdown.reference
 * @param {Context} ctx
 * @returns {Reference | typeof FAIL}
 */
export function reference(ctx) {
  if (enabled(ctx, 'footnotes') && noNoteAhead(ctx) === FAIL) return FAIL;
  const from = ctx.pos;
  const label = inBalancedBrackets(ctx);
  if (label === FAIL) return FAIL;
  return { label, raw: ctx.text.slice(from, ctx.pos), from, to: ctx.pos };
}

/**
 * Literal text between `open` and `close`.
 *
 * @see Text.Pandoc.Readers.Markdown.litBetween
 * @param {string} open
 * @param {string} close
 * @returns {Parser<string>}
 */
function litBetween(open, close) {
  const [opening, chars] = [char(open), manyTill(litChar, char(close))];
  return attempt((ctx) => {
    if (opening(ctx) === FAIL) return FAIL;
    const read = chars(ctx);
    return read === FAIL ? FAIL : read.join('');
  });
}

const quotedTitles = new Map();

/**
 * A title in quotes `c`, not opening on a space; quotes of its kind inside
 * it, before a letter or digit, nest. Its spaces collapsed.
 *
 * @see Text.Pandoc.Readers.Markdown.quotedTitle
 * @param {string} c
 * @returns {Parser<string>}
 */
export function quotedTitle(c) {
  let title = quotedTitles.get(c);
  if (title !== undefined) return title;
  const quote = char(c);
  const noSpaces = notFollowedBy(spaces);
  const notAlphaNum = notFollowedBy(satisfy(isAlphaNum));
  const ender = attempt((ctx) =>
    quote(ctx) === FAIL ? FAIL : notAlphaNum(ctx),
  );
  const nested = (ctx) => {
    const inner = title(ctx);
    return inner === FAIL ? FAIL : c + inner + c;
  };
  const run = textOf(many1(noneOf(['\\', '\n', '&', c])));
  const chunks = manyTill(alt(nested, run, litChar), ender);
  title = attempt((ctx) => {
    if (quote(ctx) === FAIL || noSpaces(ctx) === FAIL) return FAIL;
    const read = chunks(ctx);
    return read === FAIL ? FAIL : unwords(read.join(''));
  });
  quotedTitles.set(c, title);
  return title;
}

/**
 * A title in double or single quotes.
 *
 * @see Text.Pandoc.Readers.Markdown.linkTitle
 */
const linkTitle = alt(quotedTitle('"'), quotedTitle("'"));
const titleAfter = attempt((ctx) =>
  spnl(ctx) === FAIL ? FAIL : linkTitle(ctx),
);

const inParentheses = charsInBalanced('(', ')', litChar);
const parenthesized = attempt((ctx) => {
  const inner = inParentheses(ctx);
  return inner === FAIL ? FAIL : `(${inner})`;
});
const notURLEnd = notFollowedBy(oneOf('\n\r )'));
const lineBreakAhead = lookAhead(oneOf('\n\r'));
const noTitleAhead = notFollowedBy(titleAfter);
const notQuoteAhead = notFollowedBy(oneOf(`"')`));
const spaceRun = textOf(many1(spaceChar));

// A piece of a target's URL: text in balanced parentheses, a character
// but a space or `)`, a line break before no title, or spaces before no
// title's quote or the closing parenthesis.
const urlChunk = alt(
  parenthesized,
  (ctx) => (notURLEnd(ctx) === FAIL ? FAIL : litChar(ctx)),
  (ctx) =>
    lineBreakAhead(ctx) === FAIL || noTitleAhead(ctx) === FAIL
      ? FAIL
      : litChar(ctx),
  attempt((ctx) => {
    const run = spaceRun(ctx);
    return run === FAIL || notQuoteAhead(ctx) === FAIL ? FAIL : run;
  }),
);
const urlChunks = many(urlChunk);
const sourceURL = (ctx) => {
  const read = urlChunks(ctx);
  return read === FAIL ? FAIL : unwords(read.join(''));
};

/**
 * A base64 data URI, as written.
 *
 * @see Text.Pandoc.Readers.Markdown.base64DataURI
 * @type {Parser<string>}
 */
function base64DataURI(ctx) {
  const end = base64DataURIEnd(ctx.text, ctx.pos);
  if (end < 0) return FAIL;
  const uri = ctx.text.slice(ctx.pos, end);
  ctx.pos = end;
  return uri;
}

const openParen = char('(');
const closeParen = char(')');
const url = alt(litBetween('<', '>'), base64DataURI, sourceURL);
const maybeTitle = option('', titleAfter);

/**
 * A target in parentheses: its URL, escaped, and its title.
 *
 * @see Text.Pandoc.Readers.Markdown.source
 * @type {Parser<{url: string, title: string}>}
 */
function source(ctx) {
  if (openParen(ctx) === FAIL) return FAIL;
  skipSpaces(ctx);
  const src = url(ctx);
  if (src === FAIL) return FAIL;
  const title = maybeTitle(ctx);
  if (title === FAIL) return FAIL;
  skipSpaces(ctx);
  if (closeParen(ctx) === FAIL) return FAIL;
  return { url: escapeURI(trimEnd(src)), title };
}

const linkAttributes = option(
  nullAttr,
  whenEnabled('link_attributes', attributes),
);

/**
 * A target in parentheses and the attributes after it.
 *
 * @see Text.Pandoc.Readers.Markdown.regLink
 * @type {Parser<{url: string, title: string, attr: Attr}>}
 */
const regLink = attempt((ctx) => {
  const target = source(ctx);
  if (target === FAIL) return FAIL;
  const attr = linkAttributes(ctx);
  return attr === FAIL ? FAIL : { ...target, attr };
});

/**
 * A link: its text in brackets, no link in it, then its target, or a
 * reference to one.
 *
 * @see Text.Pandoc.Readers.Markdown.link
 * @param {Context} ctx
 */
export function link(ctx) {
  return ctx.state.allowLinks ? linkAt(ctx) : FAIL;
}

const linkAt = attempt((ctx) => {
  const start = ctx.pos;
  const before = ctx.state;
  updateState(ctx, { allowLinks: false });
  const ref = reference(ctx);
  ctx.state = before;
  if (ref === FAIL) return FAIL;
  const target = regLink(ctx);
  if (target === FAIL) return referenceLink(ctx, B.linkWith, ref, start);
  const { attr, url: href, title } = target;
  return B.linkWith(attr, href, title, ref.label, start, ctx.pos);
});

/**
 * Attributes on a reference combined with its definition's: the first's
 * identifier where it has one, the classes of both, and a key's first value.
 *
 * @see Text.Pandoc.Shared.combineAttr
 * @param {Attr} attr
 * @param {Attr} defined
 * @returns {Attr}
 */
function combineAttr([id1, classes1, kvs1], [id2, classes2, kvs2]) {
  let kvs = kvs2;
  for (let i = kvs1.length - 1; i >= 0; i--) {
    const [k, v] = kvs1[i];
    if (!kvs.some(([key]) => key === k)) kvs = [[k, v], ...kvs];
  }
  return [
    id1 === '' ? id2 : id1,
    [...new Set([...classes1, ...classes2])],
    kvs,
  ];
}

const secondReference = option(
  null,
  attempt((ctx) =>
    enabled(ctx, 'spaced_reference_links') && spnl(ctx) === FAIL
      ? FAIL
      : reference(ctx),
  ),
);

// Text the reader extracts: `text` from `from` to `to`.
const slice = (ctx, from, to) => SourceText.slice(ctx.text, from, to);

/**
 * A reference to a target defined elsewhere, after a link's text or an
 * image's description `ref`: `[ref]`, `[]`, or nothing with
 * `shortcut_reference_links`; attributes after it. Its key, else its text,
 * names a reference key, else a heading's; with none, the text as read.
 *
 * Not ported yet: a citation in the second brackets, which ends a
 * shortcut reference before it.
 *
 * @see Text.Pandoc.Readers.Markdown.referenceLink
 * @param {Context} ctx
 * @param {typeof B.linkWith} build `B.linkWith` or `B.imageWith`.
 * @param {Reference} ref
 * @param {number} start Where the link starts: its `[`, an image's `!`.
 */
function referenceLink(ctx, build, ref, start) {
  const spaceAfter = ctx.text[ctx.pos] === ' ';
  const second = secondReference(ctx);
  if (second === FAIL) return FAIL;
  if (second === null && !enabled(ctx, 'shortcut_reference_links')) {
    return FAIL;
  }
  const attr = linkAttributes(ctx);
  if (attr === FAIL) return FAIL;
  const raw = second?.raw ?? '';
  const isImage = build === B.imageWith;
  const key = toKey(raw === '' || raw === '[]' ? ref.raw : raw);
  const parsedRaw =
    second === null
      ? []
      : parseFromStringFresh(ctx, inlines, slice(ctx, second.from, second.to));
  // An image's description keeps its brackets; a link's text drops them.
  const fallback = isImage
    ? parseFromStringFresh(ctx, inlines, slice(ctx, ref.from, ref.to))
    : parseFromStringFresh(ctx, inlines, slice(ctx, ref.from + 1, ref.to - 1));
  if (parsedRaw === FAIL || fallback === FAIL) return FAIL;
  const end = ctx.pos;
  const { keys, headerKeys } = lookupTables(ctx);
  const defined = keys.get(key);
  if (defined !== undefined) {
    const [[url, title], definedAttr] = defined;
    const combined = combineAttr(attr, definedAttr);
    return build(combined, url, title, ref.label, start, end);
  }
  const heading = enabled(ctx, 'implicit_header_references')
    ? headerKeys.get(key)
    : undefined;
  if (heading !== undefined) {
    const [[url, title]] = heading;
    return build(attr, url, title, ref.label, start, end);
  }
  return B.concat([
    isImage ? B.str('!', start, start + 1) : B.str('[', ref.from, ref.from + 1),
    fallback,
    isImage ? [] : B.str(']', ref.to - 1, ref.to),
    spaceAfter ? B.space(ref.to, ref.to + 1) : [],
    parsedRaw,
  ]);
}

const bang = char('!');

/**
 * An image: `!`, its description in brackets, then its target. Pandoc
 * adds the default image extension to a target without one; the CLI's
 * default is none.
 *
 * Not ported yet: wikilinks, off by default.
 *
 * @see Text.Pandoc.Readers.Markdown.image
 */
export function image(ctx) {
  return imageAt(ctx);
}

const imageAt = attempt((ctx) => {
  const start = ctx.pos;
  if (bang(ctx) === FAIL) return FAIL;
  const ref = reference(ctx);
  if (ref === FAIL) return FAIL;
  const target = regLink(ctx);
  if (target === FAIL) return referenceLink(ctx, B.imageWith, ref, start);
  const { attr, url: src, title } = target;
  return B.imageWith(attr, src, title, ref.label, start, ctx.pos);
});

/**
 * Inlines in brackets, then attributes: a span.
 *
 * @see Text.Pandoc.Readers.Markdown.bracketedSpan
 */
export function bracketedSpan(ctx) {
  return bracketedSpanAt(ctx);
}

const bracketedSpanAt = whenEnabled(
  'bracketed_spans',
  attempt((ctx) => {
    const start = ctx.pos;
    const ref = reference(ctx);
    if (ref === FAIL) return FAIL;
    const attr = attributes(ctx);
    if (attr === FAIL) return FAIL;
    return wrapSpan(attr, ref.label, start, ctx.pos);
  }),
);

// A `style` that is `font-variant: small-caps` alone, spaces and `;` aside.
const isSmallCapsFontVariant = (style) =>
  toLower(style.replace(/[ \t;]/g, '')) === 'font-variant:small-caps';

const WRAPPERS = new Map([
  ['smallcaps', B.smallcaps],
  ['ul', B.underline],
  ['underline', B.underline],
]);

/**
 * `ils` in a span of `attr`: its classes `smallcaps`, `ul` and `underline`,
 * and a small-caps `style`, made the elements they name, inside it, the
 * first class outermost; no span where nothing else is left of `attr`.
 *
 * @see Text.Pandoc.Readers.Markdown.wrapSpan
 * @param {Attr} attr
 * @param {Inlines} ils
 * @param {number} start
 * @param {number} end
 */
function wrapSpan([ident, classes, kvs], ils, start, end) {
  const style = kvs.find(([k]) => k === 'style')?.[1];
  const smallcapsStyle = style !== undefined && isSmallCapsFontVariant(style);
  const pairs = smallcapsStyle ? kvs.filter(([k]) => k !== 'style') : kvs;
  const wrappers = classes.flatMap((c) => WRAPPERS.get(c) ?? []);
  if (smallcapsStyle) wrappers.push(B.smallcaps);
  const wrap = (x) =>
    wrappers.reduceRight((inner, w) => w(inner, start, end), x);
  const others = classes.filter((c) => !WRAPPERS.has(c));
  if (ident === '' && others.length === 0 && pairs.length === 0) {
    return wrappers.length === 0
      ? B.spanWith(nullAttr, ils, start, end)
      : wrap(ils);
  }
  return B.spanWith([ident, others, pairs], wrap(ils), start, end);
}

/**
 * A paragraph's inlines as a figure where they are an image alone with a
 * description: its description the caption, an `alt` attribute the
 * image's description instead, `latex-placement` the figure's.
 *
 * @see Text.Pandoc.Readers.Markdown.implicitFigure
 * @param {import('../ast/nodes.js').Node} img
 * @param {number} start
 * @param {number} end
 */
export function implicitFigure(img, start, end) {
  const [[ident, classes, kvs], capt, [src, title]] = img.c;
  const altText = kvs.find(([k]) => k === 'alt')?.[1];
  // An alt attribute's text is no text of the source: empty spans where
  // the image starts.
  const description =
    altText === undefined
      ? capt
      : mapSpans(
          B.text(altText),
          () => img.start,
          () => img.start,
        );
  const placement = kvs.find(([k]) => k === 'latex-placement');
  const imageKvs = kvs.filter(([k]) => k !== 'alt' && k !== 'latex-placement');
  const figAttr = [ident, [], placement === undefined ? [] : [placement]];
  const captionStart = capt[0].start;
  const caption = B.simpleCaption(B.plain(capt, captionStart, capt.at(-1).end));
  const body = B.plain(
    B.imageWith(
      ['', classes, imageKvs],
      src,
      title,
      description,
      img.start,
      img.end,
    ),
    img.start,
    img.end,
  );
  return B.figureWith(figAttr, caption, body, start, end);
}

/**
 * Attributes with an `id` or `class` key made the identifier or classes.
 *
 * @see Text.Pandoc.Parsing.General.extractIdClass
 * @param {Attr} attr
 * @returns {Attr}
 */
function extractIdClass([ident, classes, kvs]) {
  const value = (key) => kvs.find(([k]) => k === key)?.[1];
  const id = value('id');
  const cls = value('class');
  return [
    id ?? ident,
    cls === undefined ? classes : words(cls),
    kvs.filter(([k]) => k !== 'id' && k !== 'class'),
  ];
}

const optionalNewline = option(null, char('\n'));

// Spaces, a line break, and spaces: where a definition's parts may break.
const lineSpace = (ctx) => {
  skipSpaces(ctx);
  optionalNewline(ctx);
  skipSpaces(ctx);
};

/**
 * A definition's title: in double or single quotes, or in parentheses.
 *
 * @see Text.Pandoc.Readers.Markdown.referenceTitle
 */
const referenceTitle = attempt((ctx) => {
  lineSpace(ctx);
  return alt(quotedTitle('"'), quotedTitle("'"), inParentheses)(ctx);
});

const noTitle = notAhead(referenceTitle);
const noAttributes = notAhead(whenEnabled('link_attributes', attributes));
const noReference = notAhead(reference);
const notSpace = notFollowedBy(satisfy(isSpace));
const wordChars = many1((ctx) =>
  notSpace(ctx) === FAIL ? FAIL : litChar(ctx),
);

// A word of a definition's URL: not its title, attributes, or a reference.
const urlWord = attempt((ctx) => {
  skipSpaces(ctx);
  if (noTitle(ctx) === FAIL || noAttributes(ctx) === FAIL) return FAIL;
  if (noReference(ctx) === FAIL) return FAIL;
  const chars = wordChars(ctx);
  return chars === FAIL ? FAIL : chars.join('');
});
const urlWords = many(urlWord);
const definitionURL = alt(litBetween('<', '>'), (ctx) => {
  const read = urlWords(ctx);
  return read === FAIL ? FAIL : read.join(' ');
});
const maybeReferenceTitle = option('', referenceTitle);
const definitionAttributes = option(
  nullAttr,
  attempt(
    whenEnabled('link_attributes', (ctx) => {
      lineSpace(ctx);
      return attributes(ctx);
    }),
  ),
);
const colon = char(':');
const noBracket = notFollowedBy(openBracket);

/**
 * A reference key's definition: its key in brackets, `:`, a URL, a title
 * and attributes. Recorded, the last of a key's definitions its target; no
 * block.
 *
 * Not ported yet: no citation where the key would be (`notFollowedBy
 * cite`), and the warning of a key defined again.
 *
 * @see Text.Pandoc.Readers.Markdown.referenceKey
 * @param {Context} ctx
 */
export function referenceKey(ctx) {
  return referenceKeyAt(ctx);
}

const referenceKeyAt = attempt((ctx) => {
  if (skipNonindentSpaces(ctx) === FAIL) return FAIL;
  const ref = reference(ctx);
  if (ref === FAIL || colon(ctx) === FAIL) return FAIL;
  lineSpace(ctx);
  if (noBracket(ctx) === FAIL) return FAIL;
  const src = definitionURL(ctx);
  if (src === FAIL) return FAIL;
  const title = maybeReferenceTitle(ctx);
  if (title === FAIL) return FAIL;
  const attr = definitionAttributes(ctx);
  if (attr === FAIL || blanklines(ctx) === FAIL) return FAIL;
  const target = [escapeURI(trimEnd(src)), title];
  const keys = ctx.state.keys.set(toKey(ref.raw), [
    target,
    extractIdClass(attr),
  ]);
  updateState(ctx, { keys });
  return [];
});
