// HTML lexed into TagSoup's tokens: characters, and the marks around tags,
// attributes, comments and character references, with a position before
// each state's output. HTML5's tokenizer, generalized as TagSoup has it:
// `<!name`, `<?name ?>`, `</!name>`, `</?name>`, and attribute values
// without names in `!` and `?` tags; no case changes, no entity names
// checked, and no RCDATA, CDATA or escape modes but `<script>`'s.
//
// Ported from TagSoup 0.14.8's `Text.HTML.TagSoup.Specification` and the
// bottom layer of `Text.HTML.TagSoup.Implementation`. The tokens come on
// demand, as Haskell's laziness gives them: a consumer that needs the first
// tag lexes no further.

import { codePointLength } from '../code-points.js';
import { isAlpha, isAlphaNum, isDigit } from '../data-char.js';

/**
 * A token: a character (`c`), a mark (`t` alone), an entity's end (`semi`:
 * whether `;` ended it), a warning (`warn`), or a position (`at`, an offset
 * in UTF-16 code units).
 *
 * @see Text.HTML.TagSoup.Implementation.Out
 * @typedef {{t: string, c?: string, semi?: boolean, warn?: string, at?: number}} Out
 */

/** The tokens' kinds. */
export const CHAR = 'Char';
export const TAG = 'Tag';
export const TAG_SHUT = 'TagShut';
export const ATT_NAME = 'AttName';
export const ATT_VAL = 'AttVal';
export const TAG_END = 'TagEnd';
export const TAG_END_CLOSE = 'TagEndClose';
export const COMMENT = 'Comment';
export const COMMENT_END = 'CommentEnd';
export const ENTITY_NAME = 'EntityName';
export const ENTITY_NUM = 'EntityNum';
export const ENTITY_HEX = 'EntityHex';
export const ENTITY_END = 'EntityEnd';
export const WARN = 'Warn';
export const POS = 'Pos';

const MARKS = new Map(
  [
    TAG,
    TAG_SHUT,
    ATT_NAME,
    ATT_VAL,
    TAG_END,
    TAG_END_CLOSE,
    COMMENT,
    COMMENT_END,
    ENTITY_NAME,
    ENTITY_NUM,
    ENTITY_HEX,
  ].map((t) => [t, Object.freeze({ t })]),
);

// Kinds of tag: `<foo`, `<?foo`, `<!foo`, `<script`.
const NORMAL = 0;
const XML = 1;
const DECL = 2;
const SCRIPT = 3;

// Haskell's `show` of a string, near enough for a warning.
const show = (s) => JSON.stringify(s);
const errSeen = (x) => ({ t: WARN, warn: `Unexpected ${show(x)}` });
const errWant = (x) => ({ t: WARN, warn: `Expected ${show(x)}` });

/** @see Text.HTML.TagSoup.Specification.white */
const white = (c) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/** @see Text.HTML.TagSoup.Specification.alphaChar */
const alphaChar = (c) => isAlphaNum(c) || c === ':' || c === '-' || c === '_';

