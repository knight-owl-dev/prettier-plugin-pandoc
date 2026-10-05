// Reference definitions, as prettier prints them: label and URL as written,
// one space between parts, a title in double quotes. The parser exposes
// where each part is (`definitions` on its read).
//
// @see prettier's src/language-markdown/printer-markdown.js ("definition")

/**
 * A definition as the parser's read gives it: each part's span, a title
 * or attributes it lacks null.
 *
 * @typedef {object} Definition
 * @property {[number, number]} label
 * @property {[number, number]} url
 * @property {[number, number] | null} title
 * @property {[number, number] | null} attributes
 */

/**
 * A definition printed, its parts from `text`.
 *
 * @param {Definition} definition
 * @param {string} text
 * @returns {string}
 */
export function printReference(definition, text) {
  const part = (span) => (span === null ? null : text.slice(span[0], span[1]));
  const parts = [
    part(definition.label),
    part(definition.url),
    quoted(part(definition.title)),
    part(definition.attributes),
  ];
  return parts.filter((p) => p !== null && p !== '').join(' ');
}

// A title in double quotes, where its text needs no escape to be in them.
function quoted(title) {
  if (title === null || title.startsWith('"')) return title;
  const inner = title.slice(1, -1);
  return /["\\]/.test(inner) ? title : `"${inner}"`;
}
