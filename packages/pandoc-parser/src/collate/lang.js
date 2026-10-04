// BCP 47 language tags: parsed, rendered, and the best match for one.
//
// Ported from unicode-collation 0.1.3.7's `Text.Collate.Lang`. Its Parsec
// parser over the tag's subtags reads them directly here: each subtag
// parser takes one subtag or none, so only `countBetween` backtracks.

/**
 * A BCP 47 language tag.
 *
 * @see Text.Collate.Lang.Lang
 * @typedef {object} Lang
 * @property {string} language
 * @property {string | null} script
 * @property {string | null} region
 * @property {string[]} variants
 * @property {[string, [string, string][]][]} extensions
 * @property {string[]} privateUse
 */

/**
 * @param {string} language
 * @param {Partial<Lang>} [fields]
 * @returns {Lang}
 */
export const lang = (language, fields = {}) => ({
  language,
  script: null,
  region: null,
  variants: [],
  extensions: [],
  privateUse: [],
  ...fields,
});

/**
 * The best match for `l` among `pairs`: same language, then script,
 * region and collation in that order of weight; the first of equals.
 *
 * @see Text.Collate.Lang.lookupLang
 * @template A
 * @param {Lang} l
 * @param {[Lang, A][]} pairs
 * @returns {[Lang, A] | null}
 */
export function lookupLang(l, pairs) {
  const maybeMatch = (f, x) => {
    const [fx, fl] = [f(x), f(l)];
    if (fx === null) return fl === null;
    return fl !== null && fx === fl ? true : undefined;
  };
  const collation = (x) =>
    x.extensions.find(([c]) => c === 'u')?.[1].find(([k]) => k === 'co')?.[1] ??
    null;
  // Pandoc sorts the matches by (language, script, region, collation),
  // all booleans, and takes the first of the best: a score orders them so.
  let best = null;
  for (const pair of pairs) {
    const [x] = pair;
    if (x.language !== l.language) continue;
    const key = [
      maybeMatch((y) => y.script, x),
      maybeMatch((y) => y.region, x),
      maybeMatch(collation, x),
    ];
    if (key.includes(undefined)) continue;
    const score = key.reduce((n, b) => n * 2 + (b ? 1 : 0), 0);
    if (best === null || score > best[0]) best = [score, pair];
  }
  return best === null ? null : best[1];
}

/**
 * A tag in BCP 47 form.
 *
 * @see Text.Collate.Lang.renderLang
 * @param {Lang} l
 */
export function renderLang(l) {
  const keyword = ([k, v]) => `-${k}${v === '' ? '' : `-${v}`}`;
  return (
    l.language +
    (l.script === null ? '' : `-${l.script}`) +
    (l.region === null ? '' : `-${l.region}`) +
    l.variants.map((v) => `-${v}`).join('') +
    l.extensions.map(([c, ks]) => `-${c}${ks.map(keyword).join('')}`).join('') +
    (l.privateUse.length === 0
      ? ''
      : `-x${l.privateUse.map((t) => `-${t}`).join('')}`)
  );
}

const isAsciiAlpha = (c) => /^[A-Za-z]$/.test(c);
const isAsciiAlphaNum = (c) => /^[A-Za-z0-9]$/.test(c);
const isDigit = (c) => /^[0-9]$/.test(c);
const all = (t, f) => [...t].every(f);
const lengthBetween = (lo, hi, t) => {
  const n = [...t].length;
  return n >= lo && n <= hi;
};
const alphas = (n) => (t) => all(t, isAsciiAlpha) && [...t].length === n;
const digits = (n) => (t) => all(t, isDigit) && [...t].length === n;
const alphasBetween = (lo, hi) => (t) =>
  all(t, isAsciiAlpha) && lengthBetween(lo, hi, t);
const alphanumsBetween = (lo, hi) => (t) =>
  all(t, isAsciiAlphaNum) && lengthBetween(lo, hi, t);
const toLower = (t) => t.toLowerCase();
const toTitle = (t) => t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();

// Haskell's `isSpace`, as `T.takeWhile (not . isSpace)` stops at it.
const SPACE =
  /[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

/**
 * A BCP 47 tag parsed, its subtags split at `-` or `_`; what follows
 * the tag is allowed. Null where it is no tag.
 *
 * @see Text.Collate.Lang.parseLang
 * @param {string} s
 * @returns {Lang | null}
 */
export function parseLang(s) {
  const space = s.search(SPACE);
  const ts = (space === -1 ? s : s.slice(0, space)).split(/[-_]/);
  let i = 0;
  const tok = (f) => (i < ts.length && f(ts[i]) ? ts[i++] : null);
  const many = (p) => {
    const out = [];
    for (let x = p(); x !== null; x = p()) out.push(x);
    return out;
  };

  // countBetween: from `low` to `hi` of `p`, all or none read.
  const countBetween = (low, hi, p) => {
    const from = i;
    const out = [];
    while (out.length < hi) {
      const x = p();
      if (x === null) break;
      out.push(x);
    }
    if (out.length >= low) return out;
    i = from;
    return null;
  };

  const pLanguage = () => {
    const base = tok(alphasBetween(2, 3));
    if (base !== null) {
      const ext = countBetween(1, 3, () => {
        const t = tok(alphas(3));
        return t === null ? null : toLower(t);
      });
      return ext === null ? toLower(base) : `${toLower(base)}-${ext.join('-')}`;
    }
    const t = tok(alphasBetween(4, 8));
    return t === null ? null : toLower(t);
  };
  const pScript = () => {
    const t = tok(alphas(4));
    return t === null ? null : toTitle(t);
  };
  const pRegion = () => {
    const t = tok(alphas(2));
    if (t !== null) return t.toUpperCase();
    return tok(digits(3));
  };
  const pVariant = () => {
    const t =
      tok(alphanumsBetween(5, 8)) ??
      tok(
        (x) => all(x, isAsciiAlphaNum) && [...x].length === 4 && isDigit(x[0]),
      );
    return t === null ? null : toLower(t);
  };
  const pKeyword = () => {
    const key = tok(alphas(2));
    if (key === null) return null;
    return [key, many(() => tok(alphanumsBetween(3, 8))).join('-')];
  };
  const pExtension = () => {
    const c = tok((t) => [...t].length === 1 && all(t, isAsciiAlphaNum));
    if (c === null) return null;
    const attrs = many(() => {
      const t = tok((x) => all(x, isAsciiAlphaNum) && lengthBetween(3, 8, x));
      return t === null ? null : toLower(t);
    });
    const keywords = many(pKeyword);
    return [toLower(c), [...attrs.map((a) => [a, '']), ...keywords]];
  };
  // privateuse = "x" 1*("-" (1*8alphanum)); `undefined` where it fails
  // after its "x".
  const pPrivateUse = () => {
    if (tok((t) => t.toLowerCase() === 'x') === null) return null;
    const uses = many(() => tok(alphanumsBetween(1, 8)));
    return uses.length === 0 ? undefined : uses;
  };

  const language = pLanguage();
  if (language === null) return null;
  const script = pScript();
  const region = pRegion();
  const variants = many(pVariant);
  const extensions = many(pExtension);
  const privateUse = pPrivateUse();
  if (privateUse === undefined) return null;
  return {
    language,
    script,
    region,
    variants,
    extensions,
    privateUse: privateUse ?? [],
  };
}