/** @see Text.HTML.TagSoup.Specification.hexChar */
const hexChar = (hex, c) =>
  isDigit(c) || (hex && ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')));

/**
 * The tokens of `text` from `from`, then of `suffix`, read as though
 * appended without copying the text: `next()` lexes until one is ready.
 *
 * @see Text.HTML.TagSoup.Specification.parse
 */
export class Lexer {
  /**
   * @param {string} text
   * @param {number} [from]
   * @param {string} [suffix]
   */
  constructor(text, from = 0, suffix = '') {
    this.text = text;
    this.suffix = suffix;
    this.length = text.length + suffix.length;
    /** @type {Out[]} */
    this.out = [];
    this.read = 0;
    /** The state to run next and its arguments; null at the end. */
    this.k = [dat, from];
  }

  /**
   * The next token, or undefined after the last.
   *
   * @returns {Out | undefined}
   */
  next() {
    while (this.read === this.out.length) {
      if (this.k === null) return undefined;
      this.out.length = 0;
      this.read = 0;
      const [state, ...args] = this.k;
      this.k = null;
      state(this, ...args);
    }
    return this.out[this.read++];
  }

  // The character at `i`, a code point; `\0` at the end, as TagSoup's.
  hd(i) {
    if (i >= this.length) return '\0';
    if (i >= this.text.length) return this.suffix[i - this.text.length];
    return this.text.slice(i, i + codePointLength(this.text, i));
  }

  // The offset after the character at `i`.
  tl(i) {
    if (i >= this.length) return i;
    return i >= this.text.length ? i + 1 : i + codePointLength(this.text, i);
  }

  eof(i) {
    return i >= this.length;
  }

  // Where `s` ends if the text at `i` starts with it; -1 if not.
  nextAfter(i, s) {
    const end = i + s.length;
    const own = this.text.slice(i, end);
    const from = Math.max(0, i - this.text.length);
    const tail = this.suffix.slice(from, end - this.text.length);
    return own + tail === s ? end : -1;
  }

  pos(i) {
    this.out.push({ t: POS, at: i });
  }

  // Each of `outs`: a mark by its kind, a token as itself, else text, a
  // character token each. A kind is no character: each is a longer name.
  emit(...outs) {
    for (const o of outs) {
      const mark = MARKS.get(o);
      if (mark !== undefined) this.out.push(mark);
      else if (typeof o === 'object') this.out.push(o);
      else for (const c of o) this.out.push({ t: CHAR, c });
    }
  }

  continueWith(state, ...args) {
    this.k = [state, ...args];
  }
}

// A state to resume after a character reference: a state and its arguments
// but the offset, which the reference gives.
const resumeWith = (state, ...args) => ({ state, args });
const resume = (L, r, i) => L.continueWith(r.state, i, ...r.args);

const DAT = resumeWith(dat);
const wantEnd = (typ) => errWant(typ === XML ? '?>' : '>');

/** 8.2.4.1 Data state. */
function dat(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (c === '&' && !L.eof(i)) return charRef(L, DAT, false, null, L.tl(i));
  if (c === '<' && !L.eof(i)) return tagOpen(L, L.tl(i));
  if (L.eof(i)) return;
  L.emit(c);
  L.continueWith(dat, L.tl(i));
}

/** Whether `script` starts at `i`, any case, then a tag's name ends. */
function isScript(L, i) {
  let at = i;
  for (const c of 'script') {
    if (L.eof(at) || L.hd(at).toLowerCase() !== c) return false;
    at = L.tl(at);
  }
  const c = L.hd(at);
  return L.eof(at) || white(c) || c === '/' || c === '>' || c === '?';
}

/** 8.2.4.3 Tag open state. */
function tagOpen(L, i) {
  const c = L.hd(i);
  if (L.eof(i)) {
    L.emit(errSeen('<'), '<');
    return L.continueWith(dat, i);
  }
  if (c === '!') return L.continueWith(markupDeclOpen, L.tl(i));
  if (c === '/') return L.continueWith(closeTagOpen, L.tl(i));
  if (isAlpha(c)) {
    L.emit(TAG, c);
    return L.continueWith(tagName, L.tl(i), isScript(L, i) ? SCRIPT : NORMAL);
  }
  if (c === '>') {
    L.emit(errSeen('<>'), '<', '>');
    return L.continueWith(dat, L.tl(i));
  }
  if (c === '?') return L.continueWith(neilXmlTagOpen, L.tl(i));
  L.emit(errSeen('<'), '<');
  L.continueWith(dat, i);
}

/** Seen `<?`, nothing emitted. */
function neilXmlTagOpen(L, i) {
  const c = L.hd(i);
  if (!L.eof(i) && isAlpha(c)) {
    L.emit(TAG, '?', c);
    return L.continueWith(tagName, L.tl(i), XML);
  }
  L.emit(errSeen('<?'), '<', '?');
  L.continueWith(dat, i);
}

/** Seen `?`, a `>` wanted. */
function neilXmlTagClose(L, i) {
  L.pos(i);
  if (!L.eof(i) && L.hd(i) === '>') {
    L.emit(TAG_END);
    return L.continueWith(dat, L.tl(i));
  }
  L.emit(errSeen('?'));
  L.continueWith(beforeAttName, i, XML);
}

/** Just after a tag's `>`: `i` is past it. */
function neilTagEnd(L, i, typ) {
  L.pos(i);
  if (typ === XML) {
    L.emit(errWant('?>'), TAG_END);
    return L.continueWith(dat, i);
  }
  L.emit(TAG_END);
  L.continueWith(typ === SCRIPT ? neilScriptBody : dat, i);
}

/** Inside `<script>`: text up to `</script`. */
function neilScriptBody(L, i) {
  if (L.hd(i) === '<' && !L.eof(i)) {
    const j = L.tl(i);
    if (L.hd(j) === '/' && !L.eof(j) && isScript(L, L.tl(j))) {
      return L.continueWith(dat, i);
    }
  }
  if (L.eof(i)) return;
  L.pos(i);
  L.emit(L.hd(i));
  L.continueWith(neilScriptBody, L.tl(i));
}

/** 8.2.4.4 Close tag open state: `</!name>` closes a tag too. */
function closeTagOpen(L, i) {
  const c = L.hd(i);
  if (!L.eof(i) && (isAlpha(c) || c === '?' || c === '!')) {
    L.emit(TAG_SHUT, c);
    return L.continueWith(tagName, L.tl(i), NORMAL);
  }
  if (!L.eof(i) && c === '>') {
    L.emit(errSeen('</>'), '<', '/', '>');
    return L.continueWith(dat, L.tl(i));
  }
  if (L.eof(i)) {
    L.emit('<', '/');
    return L.continueWith(dat, i);
  }
  L.emit(errWant('tag name'));
  bogusComment(L, i);
}

// What every state in a tag does at its end, a `?` in an XML tag, or the
// input's end; true where it handled the character.
function tagCommon(L, i, typ, c) {
  if (L.eof(i)) {
    L.emit(wantEnd(typ));
    L.continueWith(dat, i);
    return true;
  }
  if (c === '>') {
    neilTagEnd(L, L.tl(i), typ);
    return true;
  }
  if (c === '?' && typ === XML) {
    L.continueWith(neilXmlTagClose, L.tl(i));
    return true;
  }
  return false;
}

/** 8.2.4.5 Tag name state. */
function tagName(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(beforeAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '/')
    return L.continueWith(selfClosingStartTag, L.tl(i), typ);
  if (tagCommon(L, i, typ, c)) return;
  L.emit(c);
  L.continueWith(tagName, L.tl(i), typ);
}

/** 8.2.4.6 Before attribute name state. */
function beforeAttName(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(beforeAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '/')
    return L.continueWith(selfClosingStartTag, L.tl(i), typ);
  if (L.eof(i) || c === '>' || (c === '?' && typ === XML)) {
    tagCommon(L, i, typ, c);
    return;
  }
  if (typ !== NORMAL && (c === "'" || c === '"')) {
    return L.continueWith(beforeAttValue, i, typ);
  }
  if ('"\'<='.includes(c)) L.emit(errSeen(c));
  L.emit(ATT_NAME, c);
  L.continueWith(attName, L.tl(i), typ);
}

/** 8.2.4.7 Attribute name state. */
function attName(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(afterAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '/')
    return L.continueWith(selfClosingStartTag, L.tl(i), typ);
  if (!L.eof(i) && c === '=')
    return L.continueWith(beforeAttValue, L.tl(i), typ);
  if (tagCommon(L, i, typ, c)) return;
  if ('"\'<'.includes(c)) L.emit(errSeen(c));
  L.emit(c);
  L.continueWith(attName, L.tl(i), typ);
}

/** 8.2.4.8 After attribute name state. */
function afterAttName(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(afterAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '/')
    return L.continueWith(selfClosingStartTag, L.tl(i), typ);
  if (!L.eof(i) && c === '=')
    return L.continueWith(beforeAttValue, L.tl(i), typ);
  if (tagCommon(L, i, typ, c)) return;
  if (typ !== NORMAL && (c === '"' || c === "'")) {
    L.emit(ATT_VAL);
    return L.continueWith(beforeAttValue, i, typ);
  }
  if ('"\'<'.includes(c)) L.emit(errSeen(c));
  L.emit(ATT_NAME, c);
  L.continueWith(attName, L.tl(i), typ);
}

/** 8.2.4.9 Before attribute value state. */
function beforeAttValue(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c))
    return L.continueWith(beforeAttValue, L.tl(i), typ);
  if (!L.eof(i) && c === '"') {
    L.emit(ATT_VAL);
    return L.continueWith(attValueQuoted, L.tl(i), typ, '"');
  }
  if (!L.eof(i) && c === '&') {
    L.emit(ATT_VAL);
    return L.continueWith(attValueUnquoted, i, typ);
  }
  if (!L.eof(i) && c === "'") {
    L.emit(ATT_VAL);
    return L.continueWith(attValueQuoted, L.tl(i), typ, "'");
  }
  if (!L.eof(i) && c === '>') {
    L.emit(errSeen('='));
    return neilTagEnd(L, L.tl(i), typ);
  }
  if (tagCommon(L, i, typ, c)) return;
  if (c === '<' || c === '=') L.emit(errSeen(c));
  L.emit(ATT_VAL, c);
  L.continueWith(attValueUnquoted, L.tl(i), typ);
}

