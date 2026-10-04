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
  charsInBalanced,
  many1Till,
  notAhead,
  parseFromString,
  skipSpaces,
  spaceChar,
  textOf,
} from '../parsing/general.js';
import { enabled, updateState, whenEnabled } from '../parsing/state.js';
import { toLower } from '../shared.js';
import { SourceText } from '../source-text.js';
import { base64DataURIEnd, escapeURI } from '../uri.js';
import { attributes } from './attributes.js';
import { litChar, spnl } from './common.js';
import { code, endline, escapedChar, inlines, math } from './inlines.js';

/** @typedef {import('../core.js').Context} Context */
/** @template T @typedef {import('../core.js').Parser<T>} Parser */
/** @typedef {import('../ast/builder.js').Inlines} Inlines */
/** @typedef {[string, string[], [string, string][]]} Attr */

// Text split at its spaces and joined by single ones: Haskell's
// `T.unwords . T.words`.
const words = (text) =>
  [...text]
    .reduce((out, c) => out + (isSpace(c) ? ' ' : c), '')
    .split(' ')
    .filter(Boolean)
    .join(' ');

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
 * @returns {{label: Inlines, raw: string} | typeof FAIL}
 */
export function reference(ctx) {
  if (enabled(ctx, 'footnotes') && noNoteAhead(ctx) === FAIL) return FAIL;
  const start = ctx.pos;
  const label = inBalancedBrackets(ctx);
  if (label === FAIL) return FAIL;
  return { label, raw: ctx.text.slice(start, ctx.pos) };
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
    return read === FAIL ? FAIL : words(read.join(''));
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
  return read === FAIL ? FAIL : words(read.join(''));
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
 * A link: its text in brackets, no link in it, then its target.
 *
 * Not ported yet: a reference link, its target defined elsewhere.
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
  if (target === FAIL) return FAIL;
  const { attr, url: href, title } = target;
  return B.linkWith(attr, href, title, ref.label, start, ctx.pos);
});

const bang = char('!');

/**
 * An image: `!`, its description in brackets, then its target. Pandoc
 * adds the default image extension to a target without one; the CLI's
 * default is none.
 *
 * Not ported yet: a reference image, and wikilinks, off by default.
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
  if (target === FAIL) return FAIL;
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