/** 8.2.4.10 and 8.2.4.11 Attribute value (double- and single-quoted) states. */
function attValueQuoted(L, i, typ, quote) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) {
    L.emit(errWant(quote));
    return L.continueWith(dat, i);
  }
  if (c === quote) return L.continueWith(afterAttValueQuoted, L.tl(i), typ);
  if (c === '&') {
    const r = resumeWith(attValueQuoted, typ, quote);
    return charRef(L, r, true, quote, L.tl(i));
  }
  L.emit(c);
  L.continueWith(attValueQuoted, L.tl(i), typ, quote);
}

/** 8.2.4.12 Attribute value (unquoted) state. */
function attValueUnquoted(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(beforeAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '&') {
    const r = resumeWith(attValueUnquoted, typ);
    return charRef(L, r, true, null, L.tl(i));
  }
  if (tagCommon(L, i, typ, c)) return;
  if ('"\'<='.includes(c)) L.emit(errSeen(c));
  L.emit(c);
  L.continueWith(attValueUnquoted, L.tl(i), typ);
}

/** 8.2.4.14 After attribute value (quoted) state. */
function afterAttValueQuoted(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (!L.eof(i) && white(c)) return L.continueWith(beforeAttName, L.tl(i), typ);
  if (!L.eof(i) && c === '/')
    return L.continueWith(selfClosingStartTag, L.tl(i), typ);
  if (!L.eof(i) && (c === '>' || (c === '?' && typ === XML))) {
    tagCommon(L, i, typ, c);
    return;
  }
  if (L.eof(i)) return L.continueWith(dat, i);
  L.emit(errSeen(c));
  L.continueWith(beforeAttName, i, typ);
}

/** 8.2.4.15 Self-closing start tag state. */
function selfClosingStartTag(L, i, typ) {
  L.pos(i);
  const c = L.hd(i);
  if (typ === XML) {
    L.emit(errSeen('/'));
    return L.continueWith(beforeAttName, i, typ);
  }
  if (!L.eof(i) && c === '>') {
    L.emit(TAG_END_CLOSE);
    return L.continueWith(dat, L.tl(i));
  }
  if (L.eof(i)) {
    L.emit(errWant('>'));
    return L.continueWith(dat, i);
  }
  L.emit(errSeen('/'));
  L.continueWith(beforeAttName, i, typ);
}

/** 8.2.4.16 Bogus comment state. */
function bogusComment(L, i) {
  L.emit(COMMENT);
  bogusComment1(L, i);
}

function bogusComment1(L, i) {
  L.pos(i);
  if (L.eof(i)) {
    L.emit(COMMENT_END);
    return L.continueWith(dat, i);
  }
  const c = L.hd(i);
  if (c === '>') {
    L.emit(COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  L.emit(c);
  L.continueWith(bogusComment1, L.tl(i));
}

/** 8.2.4.17 Markup declaration open state. */
function markupDeclOpen(L, i) {
  const dashes = L.nextAfter(i, '--');
  if (dashes !== -1) {
    L.emit(COMMENT);
    return L.continueWith(commentStart, dashes);
  }
  const c = L.hd(i);
  if (!L.eof(i) && isAlpha(c)) {
    L.emit(TAG, '!', c);
    return L.continueWith(tagName, L.tl(i), DECL);
  }
  const cdata = L.nextAfter(i, '[CDATA[');
  if (cdata !== -1) return L.continueWith(cdataSection, cdata);
  L.emit(errWant('tag name'));
  bogusComment(L, i);
}

// A comment state's end: `-->` wanted at the input's end.
function commentEof(L, i) {
  L.emit(errWant('-->'), COMMENT_END);
  L.continueWith(dat, i);
}

/** 8.2.4.18 Comment start state. */
function commentStart(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '-') return L.continueWith(commentStartDash, L.tl(i));
  if (c === '>') {
    L.emit(errSeen('<!-->'), COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  L.emit(c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.19 Comment start dash state. */
function commentStartDash(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '-') return L.continueWith(commentEnd, L.tl(i));
  if (c === '>') {
    L.emit(errSeen('<!--->'), COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  L.emit('-', c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.20 Comment state. */
function comment(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '-') return L.continueWith(commentEndDash, L.tl(i));
  L.emit(c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.21 Comment end dash state. */
function commentEndDash(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '-') return L.continueWith(commentEnd, L.tl(i));
  L.emit('-', c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.22 Comment end state. */
function commentEnd(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '>') {
    L.emit(COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  if (c === '-') {
    L.emit(errWant('-->'), '-');
    return L.continueWith(commentEnd, L.tl(i));
  }
  if (white(c)) {
    L.emit(errSeen('--'), '-', '-', c);
    return L.continueWith(commentEndSpace, L.tl(i));
  }
  if (c === '!') {
    L.emit(errSeen('!'));
    return L.continueWith(commentEndBang, L.tl(i));
  }
  L.emit(errSeen('--'), '-', '-', c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.23 Comment end bang state. */
function commentEndBang(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '>') {
    L.emit(COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  if (c === '-') {
    L.emit('-', '-', '!');
    return L.continueWith(commentEndDash, L.tl(i));
  }
  L.emit('-', '-', '!', c);
  L.continueWith(comment, L.tl(i));
}

/** 8.2.4.24 Comment end space state. */
function commentEndSpace(L, i) {
  L.pos(i);
  const c = L.hd(i);
  if (L.eof(i)) return commentEof(L, i);
  if (c === '>') {
    L.emit(COMMENT_END);
    return L.continueWith(dat, L.tl(i));
  }
  if (c === '-') return L.continueWith(commentEndDash, L.tl(i));
  L.emit(c);
  L.continueWith(white(c) ? commentEndSpace : comment, L.tl(i));
}

/** 8.2.4.38 CDATA section state: its text as text. */
function cdataSection(L, i) {
  L.pos(i);
  const end = L.nextAfter(i, ']]>');
  if (end !== -1) return L.continueWith(dat, end);
  if (L.eof(i)) return L.continueWith(dat, i);
  L.emit(L.hd(i));
  L.continueWith(cdataSection, L.tl(i));
}

/**
 * 8.2.4.39 Tokenizing character references: after `&`, a reference's marks
 * and characters, or the `&` itself where none follows.
 *
 * @param {Lexer} L
 * @param {{state: Function, args: unknown[]}} r The state to resume.
 * @param {boolean} att Whether in an attribute value.
 * @param {string | null} end An attribute value's closing quote.
 * @param {number} i
 */
function charRef(L, r, att, end, i) {
  const c = L.hd(i);
  if (L.eof(i) || '\t\n\f <&'.includes(c) || c === end) {
    L.emit('&');
    return resume(L, r, i);
  }
  if (c === '#') return charRefNum(L, r, i, L.tl(i));
  charRefAlpha(L, r, att, i);
}

// After `&#`: `x` makes it hexadecimal. `o` is where the `#` was.
function charRefNum(L, r, o, i) {
  const c = L.hd(i);
  const hex = !L.eof(i) && (c === 'x' || c === 'X');
  charRefNum2(L, r, o, hex, hex ? L.tl(i) : i);
}

function charRefNum2(L, r, o, hex, i) {
  const c = L.hd(i);
  if (!L.eof(i) && hexChar(hex, c)) {
    L.emit(hex ? ENTITY_HEX : ENTITY_NUM, c);
    return charRefNum3(L, r, hex, L.tl(i));
  }
  L.emit(errSeen('&'), '&');
  resume(L, r, o);
}

function charRefNum3(L, r, hex, i) {
  for (;;) {
    const c = L.hd(i);
    if (!L.eof(i) && hexChar(hex, c)) {
      L.emit(c);
      i = L.tl(i);
      continue;
    }
    if (!L.eof(i) && c === ';') {
      L.emit({ t: ENTITY_END, semi: true });
      return resume(L, r, L.tl(i));
    }
    L.emit({ t: ENTITY_END, semi: false }, errWant(';'));
    return resume(L, r, i);
  }
}

function charRefAlpha(L, r, att, i) {
  const c = L.hd(i);
  if (!L.eof(i) && isAlpha(c)) {
    L.emit(ENTITY_NAME, c);
    return charRefAlpha2(L, r, att, L.tl(i));
  }
  L.emit(errSeen('&'), '&');
  resume(L, r, i);
}

function charRefAlpha2(L, r, att, i) {
  for (;;) {
    const c = L.hd(i);
    if (!L.eof(i) && alphaChar(c)) {
      L.emit(c);
      i = L.tl(i);
      continue;
    }
    if (!L.eof(i) && c === ';') {
      L.emit({ t: ENTITY_END, semi: true });
      return resume(L, r, L.tl(i));
    }
    L.emit({ t: ENTITY_END, semi: false });
    if (!att) L.emit(errWant(';'));
    return resume(L, r, i);
  }
}
